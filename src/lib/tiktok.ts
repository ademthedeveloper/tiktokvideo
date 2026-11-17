import type { FetchMode, TikTokVideo } from "./types";
import { makeVideo } from "./video-factory";

const TIKWM = "https://www.tikwm.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export class UpstreamError extends Error {
  detail: string;
  constructor(message: string, detail = "") {
    super(message);
    this.name = "UpstreamError";
    this.detail = detail;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CacheEntry = { at: number; value: unknown };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 45_000;

function cached<T>(key: string, ttl = CACHE_TTL): T | null {
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
  if (cache.size > 120) {
    const oldest = [...cache.keys()].slice(0, 20);
    oldest.forEach((k) => cache.delete(k));
  }
}

/* tikwm's free tier tolerates roughly one call a second; spacing requests here
   keeps batches of links and scan pages from being dropped. */
let lastCallAt = 0;
const MIN_SPACING_MS = 720;

async function throttle() {
  const wait = Math.min(5000, Math.max(0, lastCallAt + MIN_SPACING_MS - Date.now()));
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

const TRANSIENT = /oops|try again|error occurred|timeout|too many|rate/i;

/** tikwm only answers reliably to form-encoded POSTs on these paths. */
async function postForm(
  path: string,
  form: Record<string, string | number>,
  timeoutMs = 22_000,
  attempts = 3,
): Promise<any> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) body.set(key, String(value));
  let lastMessage = "Upstream did not answer";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${TIKWM}${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": UA,
          Accept: "application/json",
        },
        body: body.toString(),
        cache: "no-store",
      });
      const text = await res.text();
      if (text.trimStart().startsWith("<")) {
        throw new UpstreamError(
          "Upstream is behind a bot challenge right now",
          `challenge on ${path}`,
        );
      }
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new UpstreamError("Upstream returned malformed data", text.slice(0, 160));
      }
      if (json?.code === 0) return json.data;

      const msg = String(json?.msg ?? `code ${json?.code ?? "?"}`);
      lastMessage = msg;
      // Permanent client errors are not worth retrying.
      if (!TRANSIENT.test(msg)) throw new UpstreamError(msg, path);
    } catch (err) {
      if (err instanceof UpstreamError && !TRANSIENT.test(err.message)) throw err;
      lastMessage = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) await sleep(700 * attempt);
  }

  throw new UpstreamError(lastMessage, path);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalise(raw: any, source: FetchMode, base?: TikTokVideo): TikTokVideo | null {
  if (!raw) return null;
  const id = String(raw.id ?? raw.video_id ?? raw.aweme_id ?? "").trim();
  if (!id) return null;
  const author = raw.author ?? {};
  const music = raw.music_info ?? raw.music ?? {};
  const username = String(author.unique_id ?? author.uniqueId ?? "").trim();
  const nickname = String(author.nickname ?? author.nick_name ?? "").trim();
  const cover = raw.cover ?? raw.origin_cover ?? null;
  const playUrl = raw.play ? absolutise(raw.play) : null;
  const shareUrl =
    raw.share_url ??
    (username
      ? `https://www.tiktok.com/@${username}/video/${id}`
      : `https://www.tiktok.com/video/${id}`);
  const created = num(raw.create_time);

  return makeVideo({
    ...(base ?? {}),
    id,
    caption: base?.caption?.trim() ? base.caption : String(raw.title ?? "").trim(),
    authorUsername: username || base?.authorUsername || "unknown",
    authorNickname: nickname || username || base?.authorNickname || "unknown creator",
    authorAvatar: author.avatar ?? base?.authorAvatar ?? null,
    coverUrl: cover ? absolutise(cover) : base?.coverUrl ?? null,
    originCoverUrl: raw.origin_cover ? absolutise(raw.origin_cover) : base?.originCoverUrl ?? null,
    playUrl: playUrl ?? base?.playUrl ?? null,
    ttPlayUrl: base?.ttPlayUrl ?? playUrl,
    hdPlayUrl: raw.hdplay ? absolutise(raw.hdplay) : playUrl,
    wmPlayUrl: raw.wmplay ? absolutise(raw.wmplay) : null,
    shareUrl,
    musicTitle: music.title ? String(music.title) : base?.musicTitle ?? null,
    musicAuthor: music.author ? String(music.author) : base?.musicAuthor ?? null,
    musicUrl: music.play ? absolutise(music.play) : null,
    durationSec: num(raw.duration) ?? base?.durationSec ?? null,
    region: raw.region ? String(raw.region) : base?.region ?? null,
    postedAt: created ? new Date(created * 1000).toISOString() : base?.postedAt ?? null,
    playCount: num(raw.play_count) ?? base?.playCount ?? null,
    diggCount: num(raw.digg_count) ?? base?.diggCount ?? null,
    commentCount: num(raw.comment_count) ?? base?.commentCount ?? null,
    shareCount: num(raw.share_count) ?? base?.shareCount ?? null,
    source: base?.source ?? source,
    matchedTag: base?.matchedTag ?? null,
    fetchedAt: new Date().toISOString(),
    enriched: true,
    rank: base?.rank ?? 0,
  });
}

