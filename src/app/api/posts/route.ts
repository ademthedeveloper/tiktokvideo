import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/init";
import { captionLogs, posts } from "@/db/schema";
import { toSavedPost } from "@/lib/mappers";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q")?.trim();

    const rows = await db.select().from(posts).orderBy(desc(posts.savedAt));
    const filtered = rows
      .map(toSavedPost)
      .filter((row) => (status && status !== "all" ? row.status === status : true))
      .filter((row) =>
        q
          ? `${row.caption} ${row.originalCaption} ${row.authorUsername} ${row.authorNickname} ${row.note}`
              .toLowerCase()
              .includes(q.toLowerCase())
          : true,
      );

    const counts = await db
      .select({ status: posts.status, total: sql<number>`count(*)::int` })
      .from(posts)
      .groupBy(posts.status);
    const tally: Record<string, number> = { all: 0, queued: 0, posted: 0, skipped: 0 };
    for (const entry of counts) {
      tally[entry.status] = entry.total;
      tally.all += entry.total;
    }

    return NextResponse.json({ posts: filtered, tally });
  } catch (err) {
    return NextResponse.json(
      { posts: [], tally: {}, error: err instanceof Error ? err.message : "db error" },
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = await request.json();
    const video = body.video;
    if (!video?.id) {
      return NextResponse.json({ error: "Missing video payload" }, { status: 400 });
    }

    const values = {
      tiktokId: String(video.id),
      originalCaption: String(video.caption ?? ""),
      caption: String(body.caption ?? video.caption ?? ""),
      captionStyle: String(body.captionStyle ?? "verbatim"),
      authorUsername: String(video.authorUsername ?? ""),
      authorNickname: String(video.authorNickname ?? ""),
      authorAvatar: video.authorAvatar ?? null,
      coverUrl: video.coverUrl ?? null,
      playUrl: video.playUrl ?? null,
      hdPlayUrl: video.hdPlayUrl ?? null,
      shareUrl: video.shareUrl ?? null,
      musicTitle: video.musicTitle ?? null,
      durationSec: video.durationSec ?? null,
      region: video.region ?? null,
      postedAt: video.postedAt ? new Date(video.postedAt) : null,
      playCount: video.playCount ?? null,
      diggCount: video.diggCount ?? null,
      commentCount: video.commentCount ?? null,
      shareCount: video.shareCount ?? null,
      status: String(body.status ?? "queued"),
      note: String(body.note ?? ""),
      source: String(video.source ?? "firehose"),
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(posts)
      .values(values)
      .onConflictDoUpdate({ target: posts.tiktokId, set: values })
      .returning();

    await db.insert(captionLogs).values({
      tiktokId: values.tiktokId,
      authorUsername: values.authorUsername,
      style: values.captionStyle,
      body: values.caption,
      chosen: true,
    });

    return NextResponse.json({ post: toSavedPost(row), saved: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not save clip" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    if (url.searchParams.get("all") === "1") {
      await db.delete(captionLogs);
      await db.delete(posts);
      return NextResponse.json({ cleared: true });
    }
    return NextResponse.json({ error: "Use ?all=1 to clear the queue" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not clear" },
      { status: 500 },
    );
  }
}
