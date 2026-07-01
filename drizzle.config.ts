import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// strip quotes to keep behavior consistent with runtime pool code
const rawUrl = process.env.DATABASE_URL;
const connectionUrl = rawUrl?.replace(/^\s*"|"\s*$/g, "") ?? "";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionUrl,
  },
});
