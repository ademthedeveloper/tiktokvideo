import { NextResponse } from "next/server";
import { buildAuthorizeUrl, callbackUrl, envConfig, PublishError } from "@/lib/publish";

export const dynamic = "force-dynamic";

/** Returns (or 302s to) the TikTok OAuth authorize URL. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? Math.random().toString(36).slice(2, 12);
  const redirect = callbackUrl(request);
  const { clientKey } = envConfig();

  if (!clientKey) {
    return NextResponse.json(
      {
        error: "TIKTOK_CLIENT_KEY is not configured",
        authorizeUrl: null,
        redirectUri: redirect,
        setup: [
          "Create an app at developers.tiktok.com and add the Content Posting API product.",
          "Request the scopes video.publish, video.upload and user.info.basic.",
          `Add ${redirect} as an authorized redirect URI in the app settings.`,
          "Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in this project's environment.",
        ],
      },
      { status: 412 },
    );
  }

  try {
    const authorizeUrl = buildAuthorizeUrl(redirect, state);
    if (url.searchParams.get("redirect") === "1") {
      return NextResponse.redirect(authorizeUrl, 302);
    }
    return NextResponse.json({ authorizeUrl, redirectUri: redirect, state });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof PublishError ? err.message : "could not build authorize URL",
        hint: err instanceof PublishError ? err.hint : undefined,
        authorizeUrl: null,
      },
      { status: 412 },
    );
  }
}