/** tikwm sometimes answers with protocol-relative or bare paths. */
function absolutise(url: string): string {
  if (!url) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${TIKWM}${url}`;
  return url;
}

function itemsOf(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.videos)) return data.videos;
  if (Array.isArray(data?.item_list)) return data.item_list;
  if (data && typeof data === "object" && (data.id || data.video_id)) return [data];
  return [];
}

export type FirehosePage = {
  videos: TikTokVideo[];
  nextCursor: number;
  hasMore: boolean;
};

export async function fetchFirehose(opts: {
  region: string;
  cursor?: number;
  count?: number;
}): Promise<FirehosePage> {
  const region = (opts.region || "US").toUpperCase();
  const count = Math.min(30, Math.max(1, opts.count ?? 20));
  const cursor = Math.max(0, opts.cursor ?? 0);
  const key = `feed:${region}:${cursor}:${count}`;
  const hit = cached<FirehosePage>(key, 60_000);
  if (hit) return hit;

  const data = await postForm("/api/feed/list", { region, count, cursor });
  const list = itemsOf(data);
  const videos = list
    .map((raw) => normalise(raw, "firehose"))
    .filter((v): v is TikTokVideo => Boolean(v));
  const page: FirehosePage = {
    videos,
    nextCursor: cursor + count,
    hasMore: videos.length > 0,
  };
  remember(key, page);
  return page;
}

export async function resolveLink(url: string): Promise<TikTokVideo> {
  const trimmed = url.trim();
  if (!trimmed) throw new UpstreamError("Empty link");
  const key = `link:${trimmed}`;
  const hit = cached<TikTokVideo>(key, 120_000);
  if (hit) return hit;

  const data = await postForm("/api/", { url: trimmed, hd: 1, count: 1 });
  const video = normalise(itemsOf(data)[0] ?? data, "link");
  if (!video) throw new UpstreamError("That link did not resolve to a video", trimmed);
  remember(key, video);
  return video;
}

export async function resolveLinks(links: string[]): Promise<{
  videos: TikTokVideo[];
  failures: { link: string; reason: string }[];
}> {
  const videos: TikTokVideo[] = [];
  const failures: { link: string; reason: string }[] = [];
  for (const [index, link] of links.entries()) {
    if (index > 0) await sleep(140);
    try {
      videos.push(await resolveLink(link));
    } catch (err) {
      failures.push({
        link,
        reason: err instanceof Error ? err.message : "unknown error",
      });
    }
  }
  return { videos, failures };
}

/**
 * Enrich one clip (usually a search hit) with a watermark-free MP4 + HD link
 * from tikwm. Search results already carry metadata, so this is additive.
 */
export async function enrichVideo(base: TikTokVideo): Promise<TikTokVideo> {
  const key = `link:${base.shareUrl}`;
  const hit = cached<TikTokVideo>(key, 180_000);
  if (hit) return hit;
  try {
    const data = await postForm("/api/", { url: base.shareUrl, hd: 1, count: 1 }, 25_000, 2);
    const merged = normalise(itemsOf(data)[0] ?? data, base.source, base);
    if (!merged) throw new UpstreamError("No data returned for that clip");
    remember(key, merged);
    return merged;
  } catch (err) {
    const message = err instanceof Error ? err.message : "enrich failed";
    throw new UpstreamError(
      `Could not resolve a watermark-free file (${message})`,
      base.id,
    );
  }
}

export async function pingUpstream(): Promise<{
  ok: boolean;
  latencyMs: number;
  detail: string;
}> {
  const started = Date.now();
  try {
    const page = await fetchFirehose({ region: "US", count: 1 });
    return {
      ok: page.videos.length > 0,
      latencyMs: Date.now() - started,
      detail: page.videos.length ? "live" : "empty response",
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : "unreachable",
    };
  }
}

export { REGIONS, extractTikTokLinks, proxiedMedia } from "./tiktok-client";
