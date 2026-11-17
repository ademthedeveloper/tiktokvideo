/**
 * Direct tiktok.com reads — no key, no developer app, no middleman.
 *
 * Three public surfaces, cheapest first:
 *   1. /oembed            metadata only, but very stable
 *   2. /embed/v2/<id>     real playable MP4 URLs, no cookies needed
 *   3. the video/tag page  `__UNIVERSAL_DATA_FOR_REHYDRATION__` (+ legacy JSON-LD)
 *
 * A logged-in cookie (TIKTOK_COOKIE or the sessionid stored for posting) is
 * sent along when present, which gets past most of the "empty page" answers.
 */

import type { TikTokVideo } from "../types";
import { makeVideo } from "../video-factory";
import {
  BROWSER_UA,
  CRAWLER_UA,
  MOBILE_UA,
  UpstreamError,
  absolutise,
  deepFind,
  fetchViaRelays,
  readScriptJson,
  request,
  toIsoDate,
  toNumber,
} from "./net";

const PROVIDER = "tiktok.com";
const ORIGIN = "https://www.tiktok.com";

/* ── cookies ────────────────────────────────────────────────────── */

export function cookieHeaderFrom(input?: string | null): string {
  const parts: string[] = [];
  const env = process.env.TIKTOK_COOKIE?.trim();
  if (env) parts.push(env.replace(/^cookie:\s*/i, ""));
  const extra = input?.trim();
  if (extra) {
    if (/sessionid=/.test(extra)) parts.push(extra.replace(/^cookie:\s*/i, ""));
    else parts.push(`sessionid=${extra}`);
  }
  return parts.join("; ");
}

