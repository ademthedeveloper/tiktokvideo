import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  // Handy when a deployment looks stale: compare this to `git rev-parse HEAD`.
  const build = {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    env:
      process.env.VERCEL_ENV ??
      (process.env.NODE_ENV === "production" ? "production" : "development"),
  };
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, build });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        build,
        database: err instanceof Error ? err.message.split("\n")[0] : "database unavailable",
      },
      { status: 500 },
    );
  }
}
