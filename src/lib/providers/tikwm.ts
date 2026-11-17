/**
 * tikwm.com — the free, key-less TikTok middleman this desk leans on.
 *
 * Its endpoints answer to both GET and POST, and different deployments/mirrors
 * accept one or the other, so every call here tries GET first and falls back to
 * the form-encoded POST the old code assumed was the only way in.
 *
 * Endpoints used:
 *   /api/                 single video by URL or aweme id
 *   /api/feed/search      keyword / hashtag search   (the search fix)
 *   /api/feed/list        region firehose
 *   /api/user/posts       one creator's clips (used for @handle searches)
 */

import type { FetchMode, TikTokVideo } from "../types";
import { makeVideo } from "../video-factory";
import {
  BROWSER_UA,
  UpstreamError,
  absolutise,
  looksLikeHtml,
  request,
  sleep,
  toIsoDate,
  toNumber,
} from "./net";

const DEFAULT_BASE = "https://www.tikwm.com";
const PROVIDER = "tikwm";

/** Point this at a mirror (or your own deploy) with TIKWM_BASE_URL. */
export function tikwmBase(): string {
  const configured = process.env.TIKWM_BASE_URL?.trim();
  return (configured || DEFAULT_BASE).replace(/\/+$/, "");
}

export function tikwmConfiguredBase(): string {
  return tikwmBase();
}

type CacheEntry = { at: number; value: unknown };
const cache = new Map<string, CacheEntry>();

function cached<T>(key: string, ttl: number): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function remember(key: string, value: unknown) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) {
    for (const key of [...cache.keys()].slice(0, 40)) cache.delete(key);
  }
}

/* tikwm's free tier tolerates roughly one call a second. */
let lastCallAt = 0;
const MIN_SPACING_MS = 700;

async function throttle() {
  const wait = Math.min(4000, Math.max(0, lastCallAt + MIN_SPACING_MS - Date.now()));
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

const TRANSIENT = /oops|try again|error occurred|timeout|timed out|too many|rate|busy|unavailable|limit/i;

type CallOptions = {
  timeoutMs?: number;
  ttl?: number;
  attempts?: number;
};

/**
 * One tikwm call: GET → POST fallback, retries on transient answers, and a
 * `code: 0` unwrap. Throws UpstreamError with the upstream's own message.
 */
async function call<T = any>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  options: CallOptions = {},
): Promise<T> {
  const { timeoutMs = 14_000, ttl = 60_000, attempts = 2 } = options;
  const base = tikwmBase();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }
  const key = `tikwm:${base}${path}?${query.toString()}`;
  const hit = cached<T>(key, ttl);
  if (hit) return hit;

  let lastError: UpstreamError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await throttle();
    for (const method of ["GET", "POST"] as const) {
      const url =
        method === "GET" && query.toString()
          ? `${base}${path}?${query.toString()}`
          : `${base}${path}`;
      let res: Response;
      try {
        res = await request(
          url,
          {
            method,
            headers: {
              "User-Agent": BROWSER_UA,
              Accept: "application/json, text/plain, */*",
              "Accept-Language": "en-US,en;q=0.9",
              Referer: `${base}/`,
              ...(method === "POST"
                ? { "Content-Type": "application/x-www-form-urlencoded" }
                : {}),
            },
            body: method === "POST" ? query.toString() : undefined,
          },
          timeoutMs,
          PROVIDER,
        );
      } catch (err) {
        lastError = err instanceof UpstreamError ? err : new UpstreamError(String(err), "", PROVIDER);
        continue;
      }

      const text = await res.text();
      if (looksLikeHtml(text)) {
        lastError = new UpstreamError(
          "tikwm is serving a bot-challenge page",
          `HTTP ${res.status} on ${path}`,
          PROVIDER,
          res.status,
        );
        continue;
      }

      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        lastError = new UpstreamError(
          "tikwm returned malformed data",
          text.trim().slice(0, 140) || `HTTP ${res.status}`,
          PROVIDER,
          res.status,
        );
        continue;
      }

      const code = json?.code;
      if (code === 0 || code === "0") return json.data as T;

      const message = String(json?.msg ?? json?.message ?? `code ${code ?? "?"}`).trim();
      if (!/free api|limit|quota/i.test(message) && shouldRetry(message) === false) {
        throw new UpstreamError(message || "tikwm rejected the request", path, PROVIDER, res.status);
      }
      lastError = new UpstreamError(
        message || "tikwm rejected the request",
        `${path} · HTTP ${res.status}`,
        PROVIDER,
        res.status,
      );
    }

    if (lastError && TRANSIENT.test(lastError.message) && attempt < attempts) {
      await sleep(600 * attempt);
      continue;
    }
    if (attempt < attempts) await sleep(400 * attempt);
  }

  throw (
    lastError ??
    new UpstreamError("tikwm did not answer", `${base}${path}`, PROVIDER)
  );
}

