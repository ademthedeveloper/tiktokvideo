import { NextResponse } from "next/server";
import { searchTikTok } from "@/lib/tiktok-search";
import {
  extractTikTokLinks,
  fetchFirehose,
  resolveLinks,
  UpstreamError,
} from "@/lib/tiktok";
import type { FetchMode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: Request) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const mode = ((body.mode ?? "search") as FetchMode).toLowerCase() as FetchMode;
  const region = String(body.region ?? "US").toUpperCase();
  const cursor = Number(body.cursor ?? 0) || 0;
  const count = Math.min(30, Math.max(4, Number(body.count ?? 10) || 10));

  try {
    /* ── real TikTok search via the crawler-facing tag pages ─────── */
    if (mode === "search") {
      const keyword = String(body.keyword ?? "").trim();
      if (!keyword) {
        return NextResponse.json(
          { error: "Type what you want to search for on TikTok." },
          { status: 400 },
        );
      }
      const outcome = await searchTikTok({ keyword, count, region });
      return NextResponse.json({
        videos: outcome.videos,
        nextCursor: 0,
        hasMore: false,
        mode,
        upstream: "tiktok.com tag pages (JSON-LD)",
        tagsTried: outcome.tagsTried,
        headline: outcome.headline,
        notice: outcome.notice,
      });
    }

    /* ── paste links / ids ───────────────────────────────────────── */
    if (mode === "link") {
      const links = extractTikTokLinks(String(body.links ?? ""));
      if (!links.length) {
        return NextResponse.json(
          { error: "Paste at least one TikTok link or video ID." },
          { status: 400 },
        );
      }
      if (links.length > 25) {
        return NextResponse.json(
          { error: "Max 25 links per grab — split it into two batches." },
          { status: 400 },
        );
      }
      const { videos, failures } = await resolveLinks(links.slice(0, 25));
      return NextResponse.json({
        videos,
        nextCursor: 0,
        hasMore: false,
        mode,
        upstream: "tikwm /api/",
        failures,
        notice: failures.length
          ? `${videos.length} resolved, ${failures.length} failed: ${failures
              .map((failure) => failure.reason)
              .slice(0, 2)
              .join(" · ")}`
          : `${videos.length} clip${videos.length === 1 ? "" : "s"} resolved.`,
      });
    }

    /* ── region firehose ─────────────────────────────────────────── */
    const page = await fetchFirehose({ region, cursor, count });
    return NextResponse.json({
      videos: page.videos,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      mode,
      upstream: "tikwm /api/feed/list",
      notice: page.videos.length
        ? undefined
        : "The firehose returned nothing for that region — try another one.",
    });
  } catch (err) {
    const message =
      err instanceof UpstreamError
        ? `${err.message}${err.detail ? ` (${err.detail})` : ""}`
        : err instanceof Error
          ? err.message
          : "Fetch failed";
    return NextResponse.json({ error: message, videos: [] }, { status: 502 });
  }
}
