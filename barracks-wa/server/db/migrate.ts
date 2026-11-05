import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const migrationsDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));

export async function applyMigrations(db: Pool, through = Number.POSITIVE_INFINITY): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file) && Number(file.slice(0, 3)) <= through)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const client = await db.connect();
  try {
    // Lock waits and data migrations may outlast the application's query limit.
    await client.query("SET statement_timeout = 0");
    // Global default privileges and extension catalog changes are shared even
    // across schemas. Serialize separate migration runners on this database.
    await client.query("SELECT pg_advisory_lock(918274)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    for (const file of files) {
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (applied.rowCount) continue;
      const sql = await readFile(join(migrationsDirectory, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(918274)").catch(() => undefined);
    await client.query("RESET statement_timeout").catch(() => undefined);
    client.release();
  }
}
