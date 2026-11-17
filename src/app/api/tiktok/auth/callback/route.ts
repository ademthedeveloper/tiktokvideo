import { NextResponse } from "next/server";
import { callbackUrl, exchangeCode, PublishError } from "@/lib/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** TikTok redirects the creator back here after they approve the scopes. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const home = new URL("/", url.origin);

  if (error) {
    home.searchParams.set("tiktok", "denied");
    home.searchParams.set("tiktok_reason", url.searchParams.get("error_description") ?? error);
    return NextResponse.redirect(home.toString(), 302);
  }
  if (!code) {
    home.searchParams.set("tiktok", "missing_code");
    return NextResponse.redirect(home.toString(), 302);
  }

  try {
    const tokens = await exchangeCode(code, callbackUrl(request));
    home.searchParams.set("tab", "publish");
    home.searchParams.set("tiktok", "connected");
    home.searchParams.set(
      "tiktok_scope",
      String(tokens.scope ?? "").slice(0, 120),
    );
    return NextResponse.redirect(home.toString(), 302);
  } catch (err) {
    home.searchParams.set("tab", "publish");
    home.searchParams.set("tiktok", "failed");
    home.searchParams.set(
      "tiktok_reason",
      encodeURIComponent(
        err instanceof PublishError
          ? `${err.message}${err.hint ? ` — ${err.hint}` : ""}`
          : err instanceof Error
            ? err.message
            : "unknown error",
      ).slice(0, 300),
    );
    return NextResponse.redirect(home.toString(), 302);
  }
}
