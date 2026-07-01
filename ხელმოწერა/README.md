# gabulaize

Minimal demo project for handling dealer/product data.

## Setup

1. Create a `.env` file at the project root.
2. Add a `DATABASE_URL` entry pointing to your Postgres instance.
   - Example (Neon / cloud with SSL):
     ```
     DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
     ```
   - **Do not wrap the URL in quotes.** dotenv will strip them, but if they
     end up in `process.env` the extra characters break the parser and lead to
     "Connection terminated due to connection timeout" errors.
3. Optionally adjust `DB_CONN_TIMEOUT_MS` if your database takes a while to
   warm up (default 60 seconds).

## Running

```
npm install
npm run dev
```

The server listens on the port defined by `PORT` (default 8081). During
startup the app attempts to bootstrap the database schema; errors are logged
with full details to help diagnose connectivity issues.

