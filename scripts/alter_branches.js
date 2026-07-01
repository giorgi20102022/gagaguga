import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function run() {
  try {
    await client.connect();
    await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_email TEXT;`);
    await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;`);
    await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS send_to_rda BOOLEAN DEFAULT false;`);
    console.log('Columns added successfully (if they were missing).');
  } catch (err) {
    console.error('Error altering table:', err);
  } finally {
    await client.end();
  }
}

run();