function shouldRetry(message: string): boolean {
  return TRANSIENT.test(message);
}

function num(value: unknown): number | null {
  return toNumber(value);
}

function itemsOf(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.videos)) return data.videos;
  if (Array.isArray(data.item_list)) return data.item_list;
  if (Array.isArray(data.items)) return data.items;
  if (typeof data === "object" && (data.id || data.video_id || data.aweme_id)) return [data];
  return [];
}

/** tikwm item → our normalised clip shape. */
export function fromTikwm(
  raw: any,
  source: FetchMode,
  base?: TikTokVideo,
): TikTokVideo | null {
  if (!raw) return null;
  const id = String(raw.id ?? raw.video_id ?? raw.aweme_id ?? base?.id ?? "").trim();
  if (!id) return null;

  const author = raw.author ?? {};
  const music = raw.music_info ?? raw.music ?? {};
  const stats = raw.stats ?? raw.statistics ?? {};
  const username = String(
    author.unique_id ?? author.uniqueId ?? author.uniqueIdStr ?? base?.authorUsername ?? "",
  ).trim();
  const nickname = String(author.nickname ?? author.nick_name ?? author.nickName ?? "").trim();

  const origin = tikwmBase();
  const cover = raw.cover ?? raw.origin_cover ?? raw.dynamic_cover ?? null;
  const play = raw.play ? absolutise(raw.play, origin) : null;
  const hd = raw.hdplay ? absolutise(raw.hdplay, origin) : null;
  const wm = raw.wmplay ? absolutise(raw.wmplay, origin) : null;
  const created = raw.create_time ?? raw.createTime;

  return makeVideo({
    ...(base ?? {}),
    id,
    caption: base?.caption?.trim()
      ? base.caption
      : String(raw.title ?? raw.desc ?? "").trim() || base?.caption || "",
    authorUsername: username || base?.authorUsername || "unknown",
    authorNickname: nickname || username || base?.authorNickname || "unknown creator",
    authorAvatar: author.avatar ?? author.avatar_thumb ?? base?.authorAvatar ?? null,
    coverUrl: cover ? absolutise(cover, origin) : base?.coverUrl ?? null,
    originCoverUrl: raw.origin_cover
      ? absolutise(raw.origin_cover, origin)
      : base?.originCoverUrl ?? null,
    playUrl: play ?? base?.playUrl ?? null,
    ttPlayUrl: base?.ttPlayUrl ?? play ?? null,
    hdPlayUrl: hd ?? play ?? base?.hdPlayUrl ?? null,
    wmPlayUrl: wm ?? base?.wmPlayUrl ?? null,
    shareUrl:
      raw.share_url ??
      (username
        ? `https://www.tiktok.com/@${username}/video/${id}`
        : base?.shareUrl ?? `https://www.tiktok.com/video/${id}`),
    musicTitle: music.title ? String(music.title) : base?.musicTitle ?? null,
    musicAuthor: music.author ? String(music.author) : base?.musicAuthor ?? null,
    musicUrl: music.play ? absolutise(music.play, origin) : base?.musicUrl ?? null,
    durationSec: num(raw.duration) ?? base?.durationSec ?? null,
    region: raw.region ? String(raw.region) : base?.region ?? null,
    postedAt: toIsoDate(created) ?? base?.postedAt ?? null,
    playCount: num(raw.play_count) ?? num(stats.playCount) ?? base?.playCount ?? null,
    diggCount: num(raw.digg_count) ?? num(stats.diggCount) ?? base?.diggCount ?? null,
    commentCount: num(raw.comment_count) ?? num(stats.commentCount) ?? base?.commentCount ?? null,
    shareCount: num(raw.share_count) ?? num(stats.shareCount) ?? base?.shareCount ?? null,
    saveCount: num(raw.collect_count) ?? num(stats.collectCount) ?? base?.saveCount ?? null,
    width: num(raw.width) ?? base?.width ?? null,
    height: num(raw.height) ?? base?.height ?? null,
    source: base?.source ?? source,
    matchedTag: base?.matchedTag ?? null,
    fetchedAt: new Date().toISOString(),
    enriched: source !== "search" || Boolean(hd ?? play),
    rank: base?.rank ?? 0,
  });
}

