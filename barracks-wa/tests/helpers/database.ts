import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyMigrations } from "@/server/db/migrate";

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const ssl = process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;

export const databaseConfigured = Boolean(connectionString);

// Service code reads the JavaScript clock (booking window, past slots, Manila
// "today"). Keep it on the same anchored, advancing instant as the schema clock
// so fixtures do not drift as real time passes.
const RealDate = Date;
function pinJavaScriptClock(clock: string): () => void {
  const previous = globalThis.Date;
  const instant = RealDate.parse(clock);
  const origin = RealDate.now();
  const now = () => instant + (RealDate.now() - origin);
  class ClockDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(now());
      else super(...(args as [string | number | Date]));
    }
    static override now() { return now(); }
  }
  globalThis.Date = ClockDate as DateConstructor;
  return () => { globalThis.Date = previous; };
}

function controlledClockQueries<T extends object>(target: T): T {
  return new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key);
      if (typeof value !== "function") return value;
      if (key === "query") return (...args: unknown[]) => {
        // SQL keywords cannot be shadowed by schema functions. Route them to
        // the same clock too, including defaults parsed during migrations.
        const rewrite = (sql: string) => sql.replace(/\bCURRENT_TIMESTAMP\b/gi, "now()")
          .replace(/\bCURRENT_DATE\b/gi, "now()::date");
        if (typeof args[0] === "string") args[0] = rewrite(args[0]);
        else if (args[0] && typeof args[0] === "object" && "text" in args[0])
          args[0] = { ...args[0], text: rewrite(String(args[0].text)) };
        return Reflect.apply(value, object, args);
      };
      if (key === "connect") return async () => controlledClockQueries(await Reflect.apply(value, object, []));
      return value.bind(object);
    },
  });
}

export async function createDisposableSchema(through = Number.POSITIVE_INFINITY, clock?: string) {
  if (!connectionString) throw new Error("DATABASE_URL or POSTGRES_URL is required for database tests");
  const target = new URL(connectionString);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
    || !/^\/barracks_[a-z0-9_]*disposable$/.test(target.pathname)
    || process.env.DATABASE_SSL === "true") {
    throw new Error("Database tests require a local barracks_*disposable database with DATABASE_SSL=false; hosted targets are forbidden");
  }
  const schema = `codex_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString, ssl, max: 2 });
  const rawDb = new Pool({ connectionString, ssl, options: `-c search_path=${schema},public,pg_catalog`, max: 10 });
  const db = clock ? controlledClockQueries(rawDb) : rawDb;
  const restoreClock = clock ? pinJavaScriptClock(clock) : () => undefined;
  try {
    // Extensions are database-wide. Never let the first disposable schema own
    // btree_gist, since dropping it would invalidate other schema fixtures.
    const setup = await admin.connect();
    try {
      await setup.query("BEGIN");
      await setup.query("SELECT pg_advisory_xact_lock(918274)");
      await setup.query("CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public");
      await setup.query("ALTER EXTENSION btree_gist SET SCHEMA public");
      await setup.query("COMMIT");
    } catch (error) {
      await setup.query("ROLLBACK");
      throw error;
    } finally { setup.release(); }
    await admin.query(`CREATE SCHEMA "${schema}"`);
    if (clock) {
      // Schema-local clock, never installed in public or production. Keep elapsed
      // time so transactions waiting on locks still prove post-lock timestamps.
      await db.query("CREATE TABLE test_clock (instant timestamptz NOT NULL, origin timestamptz NOT NULL)");
      await db.query("INSERT INTO test_clock VALUES ($1, pg_catalog.clock_timestamp())", [clock]);
      await db.query(`CREATE FUNCTION clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS
        'SELECT instant + (pg_catalog.clock_timestamp() - origin) FROM test_clock'`);
      await db.query(`CREATE FUNCTION now() RETURNS timestamptz LANGUAGE sql STABLE AS
        'SELECT instant + (pg_catalog.transaction_timestamp() - origin) FROM test_clock'`);
    }
    await applyMigrations(db, through);
  } catch (error) {
    restoreClock();
    await db.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    throw error;
  }
  return {
    db,
    schema,
    cleanup: async () => {
      restoreClock();
      await db.end();
      try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { await admin.end(); }
    },
  };
}
