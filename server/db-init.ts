import { pool } from "./db";
import bcrypt from "bcryptjs";

export async function ensureDbBasics() {
  try {
    // Test connection first
    await pool.query('SELECT NOW()');
    console.log('[db] Database connection successful');
  } catch (error) {
    console.error('[db] Database connection failed:', error);
    throw error;
  }

  const dbPool = pool;

  // Minimal schema required for login/session to work in dev.
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    );
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS dealers (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      identification_code TEXT NOT NULL DEFAULT '000000000',
      email TEXT UNIQUE,
      password TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Add columns if they don't exist (for existing databases)
  await dbPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dealers' AND column_name='identification_code') THEN
        ALTER TABLE dealers ADD COLUMN identification_code TEXT NOT NULL DEFAULT '000000000';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dealers' AND column_name='email') THEN
        ALTER TABLE dealers ADD COLUMN email TEXT UNIQUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dealers' AND column_name='whatsapp_number') THEN
        ALTER TABLE dealers ADD COLUMN whatsapp_number TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dealers' AND column_name='send_to_rda') THEN
        ALTER TABLE dealers ADD COLUMN send_to_rda BOOLEAN DEFAULT false;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dealers' AND column_name='password') THEN
        ALTER TABLE dealers ADD COLUMN password TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dealers' AND column_name='created_at') THEN
        ALTER TABLE dealers ADD COLUMN created_at TIMESTAMP DEFAULT NOW();
      END IF;
    END
    $$;
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      dealer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price INTEGER NOT NULL,
      category TEXT NOT NULL,
      image_url TEXT,
      stock INTEGER NOT NULL DEFAULT 0,
      discount_price INTEGER,
      discount_percentage INTEGER,
      discount_expiry timestamp,
      CONSTRAINT products_dealer_id_name_unique UNIQUE (dealer_id, name)
    );
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS branches (
      id SERIAL PRIMARY KEY,
      dealer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      branch_email TEXT,
      whatsapp_number TEXT,
      send_to_rda BOOLEAN DEFAULT false,
      CONSTRAINT branches_dealer_id_name_unique UNIQUE (dealer_id, name)
    );
  `);

  // Ensure new columns exist for older databases
  await dbPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='branches' AND column_name='branch_email') THEN
        ALTER TABLE branches ADD COLUMN branch_email TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='branches' AND column_name='whatsapp_number') THEN
        ALTER TABLE branches ADD COLUMN whatsapp_number TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='branches' AND column_name='send_to_rda') THEN
        ALTER TABLE branches ADD COLUMN send_to_rda BOOLEAN DEFAULT false;
      END IF;
    END
    $$;
  `);

  try {
    await dbPool.query(`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_dealer_id_name_unique CASCADE;`);
    await dbPool.query(`DROP INDEX IF EXISTS products_dealer_id_name_unique CASCADE;`);
    await dbPool.query(`ALTER TABLE products ADD CONSTRAINT products_dealer_id_name_unique UNIQUE (dealer_id, name);`);
  } catch(e) {
    console.log('[db] Note: products unique constraint setup issue:', e);
  }

  try {
    await dbPool.query(`ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_dealer_id_name_unique CASCADE;`);
    await dbPool.query(`DROP INDEX IF EXISTS branches_dealer_id_name_unique CASCADE;`);
    await dbPool.query(`ALTER TABLE branches ADD CONSTRAINT branches_dealer_id_name_unique UNIQUE (dealer_id, name);`);
  } catch(e) {
    console.log('[db] Note: branches unique constraint setup issue:', e);
  }

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL,
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL
    );
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS active_session_locks (
      lock_key TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      owner_role TEXT NOT NULL,
      owner_dealer_id INTEGER,
      token TEXT NOT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL
    );
  `);
  try {
    const constraintCheck = await dbPool.query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey';
    `);
    if (constraintCheck.rowCount === 0) {
      await dbPool.query(`ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");`);
    }
  } catch (e) {
    console.log('[db] session_pkey failed, trying recovery via truncate:', e);
    try {
      await dbPool.query(`TRUNCATE TABLE "session";`);
      await dbPool.query(`ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");`);
    } catch (inner) {
      console.log('[db] session_pkey recovery failed:', inner);
    }
  }
  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);

  // Hash user passwords with bcrypt (consistent with dealer auth)
  const userPasswordHash = bcrypt.hashSync("Energo123#", 10);

  await dbPool.query(
    `INSERT INTO users (username, password)
     VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password`,
    ["demo@example.com", userPasswordHash],
  );

  await dbPool.query(
    `INSERT INTO users (username, password)
     VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password`,
    ["info@gorgia.ge", userPasswordHash],
  );

  // Legacy dealers — ALWAYS force-update email & password so credentials stay correct
  const defaultDealerPassword = bcrypt.hashSync("Dealer123#", 10);
  console.log("[db] Seeding legacy dealers with password: Dealer123#");

  await dbPool.query(
    `INSERT INTO dealers (key, name, identification_code, email, password)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key) DO UPDATE SET email = EXCLUDED.email, password = EXCLUDED.password`,
    ["iron", "Iron+", "000000000", "demo@example.com", defaultDealerPassword],
  );

  await dbPool.query(
    `INSERT INTO dealers (key, name, identification_code, email, password)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key) DO UPDATE SET email = EXCLUDED.email, password = EXCLUDED.password`,
    ["gorgia", "Gorgia", "000000000", "info@gorgia.ge", defaultDealerPassword],
  );

  // Seed default products only if the products table is empty
  const productsCountResult = await dbPool.query('SELECT COUNT(*) FROM products');
  const productsCountRaw = (productsCountResult as any)?.rows?.[0]?.count;
  const productsCount = Number.parseInt(String(productsCountRaw ?? "0"), 10);
  if (!Number.isFinite(productsCount) || productsCount === 0) {
    await dbPool.query(
      `INSERT INTO products (dealer_id, name, description, price, category, image_url, stock)
       VALUES
         ((SELECT id FROM dealers WHERE key = 'iron'), 'Iron Charger', 'Fast charging adapter', 2999, 'Accessories', '', 50),
         ((SELECT id FROM dealers WHERE key = 'iron'), 'Iron Cable', 'Durable USB-C cable', 899, 'Accessories', '', 150),
         ((SELECT id FROM dealers WHERE key = 'gorgia'), 'Gorgia Smartwatch', 'Fitness tracking smartwatch', 19999, 'Wearables', '', 30)
       ON CONFLICT (dealer_id, name) DO NOTHING`,
    );
  }

  // Seed default Gorgia branches only if the branches table is empty
  const branchesCountResult = await dbPool.query('SELECT COUNT(*) FROM branches');
  const branchesCountRaw = (branchesCountResult as any)?.rows?.[0]?.count;
  const branchesCount = Number.parseInt(String(branchesCountRaw ?? "0"), 10);
  if (!Number.isFinite(branchesCount) || branchesCount === 0) {
    await dbPool.query(
      `INSERT INTO branches (dealer_id, name)
       VALUES
         ((SELECT id FROM dealers WHERE key = 'gorgia'), 'Tbilisi Branch'),
         ((SELECT id FROM dealers WHERE key = 'gorgia'), 'Kutaisi Branch'),
         ((SELECT id FROM dealers WHERE key = 'gorgia'), 'Batumi Branch')
       ON CONFLICT (dealer_id, name) DO NOTHING`,
    );
  }
}

