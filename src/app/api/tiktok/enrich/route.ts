import { NextResponse } from "next/server";
import { enrichVideo } from "@/lib/tiktok";
import { UpstreamError } from "@/lib/tiktok";
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
    const enriched = await enrichVideo(body.video);
    return NextResponse.json({ video: enriched, enriched: true });
  } catch (err) {
    const message =
      err instanceof UpstreamError ? err.message : err instanceof Error ? err.message : "failed";
    return NextResponse.json({ error: message, enriched: false }, { status: 502 });
  }
}