/* ── public calls ───────────────────────────────────────────────── */

type Timing = { timeoutMs?: number; attempts?: number };

export async function tikwmDetail(linkOrId: string, hd = true, timing: Timing = {}): Promise<any> {
  const data = await call(
    "/api/",
    { url: linkOrId, hd: hd ? 1 : 0 },
    { ttl: 90_000, timeoutMs: timing.timeoutMs ?? 14_000, attempts: timing.attempts ?? 2 },
  );
  return itemsOf(data)[0] ?? data;
}

export async function tikwmSearch(opts: {
  keywords: string;
  count?: number;
  cursor?: number;
  region?: string;
  timeoutMs?: number;
  attempts?: number;
}): Promise<{ raw: any[]; cursor: number; hasMore: boolean }> {
  const count = Math.min(30, Math.max(1, opts.count ?? 12));
  const cursor = Math.max(0, opts.cursor ?? 0);
  const data = await call(
    "/api/feed/search",
    {
      keywords: opts.keywords,
      count,
      cursor,
      region: opts.region?.toUpperCase(),
    },
    { ttl: 60_000, timeoutMs: opts.timeoutMs ?? 14_000, attempts: opts.attempts ?? 2 },
  );
  return {
    raw: itemsOf(data),
    cursor: Number(data?.cursor ?? cursor + count) || cursor + count,
    hasMore: Boolean(data?.hasMore ?? data?.has_more ?? itemsOf(data).length >= count),
  };
}

export async function tikwmFeed(opts: {
  region: string;
  count?: number;
  cursor?: number;
  timeoutMs?: number;
  attempts?: number;
}): Promise<{ raw: any[]; cursor: number; hasMore: boolean }> {
  const count = Math.min(30, Math.max(1, opts.count ?? 20));
  const cursor = Math.max(0, opts.cursor ?? 0);
  const data = await call(
    "/api/feed/list",
    { region: opts.region.toUpperCase(), count, cursor },
    { ttl: 45_000, timeoutMs: opts.timeoutMs ?? 14_000, attempts: opts.attempts ?? 2 },
  );
  const list = itemsOf(data);
  return { raw: list, cursor: cursor + count, hasMore: list.length > 0 };
}

export async function tikwmUserPosts(opts: {
  uniqueId: string;
  count?: number;
  cursor?: number;
}): Promise<{ raw: any[]; cursor: number; hasMore: boolean }> {
  const count = Math.min(30, Math.max(1, opts.count ?? 20));
  const cursor = Math.max(0, opts.cursor ?? 0);
  const data = await call(
    "/api/user/posts",
    { unique_id: opts.uniqueId.replace(/^@/, ""), count, cursor },
    { ttl: 90_000 },
  );
  const list = itemsOf(data);
  return { raw: list, cursor: cursor + count, hasMore: list.length > 0 };
}

export async function tikwmMusicPosts(opts: {
  musicId: string;
  count?: number;
  cursor?: number;
}): Promise<{ raw: any[]; cursor: number; hasMore: boolean }> {
  const count = Math.min(30, Math.max(1, opts.count ?? 20));
  const cursor = Math.max(0, opts.cursor ?? 0);
  const data = await call(
    "/api/music/posts",
    { music_id: opts.musicId, count, cursor },
    { ttl: 90_000 },
  );
  return { raw: itemsOf(data), cursor: cursor + count, hasMore: itemsOf(data).length > 0 };
}

export async function tikwmPing(): Promise<{
  ok: boolean;
  latencyMs: number;
  detail: string;
  base: string;
}> {
  const started = Date.now();
  const base = tikwmBase();
  try {
    const data = await call<any>("/api/feed/list", { region: "US", count: 1 }, {
      ttl: 0,
      timeoutMs: 10_000,
      attempts: 1,
    });
    const count = itemsOf(data).length;
    return {
      ok: count > 0,
      latencyMs: Date.now() - started,
      detail: count > 0 ? `live · ${base}` : `answered but empty · ${base}`,
      base,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: err instanceof UpstreamError ? `${err.message}${err.detail ? ` (${err.detail})` : ""}` : String(err),
      base,
    };
  }
}
