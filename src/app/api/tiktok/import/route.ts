import { NextResponse } from "next/server";
import { fromTikwm } from "@/lib/providers/tikwm";
import type { FetchMode, ProviderAttempt, TikTokVideo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/tiktok/import
 *
 * The browser fetches upstream JSON when the server's IP is blocked (see
 * src/lib/browser-egress.ts) and posts the raw bodies here. This route is the
 * only place those payloads are turned into clips, so the normaliser stays in
 * one place and never runs in the browser.
 *
 * It trusts nothing but the shape: no URLs are fetched here, so there is no
 * request made on the caller's behalf.
 */

function itemsOf(body: any): any[] {
  const data = body?.data ?? body;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.videos)) return data.videos;
  if (Array.isArray(data.item_list)) return data.item_list;
  if (Array.isArray(data.items)) return data.items;
  if (typeof data === "object" && (data.id || data.video_id || data.aweme_id)) return [data];
  return [];
}

function clip(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 4_000_000) {
    return NextResponse.json({ error: "That payload is too large — pull fewer clips." }, { status: 413 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const mode = ((body?.mode ?? "search") as FetchMode) || "search";
  const keyword = String(body?.keyword ?? "").trim();
  const count = Math.min(30, Math.max(1, Number(body?.count ?? 12) || 12));
  const payloads: any[] = Array.isArray(body?.payloads) ? body.payloads.slice(0, 8) : [];

  if (!payloads.length) {
    return NextResponse.json(
      { error: "Nothing to import — the browser did not get an answer either.", videos: [] },
      { status: 400 },
    );
  }

  const seen = new Set<string>();
  const videos: TikTokVideo[] = [];
  const attempts: ProviderAttempt[] = [];

  for (const payload of payloads) {
    const provider = clip(String(payload?.provider ?? "your browser"), 46);
    const ms = Math.max(0, Math.min(120_000, Number(payload?.ms ?? 0) || 0));
    const items = itemsOf(payload?.body);
    let fresh = 0;
    for (const raw of items) {
      if (videos.length >= count) break;
      const video = fromTikwm(raw, mode === "link" ? "link" : mode === "firehose" ? "firehose" : "search");
      if (!video || seen.has(video.id)) continue;
      if (keyword && !keyword.startsWith("@")) {
        video.matchedTag = keyword.replace(/^#/, "").toLowerCase();
      }
      seen.add(video.id);
      videos.push(video);
      fresh += 1;
    }
    attempts.push({ provider, query: keyword || "pasted links", found: fresh, ms });
  }

  const ordered = videos
    .map((video, index) => ({ ...video, rank: index }))
    .sort((a, b) => (b.diggCount ?? 0) + (b.playCount ?? 0) / 100 - ((a.diggCount ?? 0) + (a.playCount ?? 0) / 100))
    .map((video, index) => ({ ...video, rank: index }));

  const verbs: Record<string, string> = {
    search: "fetched",
    link: "resolved",
    firehose: "read",
  };

  return NextResponse.json({
    videos: ordered,
    nextCursor: 0,
    hasMore: false,
    mode,
    upstream: "your browser → tikwm",
    attempts,
    degraded: false,
    notice: ordered.length
      ? `${ordered.length} clip${ordered.length === 1 ? "" : "s"} ${
          verbs[mode] ?? verbs.search
        } from your browser — tikwm answered your connection, not the server's.`
      : `The browser reached tikwm but it had no clips for “${keyword}”. Try a broader keyword.`,
  });
}
