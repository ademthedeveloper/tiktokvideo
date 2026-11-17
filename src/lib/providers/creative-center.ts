/**
 * TikTok Creative Center — TikTok's own public trends dashboard, read as JSON.
 *
 * This is a source *inside* TikTok (ads.us.tiktok.com), so it does not depend on
 * tikwm, on a Cloudflare challenge, or on the www.tiktok.com API that currently
 * serves datacenter IPs a bot-filtered shell. Logged out it returns the top
 * organic/ads videos for a period, with views, covers and creators — enough to
 * fill the firehose when the usual feeds are refused.
 *
 * It is trending content, not keyword search: there is no query parameter here,
 * so this provider only ever feeds the region firehose.
 *
 * Endpoints (both unsigned at the time of writing):
 *   GET /CreativeOne/Report/GetTopContentsOverview      → latest week timestamp
 *   GET /CreativeOne/Report/CreativeCenterGetTopContentsList → entityInfos[]
 *
 * Everything is parsed defensively: TikTok renames these fields regularly, and
 * a rename must degrade to "no clips from this provider", never to a crash.
 */

import type { TikTokVideo } from "../types";
import { makeVideo } from "../video-factory";
import { BROWSER_UA, UpstreamError, readJson, request, toIsoDate, toNumber } from "./net";

const BASE = "https://ads.us.tiktok.com/CreativeOne/Report";
const PROVIDER = "creative center";

function headers(): Record<string, string> {
  return {
    "User-Agent": BROWSER_UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://ads.tiktok.com",
    Referer: "https://ads.tiktok.com/",
    "agw-js-conv": "str",
  };
}

async function reportGet(path: string, params: Record<string, string | number> = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const res = await request(url.toString(), { headers: headers() }, 12_000, PROVIDER);
  if (!res.ok) {
    throw new UpstreamError(
      "TikTok's trends report refused the request",
      `HTTP ${res.status} on ${path}`,
      PROVIDER,
      res.status,
    );
  }
  const json = await readJson<any>(res, PROVIDER);
  const code = Number(json?.code ?? json?.statusCode ?? 0);
  if (Number.isFinite(code) && code !== 0) {
    throw new UpstreamError(
      `TikTok's trends report answered code ${code}`,
      String(json?.msg ?? json?.message ?? path).slice(0, 100),
      PROVIDER,
    );
  }
  return json;
}

/** First value present among the keys the report uses across its versions. */
function pick(source: any, keys: string[]): any {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function listOf(payload: any): any[] {
  const candidates = [
    payload?.entityInfos,
    payload?.data?.entityInfos,
    payload?.data?.itemInfos,
    payload?.itemInfos,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function toVideo(entity: any): TikTokVideo | null {
  const info = entity?.itemInfo ?? entity?.item ?? entity;
  const author = entity?.itemAuthorInfo ?? entity?.authorInfo ?? entity?.author ?? {};
  const metrics = entity?.itemMetrics ?? entity?.metrics ?? entity;

  const id = String(pick(info, ["itemID", "itemId", "id", "videoId"]) ?? "").trim();
  if (!id) return null;
  const username = String(pick(author, ["handlerName", "uniqueId", "username"]) ?? "").trim();

  return makeVideo({
    id,
    caption: String(pick(info, ["desc", "title", "caption"]) ?? "").trim(),
    authorUsername: username || "unknown",
    authorNickname: String(
      pick(author, ["nickName", "nickname", "name"]) ?? (username || "unknown creator"),
    ),
    authorAvatar: pick(author, ["avatarUrl", "avatar", "avatarThumb"]) ?? null,
    coverUrl: pick(info, ["coverUrl", "cover", "itemCover", "dynamicCover"]) ?? null,
    originCoverUrl: pick(info, ["coverUrl", "cover"]) ?? null,
    playUrl: pick(info, ["videoUrl", "playUrl", "downloadUrl"]) ?? null,
    shareUrl: username
      ? `https://www.tiktok.com/@${username}/video/${id}`
      : `https://www.tiktok.com/video/${id}`,
    durationSec: toNumber(pick(info, ["duration", "videoDuration"])),
    region: null,
    postedAt: toIsoDate(pick(info, ["createTime", "createTimeISO", "postedAt"])),
    playCount: toNumber(pick(metrics, ["videoViews", "views", "playCount"])),
    diggCount: toNumber(pick(metrics, ["likes", "diggCount"])),
    commentCount: toNumber(pick(metrics, ["comments", "commentCount"])),
    shareCount: toNumber(pick(metrics, ["shares", "shareCount"])),
    source: "firehose",
    matchedTag: null,
    fetchedAt: new Date().toISOString(),
    enriched: false,
    rank: 0,
  });
}

/**
 * Top videos for a region from TikTok's own trends report.
 * Returns [] rather than throwing when the report answers with no rows — that is
 * a normal "no data for this region", not a failure.
 */
export async function creativeCenterTop(opts: {
  region?: string;
  count?: number;
}): Promise<{ videos: TikTokVideo[]; detail: string }> {
  const country = (opts.region ?? "US").toUpperCase().slice(0, 2);
  const limit = Math.min(30, Math.max(1, opts.count ?? 20));

  const overview = await reportGet("/GetTopContentsOverview");
  const weekEnd =
    toNumber(
      pick(overview, ["lastWeeklyEndTimestamp"]) ??
        pick(overview?.data ?? {}, ["lastWeeklyEndTimestamp", "lastEndTimestamp"]),
    ) ?? null;

  const payload = await reportGet("/CreativeCenterGetTopContentsList", {
    countryCode: country,
    contentLabelIDs: "",
    orderByMetric: 1,
    organicOnly: "false",
    periodDimension: 3,
    ...(weekEnd ? { periodEndTimestamp: weekEnd } : {}),
    page: 1,
    limit,
  });

  const entities = listOf(payload);
  const videos: TikTokVideo[] = [];
  for (const entity of entities.slice(0, limit)) {
    const video = toVideo(entity);
    if (video) videos.push({ ...video, rank: videos.length });
  }
  return {
    videos,
    detail: videos.length
      ? `${country} top videos → ${videos.length} clips`
      : `${country} answered with no rows (this report is US-heavy)`,
  };
}

/** Diagnostics probe: is TikTok's trends report readable from this host? */
export async function creativeCenterCheck(): Promise<{
  ok: boolean;
  latencyMs: number;
  detail: string;
}> {
  const started = Date.now();
  try {
    const page = await creativeCenterTop({ region: "US", count: 3 });
    return {
      ok: page.videos.length > 0,
      latencyMs: Date.now() - started,
      detail: page.detail,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: err instanceof UpstreamError && err.detail ? `${err.message} — ${err.detail}` : err instanceof Error ? err.message : "unreachable",
    };
  }
}
