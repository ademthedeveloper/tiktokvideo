import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/init";
import { posts } from "@/db/schema";

export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, " \\n ")}"`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "txt").toLowerCase();
  const status = url.searchParams.get("status") ?? "all";

  await ensureSchema();
  const rows = await db.select().from(posts).orderBy(desc(posts.savedAt));
  const filtered = rows.filter((row) =>
    status === "all" ? true : row.status === status,
  );

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const header = [
      "saved_at",
      "status",
      "tiktok_id",
      "author",
      "credit",
      "original_caption",
      "ready_caption",
      "style",
      "plays",
      "likes",
      "video_link",
      "note",
    ];
    const lines = [header.join(",")];
    for (const row of filtered) {
      lines.push(
        [
          csvCell(new Date(row.savedAt).toISOString()),
          csvCell(row.status),
          csvCell(row.tiktokId),
          csvCell(row.authorUsername),
          csvCell(`cr: @${row.authorUsername}`),
          csvCell(row.originalCaption),
          csvCell(row.caption),
          csvCell(row.captionStyle),
          csvCell(row.playCount ?? ""),
          csvCell(row.diggCount ?? ""),
          csvCell(row.shareUrl ?? ""),
          csvCell(row.note),
        ].join(","),
      );
    }
    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="repost-desk-${stamp}.csv"`,
      },
    });
  }

  if (format === "json") {
    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      count: filtered.length,
      posts: filtered,
    });
  }

  const blocks = filtered.map((row, index) => {
    const head = `── ${String(index + 1).padStart(2, "0")} · ${row.status.toUpperCase()} · cr: @${row.authorUsername} ──`;
    return `${head}\n${row.caption}\n${row.shareUrl ?? ""}`;
  });
  const body = blocks.length
    ? `${blocks.join("\n\n")}\n`
    : "# The queue is empty — go grab some clips.\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="repost-desk-${stamp}.txt"`,
    },
  });
}
