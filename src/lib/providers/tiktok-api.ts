/**
 * TikTok's own web JSON API — no middleman, no API key.
 *
 * Datacenter IPs (Vercel, Lambda) are usually fine with tiktok.com itself; it is
 * the third-party mirrors that sit behind bot challenges. This provider talks to
 * the endpoints the website calls, bootstrapping the `ttwid` cookie first the way
 * a browser does.
 *
 * Endpoints (all GET, all on www.tiktok.com):
 *   /api/challenge/detail/    hashtag → challenge id + stats
 *   /api/challenge/item_list/ challenge id → clips
 *   /api/item/detail/         one clip by id
 *   /api/user/detail/         @handle → secUid
 *   /api/post/item_list/      secUid → that creator's clips
 *
 * Some of these accept unsigned requests; some answer 10201/403 when TikTok
 * wants a signature. Every caller treats a failure as "try the next provider",
 * and /api/tiktok/diagnostics reports exactly what worked.
 */

import type { TikTokVideo } from "../types";
import { makeVideo } from "../video-factory";
import { BROWSER_UA, UpstreamError, request, toNumber } from "./net";
import { fromWebItem } from "./tiktok-web";

const ORIGIN = "https://www.tiktok.com";
const PROVIDER = "tiktok.com/api";

/* ── session bootstrap ────────────────────────────────────────── */

let cookieJar = "";
let cookieAt = 0;
let cookieDetail = "not attempted";

function baseHeaders(): Record<string, string> {
  return {
    "User-Agent": BROWSER_UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${ORIGIN}/`,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };
}

/** Common query string the website always sends. */
function baseParams(): Record<string, string> {
  return {
    aid: "1988",
    app_language: "en",
    app_name: "tiktok_web",
    browser_language: "en-US",
    browser_name: "Mozilla",
    browser_platform: "Win32",
    browser_version: BROWSER_UA,
    channel: "tiktok_web",
    cookie_enabled: "true",
    device_platform: "web_pc",
    focus_state: "true",
    history_len: "3",
    is_fullscreen: "false",
    is_page_visible: "true",
    os: "windows",
    priority_region: "US",
    referer: "",
    region: "US",
    screen_height: "1080",
    screen_width: "1920",
    tz_name: "Europe/Istanbul",
    webcast_language: "en",
  };
}

export function webApiCookieHeader(): string {
  const extra = process.env.TIKTOK_COOKIE?.trim();
  return [cookieJar, extra].filter(Boolean).join("; ");
}

/** Grab ttwid/tt_webid_v2 the same way a first visit does. */
export async function ensureWebSession(force = false): Promise<string> {
  if (!force && cookieJar && Date.now() - cookieAt < 10 * 60_000) {
    return webApiCookieHeader();
  }
  try {
    const res = await request(
      `${ORIGIN}/`,
      { headers: baseHeaders() },
      12_000,
      PROVIDER,
    );
    await res.text().catch(() => "");
    const headerBag = res.headers as Headers & { getSetCookie?: () => string[] };
    const raw = headerBag.getSetCookie?.() ?? [];
    const pairs = raw
      .map((cookie) => cookie.split(";")[0]?.trim())
      .filter((cookie): cookie is string => Boolean(cookie && cookie.includes("=")));
    cookieJar = pairs.join("; ");
    cookieAt = Date.now();
    cookieDetail = pairs.length
      ? `session cookies: ${pairs.map((pair) => pair.split("=")[0]).slice(0, 4).join(", ")}`
      : `tiktok.com answered ${res.status} without cookies`;
  } catch (err) {
    cookieDetail = err instanceof Error ? err.message : "session bootstrap failed";
  }
  return webApiCookieHeader();
}

/* ── request helper ───────────────────────────────────────────── */

export type WebApiResult = { statusCode: number; body: any };

async function apiGet(
  path: string,
  params: Record<string, string | number>,
): Promise<any> {
  const cookie = await ensureWebSession();
  const url = new URL(`${ORIGIN}${path}`);
  for (const [key, value] of Object.entries({ ...baseParams(), ...params })) {
    url.searchParams.set(key, String(value));
  }
  const res = await request(
    url.toString(),
    {
      headers: {
        ...baseHeaders(),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    },
    15_000,
    PROVIDER,
  );

  const text = await res.text();
  if (!res.ok) {
    throw new UpstreamError(
      "TikTok's web API refused the request",
      `HTTP ${res.status} on ${path}${text.trim() ? ` · ${text.trim().slice(0, 80)}` : ""}`,
      PROVIDER,
      res.status,
    );
  }
  if (!text.trimStart().startsWith("{")) {
    throw new UpstreamError(
      "TikTok's web API sent a page instead of JSON",
      `HTTP ${res.status} on ${path}`,
      PROVIDER,
      res.status,
    );
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new UpstreamError("TikTok's web API returned malformed data", path, PROVIDER, res.status);
  }

  const statusCode = Number(json?.statusCode ?? json?.status_code ?? 0);
  if (Number.isFinite(statusCode) && statusCode !== 0) {
    throw new UpstreamError(
      `TikTok's web API answered status ${statusCode}`,
      String(json?.statusMsg ?? json?.status_msg ?? path).slice(0, 120),
      PROVIDER,
    );
  }
  return json;
}

