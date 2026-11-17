import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_HOSTS = [
  "tikwm.com",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokv.com",
  "byteoversea.com",
  "musical.ly",
  "tiktok.com",
  "ibytedtos.com",
  "snaptik.app",
];

function isAllowed(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    return ALLOWED_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    )
      ? url
      : null;
  } catch {
    return null;
  }
}

/**
 * Streams TikTok media through the desk so the in-app player, cover images and
 * downloads work without hotlink/referrer problems. Supports range requests.
 */
export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("url") ?? "";
  const download = request.nextUrl.searchParams.get("download") === "1";
  const url = isAllowed(target);
  if (!url) {
    return new Response(JSON.stringify({ error: "Blocked media host" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // TikTok's own /api/video and /api/img endpoints only answer crawler agents.
  const isTikTokApi = url.hostname.endsWith("tiktok.com") && url.pathname.startsWith("/api/");
  const headers: Record<string, string> = {
    "User-Agent": isTikTokApi
      ? "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Referer: "https://www.tiktok.com/",
    Accept: "*/*",
  };
  const range = request.headers.get("range");
  if (range) headers.Range = range;

  const upstream = await fetch(url.toString(), { headers, cache: "no-store" });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response(JSON.stringify({ error: "Upstream media unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const responseHeaders = new Headers();
  const contentType =
    upstream.headers.get("content-type") ??
    (target.includes(".mp4") || !target.match(/\.(jpe?g|png|webp|heic)/i)
      ? "video/mp4"
      : "image/jpeg");
  responseHeaders.set("Content-Type", contentType);
  for (const key of [
    "content-length",
    "content-range",
    "accept-ranges",
    "last-modified",
    "etag",
  ]) {
    const value = upstream.headers.get(key);
    if (value) responseHeaders.set(key, value);
  }
  responseHeaders.set("Accept-Ranges", "bytes");
  responseHeaders.set("Cache-Control", "public, max-age=1800");
  if (download) {
    const name = request.nextUrl.searchParams.get("filename") || "clip.mp4";
    responseHeaders.set(
      "Content-Disposition",
      `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
