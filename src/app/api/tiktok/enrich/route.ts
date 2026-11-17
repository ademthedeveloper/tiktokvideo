import { NextResponse } from "next/server";
import { enrichVideo, UpstreamError } from "@/lib/tiktok";
import type { TikTokVideo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Swap in a watermark-free MP4 / HD link for a clip found by search. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { video?: TikTokVideo; id?: string; url?: string };
    if (!body.video?.id) {
      return NextResponse.json({ error: "Missing clip payload" }, { status: 400 });
    }
    const outcome = await enrichVideo(body.video);
    return NextResponse.json({
      video: outcome.video,
      enriched: outcome.enriched,
      provider: outcome.provider,
      reason: outcome.reason,
    });
  } catch (err) {
    const message =
      err instanceof UpstreamError ? err.message : err instanceof Error ? err.message : "failed";
    return NextResponse.json({ error: message, enriched: false }, { status: 502 });
  }
}
