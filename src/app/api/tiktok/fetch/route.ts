import { NextResponse } from "next/server";
import {
  extractTikTokLinks,
  fetchFirehose,
  resolveLinks,
  searchClips,
  UpstreamError,
} from "@/lib/tiktok";
import type { FetchMode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    /* ── keyword / hashtag / @handle search ──────────────────────── */
    if (mode === "search") {
      const keyword = String(body.keyword ?? "").trim();
      if (!keyword) {
        return NextResponse.json(
          { error: "Type what you want to search for on TikTok." },
          { status: 400 },
        );
      }
      const outcome = await searchClips({ keyword, count, region });
      return NextResponse.json({
        videos: outcome.videos,
        nextCursor: 0,
        hasMore: false,
        mode,
        upstream: outcome.upstream,
        tagsTried: outcome.tagsTried,
        attempts: outcome.attempts,
        headline: outcome.headline,
        notice: outcome.notice,
        degraded: outcome.degraded,
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
      const outcome = await resolveLinks(links.slice(0, 25));
      const providerLabel = outcome.providers.length
        ? outcome.providers.join(" + ")
        : "tikwm / tiktok.com";
      return NextResponse.json({
        videos: outcome.videos,
        nextCursor: 0,
        hasMore: false,
        mode,
        upstream: providerLabel,
        attempts: outcome.attempts,
        failures: outcome.failures,
        degraded: outcome.degraded,
        notice: outcome.videos.length
          ? `${outcome.videos.length} clip${outcome.videos.length === 1 ? "" : "s"} resolved${
              outcome.failures.length ? ` · ${outcome.failures.length} failed` : ""
            }${outcome.failures.length ? `: ${outcome.failures[0].reason}` : ""}`
          : `Nothing resolved. ${outcome.failures[0]?.reason ?? "Try a full tiktok.com link."}`,
      });
    }

    /* ── region firehose ─────────────────────────────────────────── */
    const page = await fetchFirehose({ region, cursor, count });
    return NextResponse.json({
      videos: page.videos,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      mode,
      upstream: page.upstream,
      notice: page.notice,
      degraded: page.degraded,
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
