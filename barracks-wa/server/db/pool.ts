import { Pool } from "pg";

// "true" verifies the server certificate. Providers with a private CA, such as
// Supabase, also need DATABASE_SSL_CA. "no-verify" encrypts without verifying.
function databaseSsl() {
  if (process.env.DATABASE_SSL === "no-verify") return { rejectUnauthorized: false };
  if (process.env.DATABASE_SSL !== "true") return undefined;
  const ca = process.env.DATABASE_SSL_CA?.replaceAll("\\n", "\n");
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or POSTGRES_URL must be configured");
}

// Next development reloads and route bundles must share one connection pool.
const databaseGlobal = globalThis as typeof globalThis & { barracksDatabasePool?: Pool };
const existingPool = databaseGlobal.barracksDatabasePool;
export const pool = existingPool ?? new Pool({
  connectionString,
  ssl: databaseSsl(),
  max: Number(process.env.DATABASE_POOL_MAX ?? (process.env.VERCEL ? 3 : 10)),
  // Fail a request instead of waiting forever when no connection is available.
  connectionTimeoutMillis: 10_000,
  // Transaction poolers may ignore this and apply their own limit.
  statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 30_000),
});

if (process.env.NODE_ENV !== "production") databaseGlobal.barracksDatabasePool = pool;
if (!existingPool) pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});