function headers(cookie?: string | null, mode: "browser" | "mobile" | "crawler" = "browser") {
  const ua = mode === "mobile" ? MOBILE_UA : mode === "crawler" ? CRAWLER_UA : BROWSER_UA;
  const cookieValue = cookieHeaderFrom(cookie);
  return {
    "User-Agent": ua,
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${ORIGIN}/`,
    ...(cookieValue ? { Cookie: cookieValue } : {}),
  } as Record<string, string>;
}

/* ── ids and links ──────────────────────────────────────────────── */

export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{15,25}$/.test(trimmed)) return trimmed;
  const match = /\/(?:video|v|photo)\/(\d{15,25})/.exec(trimmed);
  if (match) return match[1];
  const bare = /(?:^|[^\d])(\d{15,25})(?:[^\d]|$)/.exec(trimmed);
  return bare ? bare[1] : null;
}

export function extractUsername(input: string): string | null {
  const match = /tiktok\.com\/@([A-Za-z0-9._-]+)/.exec(input);
  return match ? match[1] : null;
}

/** vm.tiktok.com / vt.tiktok.com short links → canonical URL. */
export async function expandShortLink(url: string, cookie?: string | null): Promise<string> {
  if (!/vm\.|vt\./i.test(url)) return url;
  try {
    const res = await request(
      url,
      { method: "GET", headers: headers(cookie, "mobile") },
      8000,
      PROVIDER,
    );
    // Drain so the connection can be reused; the redirect target is what matters.
    await res.text().catch(() => "");
    return res.url || url;
  } catch {
    return url;
  }
}

/* ── item → TikTokVideo ─────────────────────────────────────────── */

function firstUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstUrl(entry);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["urlList", "url_list", "urls", "UrlList", "url", "src"]) {
      const found = firstUrl(record[key]);
      if (found) return found;
    }
  }
  return null;
}

function statsOf(item: any) {
  const stats = item?.stats ?? item?.statsV2 ?? item?.statistics ?? {};
  return {
    play: toNumber(stats.playCount ?? stats.play_count ?? stats.playCountV2),
    digg: toNumber(stats.diggCount ?? stats.digg_count ?? stats.diggCountV2),
    comment: toNumber(stats.commentCount ?? stats.comment_count),
    share: toNumber(stats.shareCount ?? stats.share_count),
    save: toNumber(stats.collectCount ?? stats.collect_count),
  };
}

/** Standard TikTok item struct (from video pages / item detail). */
export function fromWebItem(
  item: any,
  source: TikTokVideo["source"] = "link",
  base?: TikTokVideo,
): TikTokVideo | null {
  if (!item) return null;
  const id = String(item.id ?? item.itemId ?? item.aweme_id ?? base?.id ?? "").trim();
  if (!id) return null;
  const video = item.video ?? {};
  const author = item.author ?? {};
  const music = item.music ?? {};
  const stats = statsOf(item);

  const play = firstUrl(video.playAddr) ?? firstUrl(video.play_addr) ?? firstUrl(video.downloadAddr);
  const hd = firstUrl(video.bitrateInfo) ?? firstUrl(video.playAddr) ?? null;
  const cover = firstUrl(video.originCover) ?? firstUrl(video.cover) ?? firstUrl(video.dynamicCover);
  const username = String(author.uniqueId ?? author.unique_id ?? base?.authorUsername ?? "").trim();

  return makeVideo({
    ...(base ?? {}),
    id,
    caption: String(item.desc ?? item.itemDesc ?? base?.caption ?? "").trim() || base?.caption || "",
    authorUsername: username || base?.authorUsername || "unknown",
    authorNickname: String(author.nickname ?? base?.authorNickname ?? "").trim() || username || "unknown creator",
    authorAvatar: firstUrl(author.avatarThumb ?? author.avatarMedium ?? author.avatarLarger) ?? base?.authorAvatar ?? null,
    coverUrl: cover ?? base?.coverUrl ?? null,
    originCoverUrl: firstUrl(video.originCover) ?? base?.originCoverUrl ?? null,
    playUrl: play ?? base?.playUrl ?? null,
    ttPlayUrl: play ?? base?.ttPlayUrl ?? null,
    hdPlayUrl: hd ?? base?.hdPlayUrl ?? null,
    wmPlayUrl: firstUrl(video.downloadAddr) ?? base?.wmPlayUrl ?? null,
    shareUrl:
      (username ? `${ORIGIN}/@${username}/video/${id}` : null) ??
      base?.shareUrl ??
      `${ORIGIN}/video/${id}`,
    musicTitle: music.title ? String(music.title) : base?.musicTitle ?? null,
    musicAuthor: music.authorName ? String(music.authorName) : base?.musicAuthor ?? null,
    musicUrl: firstUrl(music.playUrl) ?? base?.musicUrl ?? null,
    durationSec: toNumber(video.duration) ?? base?.durationSec ?? null,
    region: item.locationCreated ? String(item.locationCreated) : base?.region ?? null,
    postedAt: toIsoDate(item.createTime ?? item.create_time) ?? base?.postedAt ?? null,
    playCount: stats.play ?? base?.playCount ?? null,
    diggCount: stats.digg ?? base?.diggCount ?? null,
    commentCount: stats.comment ?? base?.commentCount ?? null,
    shareCount: stats.share ?? base?.shareCount ?? null,
    saveCount: stats.save ?? base?.saveCount ?? null,
    width: toNumber(video.width) ?? base?.width ?? null,
    height: toNumber(video.height) ?? base?.height ?? null,
    matchedTag: base?.matchedTag ?? null,
    source: base?.source ?? source,
    fetchedAt: new Date().toISOString(),
    enriched: Boolean(play ?? base?.playUrl),
    rank: base?.rank ?? 0,
  });
}

/* ── 1. oEmbed ──────────────────────────────────────────────────── */

export type OEmbedInfo = {
  title: string;
  authorName: string;
  authorUsername: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
};

export async function oembed(url: string): Promise<OEmbedInfo | null> {
  const endpoint = `${ORIGIN}/oembed?url=${encodeURIComponent(url)}`;
  try {
    const res = await request(
      endpoint,
      { headers: headers(null, "browser") },
      9000,
      PROVIDER,
    );
    if (!res.ok) return null;
    const json: any = await res.json();
    const authorUrl = String(json?.author_url ?? "");
    const username = /@([A-Za-z0-9._-]+)/.exec(authorUrl)?.[1] ?? null;
    return {
      title: String(json?.title ?? ""),
      authorName: String(json?.author_name ?? ""),
      authorUsername: username,
      thumbnailUrl: json?.thumbnail_url ? String(json.thumbnail_url) : null,
      width: toNumber(json?.width),
      height: toNumber(json?.height),
    };
  } catch {
    return null;
  }
}

/* ── 2. embed player ────────────────────────────────────────────── */

export async function embedVideo(
  id: string,
  cookie?: string | null,
): Promise<TikTokVideo | null> {
  const res = await request(
    `${ORIGIN}/embed/v2/${id}`,
    { headers: headers(cookie, "browser") },
    12_000,
    PROVIDER,
  );
  if (!res.ok) {
    throw new UpstreamError(
      "tiktok.com embed refused the clip",
      `HTTP ${res.status}`,
      PROVIDER,
      res.status,
    );
  }
  const html = await res.text();
  const state =
    readScriptJson(html, "__FRONTITY_CONNECT_STATE__") ??
    readScriptJson(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");

  const itemInfos = deepFind<any>(state, (value) => Boolean(value?.itemInfos))?.itemInfos;
  const authorInfos =
    deepFind<any>(state, (value) => Boolean(value?.authorInfos))?.authorInfos ?? {};

  if (itemInfos) {
    const video = itemInfos.video ?? {};
    const covers = itemInfos.covers ?? {};
    const play = firstUrl(video.urls ?? video.urlList ?? video.playAddr);
    if (!play) return null;
    const username = String(authorInfos.uniqueId ?? "").trim();
    return makeVideo({
      id: String(itemInfos.id ?? id),
      caption: String(itemInfos.text ?? "").trim(),
      authorUsername: username || "unknown",
      authorNickname: String(authorInfos.nickName ?? username).trim(),
      authorAvatar: firstUrl(authorInfos.avatarThumb ?? authorInfos.avatarMedium) ?? null,
      coverUrl: absolutise(firstUrl(covers.origin ?? covers.default), ORIGIN),
      originCoverUrl: absolutise(firstUrl(covers.origin), ORIGIN),
      playUrl: absolutise(play, ORIGIN),
      ttPlayUrl: absolutise(play, ORIGIN),
      hdPlayUrl: absolutise(play, ORIGIN),
      shareUrl: username
        ? `${ORIGIN}/@${username}/video/${itemInfos.id ?? id}`
        : `${ORIGIN}/video/${itemInfos.id ?? id}`,
      musicTitle: itemInfos.music?.musicName ? String(itemInfos.music.musicName) : null,
      musicAuthor: itemInfos.music?.musicAuthor ? String(itemInfos.music.musicAuthor) : null,
      durationSec: toNumber(video.duration ?? video.videoMeta?.duration) ?? null,
      postedAt: toIsoDate(itemInfos.createTime) ?? null,
      playCount: toNumber(itemInfos.stats?.playCount),
      diggCount: toNumber(itemInfos.stats?.diggCount),
      commentCount: toNumber(itemInfos.stats?.commentCount),
      shareCount: toNumber(itemInfos.stats?.shareCount),
      width: toNumber(video.videoMeta?.width),
      height: toNumber(video.videoMeta?.height),
      source: "link",
      fetchedAt: new Date().toISOString(),
      enriched: true,
    });
  }

  // Some embeds still ship the older flat object.
  const legacy = deepFind<any>(
    state,
    (value) => Boolean(value?.videoData?.itemInfos) || Boolean(value?.itemInfos?.video),
  );
  if (legacy) {
    const infos = legacy.videoData?.itemInfos ?? legacy.itemInfos;
    const authors = legacy.videoData?.authorInfos ?? legacy.authorInfos ?? {};
    const play = firstUrl(infos?.video?.urls ?? infos?.video?.playAddr);
    if (play) return fromWebItem({ ...infos, author: authors }, "link");
  }
  return null;
}

/* ── 3. the real pages ─────────────────────────────────────────── */

export async function videoPage(
  id: string,
  username?: string | null,
  cookie?: string | null,
): Promise<TikTokVideo | null> {
  const path = username ? `@${username}/video/${id}` : `video/${id}`;
  const res = await request(
    `${ORIGIN}/${path}`,
    { headers: headers(cookie, "browser") },
    14_000,
    PROVIDER,
  );
  if (!res.ok) {
    throw new UpstreamError(
      "tiktok.com would not serve that video page",
      `HTTP ${res.status}`,
      PROVIDER,
      res.status,
    );
  }
  const html = await res.text();
  const direct = parseVideoHtml(html, id, username, path);
  if (direct) return direct;

  /* Same soft block as the tag pages: a 200 shell with no clip data. */
  const relayed = await fetchViaRelays(`${ORIGIN}/${path}`, 9_000, PROVIDER, {
    jsonOnly: false,
  }).catch(() => null);
  if (relayed) {
    const retry = parseVideoHtml(relayed.text, id, username, path);
    if (retry) return retry;
  }

  return null;
}

/** Pure parser for a video page body — shared by the direct and relayed reads. */
function parseVideoHtml(
  html: string,
  id: string,
  username: string | null | undefined,
  path: string,
): TikTokVideo | null {
  const universal = readScriptJson(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  const scope = universal?.__DEFAULT_SCOPE__;
  const item =
    scope?.["webapp.video-detail"]?.itemInfo?.itemStruct ??
    deepFind<any>(universal, (value) => Boolean(value?.itemStruct))?.itemStruct;
  if (item) return fromWebItem(item, "link");

  // Legacy SIGI_STATE pages.
  const sigi = readScriptJson(html, "SIGI_STATE");
  const legacyItem =
    sigi?.ItemModule?.[id] ??
    deepFind<any>(sigi, (value) => Boolean(value?.ItemModule?.[id]))?.ItemModule?.[id];
  if (legacyItem) return fromWebItem(legacyItem, "link");

  // VideoObject JSON-LD (no play URL, but metadata + cover).
  const ld = parseJsonLd(html, "VideoObject");
  if (ld) {
    return makeVideo({
      id,
      caption: String(ld.name ?? ld.description ?? "").trim(),
      authorUsername: String(ld.creator?.alternateName ?? username ?? "unknown"),
      authorNickname: String(ld.creator?.name ?? username ?? "unknown"),
      coverUrl: firstUrl(ld.thumbnailUrl),
      durationSec: parseIsoDuration(ld.duration),
      postedAt: ld.uploadDate ? new Date(ld.uploadDate).toISOString() : null,
      shareUrl: `${ORIGIN}/${path}`,
      source: "link",
      fetchedAt: new Date().toISOString(),
      enriched: false,
    });
  }
  return null;
}

export async function resolveWebVideo(
  id: string,
  options: { username?: string | null; cookie?: string | null; oembedUrl?: string } = {},
): Promise<TikTokVideo | null> {
  const errors: string[] = [];

  try {
    const viaEmbed = await embedVideo(id, options.cookie);
    if (viaEmbed) return viaEmbed;
    errors.push("embed returned no playable file");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "embed failed");
  }

  try {
    const viaPage = await videoPage(id, options.username, options.cookie);
    if (viaPage) return viaPage;
    errors.push("video page had no clip data");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "video page failed");
  }

  // Last resort: oEmbed for the caption/cover so Link Grab still shows a card.
  const canonical =
    options.oembedUrl ??
    (options.username
      ? `${ORIGIN}/@${options.username}/video/${id}`
      : `${ORIGIN}/video/${id}`);
  const meta = await oembed(canonical);
  if (meta) {
    return makeVideo({
      id,
      caption: meta.title,
      authorUsername: meta.authorUsername ?? options.username ?? "unknown",
      authorNickname: meta.authorName || meta.authorUsername || "unknown creator",
      coverUrl: meta.thumbnailUrl,
      width: meta.width,
      height: meta.height,
      shareUrl: canonical,
      source: "link",
      fetchedAt: new Date().toISOString(),
      enriched: false,
    });
  }

  throw new UpstreamError(
    "tiktok.com did not return anything usable for that clip",
    errors.slice(0, 2).join(" · "),
    PROVIDER,
  );
}

/* ── tag pages (search fallback) ───────────────────────────────── */

export type TagPageResult = {
  videos: TikTokVideo[];
  headline: string | null;
  tagStats: { name: string; videoCount: number | null; viewCount: number | null } | null;
};

export async function tagPage(tag: string, cookie?: string | null): Promise<TagPageResult> {
  const clean = tag.replace(/^#/, "").trim();
  const url = `${ORIGIN}/tag/${encodeURIComponent(clean)}`;
  const res = await request(url, { headers: headers(cookie, "browser") }, 14_000, PROVIDER);
  if (!res.ok) {
    throw new UpstreamError(
      "tiktok.com would not serve that hashtag page",
      `HTTP ${res.status}`,
      PROVIDER,
      res.status,
    );
  }
  const html = await res.text();
  const direct = parseTagHtml(html, clean);

  /*
   * A 200 with no clips is TikTok's soft block: it served the website shell to
   * this IP. Ask a relay for the same page from a different address and keep
   * whichever answer actually carries clips.
   */
  if (!direct.videos.length) {
    const relayed = await fetchViaRelays(url, 9_000, PROVIDER, { jsonOnly: false }).catch(
      () => null,
    );
    if (relayed) {
      const retry = parseTagHtml(relayed.text, clean);
      if (retry.videos.length) return retry;
    }
  }

  return direct;
}

/** Pure parser for a hashtag page body — shared by the direct and relayed reads. */
function parseTagHtml(html: string, clean: string): TagPageResult {
  const universal = readScriptJson(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  const scope = universal?.__DEFAULT_SCOPE__;
  const challengeInfo = scope?.["webapp.tag-detail"]?.challengeInfo;
  const challenge = challengeInfo?.challenge;
  const headline =
    (challenge?.desc ? String(challenge.desc) : null) ??
    (/<meta[^>]+property="og:description"[^>]+content="([^"]{0,300})"/.exec(html)?.[1] ?? null);

  const videos: TikTokVideo[] = [];

  // Legacy inlined item list (older TikTok, still emitted on some edges).
  const itemList = parseJsonLd(html, "ItemList");
  if (itemList?.itemListElement) {
    for (const entry of itemList.itemListElement) {
      const url = String(entry?.url ?? "");
      const id = extractVideoId(url);
      if (!id) continue;
      const video = makeVideo({
        id,
        caption: String(entry.embeddedTextCaption ?? entry.name ?? "").replace(/\s*\|\s*TikTok\s*$/i, "").trim(),
        authorUsername: String(entry.creator?.alternateName ?? extractUsername(url) ?? "unknown"),
        authorNickname: String(entry.creator?.name ?? ""),
        authorAvatar: entry.creator?.image ?? null,
        coverUrl: firstUrl(entry.thumbnailUrl),
        playUrl: entry.contentUrl ?? null,
        ttPlayUrl: entry.contentUrl ?? null,
        durationSec: parseIsoDuration(entry.duration),
        postedAt: toIsoDate(entry.uploadDate),
        shareUrl: url,
        matchedTag: clean,
        source: "search",
        fetchedAt: new Date().toISOString(),
      });
      videos.push(video);
    }
  }

  const inline =
    deepFind<any>(universal, (value) => Array.isArray(value?.itemList) && value.itemList.length > 0)
      ?.itemList ?? null;
  if (Array.isArray(inline)) {
    for (const item of inline) {
      const video = fromWebItem(item, "search");
      if (video) {
        video.matchedTag = clean;
        videos.push(video);
      }
    }
  }

  return {
    videos,
    headline,
    tagStats: challenge
      ? {
          name: String(challenge.title ?? clean),
          videoCount: toNumber(challengeInfo?.stats?.videoCount),
          viewCount: toNumber(challengeInfo?.stats?.viewCount),
        }
      : null,
  };
}

/* ── session probing ──────────────────────────────────────────── */

export type SessionProbe = {
  verified: boolean;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  detail: string;
};

/**
 * Ask TikTok who the stored sessionid belongs to. This is a best-effort check —
 * if TikTok wants extra signatures we say "unverified" instead of blocking the
 * user, because the uploader itself may still work fine.
 */
export async function probeSession(sessionId: string): Promise<SessionProbe> {
  const cookie = cookieHeaderFrom(sessionId);
  const endpoints = [
    `${ORIGIN}/passport/web/account/info/?aid=1459&app_language=en&app_name=tiktok_web&device_platform=web`,
    `${ORIGIN}/api/user/detail/?aid=1988`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await request(
        endpoint,
        { headers: { ...headers(sessionId), Cookie: cookie } },
        12_000,
        PROVIDER,
      );
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim().startsWith("{")) continue;
      const json: any = JSON.parse(text);
      const data = json?.data ?? {};
      const username = data.username ?? data.unique_id ?? null;
      const userId = data.user_id ?? data.userId ?? null;
      if (username || userId) {
        return {
          verified: true,
          username: username ? String(username) : null,
          displayName: data.nickname ? String(data.nickname) : username ? String(username) : null,
          avatarUrl: data.avatar_url ?? data.avatarThumb ?? null,
          detail: "sessionid accepted by tiktok.com",
        };
      }
    } catch {
      /* try the next probe */
    }
  }

  return {
    verified: false,
    username: null,
    displayName: null,
    avatarUrl: null,
    detail: "could not confirm the sessionid — the uploader may still work",
  };
}

/* ── health ───────────────────────────────────────────────────── */

export async function webPing(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const started = Date.now();
  try {
    const res = await request(
      `${ORIGIN}/`,
      { headers: headers(null, "browser") },
      10_000,
      PROVIDER,
    );
    await res.text().catch(() => "");
    return {
      ok: res.ok,
      latencyMs: Date.now() - started,
      detail: res.ok ? "tiktok.com reachable" : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : "unreachable",
    };
  }
}

/* ── tiny parsers ─────────────────────────────────────────────── */

function parseJsonLd(html: string, type: string): any | null {
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    try {
      const parsed = JSON.parse(match[1]);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        if (String(candidate?.["@type"] ?? "").toLowerCase() === type.toLowerCase()) {
          return candidate;
        }
      }
    } catch {
      /* ignore malformed blocks */
    }
  }
  return null;
}

function parseIsoDuration(raw?: string | null): number | null {
  if (!raw) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(raw).trim());
  if (!match) return null;
  const [, h, m, s] = match;
  const total = Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}
