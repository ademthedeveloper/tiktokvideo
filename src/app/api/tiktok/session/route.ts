import { NextResponse } from "next/server";
import {
  clearSession,
  describeSession,
  probeUploader,
  saveSession,
  SessionPublishError,
} from "@/lib/session-publish";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/** GET → stored session + which uploader backend is configured. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await describeSession();
  const uploader = url.searchParams.get("probe") === "1" ? await probeUploader() : null;
  return NextResponse.json({ session, uploader });
}

/**
 * PUT → store the sessionid copied from a logged-in browser.
 * Body: { sessionId } or { cookie } (a full cookie header works too).
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const raw = String(body.sessionId ?? body.cookie ?? "").trim();
    if (!raw) {
      return NextResponse.json(
        { error: "Paste your TikTok sessionid (or a full cookie string)" },
        { status: 400 },
      );
    }
    const stored = await saveSession({ sessionId: raw, cookie: raw });
    // Return the masked view — never echo the raw credential back.
    const session = await describeSession();
    const uploader = await probeUploader();
    return NextResponse.json({
      session,
      uploader,
      connected: true,
      message: stored.verified
        ? `Session accepted${stored.username ? ` as @${stored.username}` : ""}.`
        : "Session stored. TikTok would not confirm it, but posting may still work.",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "could not store the session",
        hint: err instanceof SessionPublishError ? err.hint : undefined,
      },
      { status: 400 },
    );
  }
}

/** DELETE → forget the stored sessionid. */
export async function DELETE() {
  try {
    await clearSession();
    return NextResponse.json({ disconnected: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not clear the session" },
      { status: 500 },
    );
  }
}
