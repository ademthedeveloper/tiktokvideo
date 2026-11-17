import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/init";
import { appSettings, posts } from "@/db/schema";
import { DEFAULT_SETTINGS, settingsFromRow } from "@/lib/captions";
import { toSavedPost } from "@/lib/mappers";
import type { SavedPost, Settings } from "@/lib/types";
import { Studio } from "@/components/Studio";

export const dynamic = "force-dynamic";

async function bootstrap(): Promise<{ settings: Settings; saved: SavedPost[]; dbError: string | null }> {
  try {
    await ensureSchema();
    const [settingsRows, postRows] = await Promise.all([
      db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1),
      db.select().from(posts).orderBy(desc(posts.savedAt)).limit(120),
    ]);
    return {
      settings: settingsRows[0] ? settingsFromRow(settingsRows[0]) : DEFAULT_SETTINGS,
      saved: postRows.map(toSavedPost),
      dbError: null,
    };
  } catch (err) {
    return {
      settings: DEFAULT_SETTINGS,
      saved: [],
      dbError: err instanceof Error ? err.message : "database unavailable",
    };
  }
}

export default async function Home() {
  const { settings, saved } = await bootstrap();
  return <Studio initialSettings={settings} initialPosts={saved} />;
}