/* ── parsing ─────────────────────────────────────────────────── */

export function parseChallengeVideos(
  payload: any,
  tag: string,
  count = 30,
): TikTokVideo[] {
  const items: any[] = Array.isArray(payload?.itemList)
    ? payload.itemList
    : Array.isArray(payload?.item_list)
      ? payload.item_list
      : [];
  const videos: TikTokVideo[] = [];
  for (const item of items.slice(0, count)) {
    const video = fromWebItem(item, "search");
    if (!video) continue;
    video.matchedTag = tag;
    videos.push(video);
  }
  return videos;
}

export function parseChallengeInfo(payload: any): {
  id: string | null;
  title: string | null;
  videoCount: number | null;
  viewCount: number | null;
} {
  const info = payload?.challengeInfo ?? payload;
  const challenge = info?.challenge ?? {};
  return {
    id: challenge.id ? String(challenge.id) : null,
    title: challenge.title ? String(challenge.title) : null,
    videoCount: toNumber(info?.stats?.videoCount ?? challenge?.stats?.videoCount),
    viewCount: toNumber(info?.stats?.viewCount ?? challenge?.stats?.viewCount),
  };
}

export function parseItemDetail(payload: any): TikTokVideo | null {
  const item =
    payload?.itemInfo?.itemStruct ??
    payload?.itemInfo?.itemStruct ??
    payload?.item_list?.[0] ??
    payload?.itemList?.[0] ??
    null;
  return item ? fromWebItem(item, "link") : null;
}

/* ── public calls ────────────────────────────────────────────── */

export async function challengeVideos(opts: {
  tag: string;
  count?: number;
  cursor?: number;
}): Promise<{ videos: TikTokVideo[]; challengeId: string; hasMore: boolean }> {
  const tag = opts.tag.replace(/^#/, "").trim();
  if (!tag) throw new UpstreamError("Empty hashtag", "", PROVIDER);
  const count = Math.min(30, Math.max(1, opts.count ?? 12));
  const cursor = Math.max(0, opts.cursor ?? 0);

  const detail = await apiGet("/api/challenge/detail/", { challengeName: tag });
  const info = parseChallengeInfo(detail);
  if (!info.id) {
    throw new UpstreamError(`#${tag} is not a hashtag TikTok knows`, "no challenge id", PROVIDER);
  }

  const list = await apiGet("/api/challenge/item_list/", {
    challengeID: info.id,
    challengeName: tag,
    count,
    cursor,
  });
  return {
    videos: parseChallengeVideos(list, tag, count),
    challengeId: info.id,
    hasMore: Boolean(list?.hasMore ?? list?.has_more),
  };
}

export async function videoDetail(id: string): Promise<TikTokVideo | null> {
  const payload = await apiGet("/api/item/detail/", { itemId: id });
  const video = parseItemDetail(payload);
  if (!video) return null;
  return makeVideo({ ...video, id: video.id || id });
}

export async function creatorVideos(opts: {
  username: string;
  count?: number;
  cursor?: number;
}): Promise<TikTokVideo[]> {
  const username = opts.username.replace(/^@/, "").trim();
  const count = Math.min(30, Math.max(1, opts.count ?? 12));
  const cursor = Math.max(0, opts.cursor ?? 0);
  const profile = await apiGet("/api/user/detail/", { uniqueId: username });
  const user = profile?.userInfo?.user ?? profile?.userInfo?.userStruct ?? {};
  const secUid = String(user?.secUid ?? user?.sec_uid ?? "").trim();
  if (!secUid) {
    throw new UpstreamError(`@${username} not found`, "no secUid in the profile answer", PROVIDER);
  }
  const list = await apiGet("/api/post/item_list/", { secUid, count, cursor });
  const items: any[] = Array.isArray(list?.itemList) ? list.itemList : [];
  const videos: TikTokVideo[] = [];
  for (const item of items.slice(0, count)) {
    const video = fromWebItem(item, "search");
    if (!video) continue;
    video.matchedTag = username.toLowerCase();
    videos.push(video);
  }
  return videos;
}

/* ── diagnostics ─────────────────────────────────────────────── */

export async function webApiCheck(): Promise<{
  ok: boolean;
  latencyMs: number;
  detail: string;
}> {
  const started = Date.now();
  try {
    const detail = await apiGet("/api/challenge/detail/", { challengeName: "fyp" });
    const info = parseChallengeInfo(detail);
    if (!info.id) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: `reachable but #fyp has no id · ${cookieDetail}`,
      };
    }
    try {
      const list = await apiGet("/api/challenge/item_list/", {
        challengeID: info.id,
        count: 3,
        cursor: 0,
      });
      const videos = parseChallengeVideos(list, "fyp", 3);
      return {
        ok: videos.length > 0,
        latencyMs: Date.now() - started,
        detail: videos.length
          ? `#fyp → ${videos.length} clips · ${cookieDetail}`
          : `hashtag exists, item list empty · ${cookieDetail}`,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: `challenge ok (id ${info.id}) but item list failed: ${
          err instanceof Error ? err.message : "error"
        }`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: err instanceof UpstreamError && err.detail
        ? `${err.message} — ${err.detail}`
        : err instanceof Error
          ? err.message
          : "unreachable",
    };
  }
}
