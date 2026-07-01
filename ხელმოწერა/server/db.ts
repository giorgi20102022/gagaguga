import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// strip optional quotes, which are common in .env files and can confuse
// pg when they become part of the URL
const rawUrl = process.env.DATABASE_URL;
const normalizedConnectionString = rawUrl?.replace(/^\s*"|"\s*$/g, "") ?? "";
const connectionString = normalizedConnectionString.includes("sslmode=")
  ? normalizedConnectionString
  : `${normalizedConnectionString}${normalizedConnectionString.includes("?") ? "&" : "?"}sslmode=no-verify`;

export const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (error) => {
  console.error("[db] Unexpected PostgreSQL pool error:", error);
});

console.log("[db] DATABASE_URL detected:", Boolean(rawUrl));
console.log("[db] PostgreSQL pool configuration:", {
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
  ssl: { rejectUnauthorized: false },
  usesSslModeNoVerify: connectionString.includes("sslmode=no-verify"),
});

export const db = drizzle(pool, { schema });
