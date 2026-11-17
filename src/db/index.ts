import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * The database is created lazily, on the first query — never at import time.
 *
 * Why: `next build` imports every route module to collect its configuration, so
 * a module-level `throw` turns a missing DATABASE_URL into a build failure (the
 * build machine does not need a database). At runtime a missing URL still fails
 * loudly, but only for the request that actually needs Postgres.
 */

type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: Database;
};

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function connectionString(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required — set it in the environment (Vercel: Project → Settings → Environment Variables).",
    );
  }
  return url;
}

export function getPool(): Pool {
  const existing = globalForDb.__arenaNextJsPostgresqlPool;
  if (existing) return existing;
  const created = new Pool({ connectionString: connectionString(), max: 10 });
  globalForDb.__arenaNextJsPostgresqlPool = created;
  return created;
}

export function getDb(): Database {
  const existing = globalForDb.__arenaNextJsPostgresqlDb;
  if (existing) return existing;
  const created = drizzle(getPool(), { schema });
  globalForDb.__arenaNextJsPostgresqlDb = created;
  return created;
}

/** Back-compat: some callers only need to know whether a pool exists yet. */
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, property) {
    const instance = getPool();
    const value = Reflect.get(instance as object, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/** Same surface as `drizzle(pool)`, but resolved on first use. */
export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const instance = getDb();
    const value = Reflect.get(instance as object, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
  has(_target, property) {
    return property in (getDb() as object);
  },
});
