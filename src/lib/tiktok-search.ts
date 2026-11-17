import type { TikTokVideo } from "./types";

/**
 * TikTok serves full video metadata as JSON-LD to crawler user agents. That is
 * a public, unsigned, unblocked read path — it is what powers real search here.
 */
const CRAWLER_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

type JsonLdItem = {
  position?: number;
  url?: string;
  name?: string;
  description?: string;
  embeddedTextCaption?: string;
  thumbnailUrl?: string[] | string;
  uploadDate?: string;
  contentUrl?: string;
  commentCount?: string | number;
  duration?: string;
  inLanguage?: string;
  locationCreated?: string;
  width?: number;
  height?: number;
  audio?: { name?: string; author?: string };
  creator?: {
    name?: string;
    alternateName?: string;
    url?: string;
    image?: string;
    interactionStatistic?: InteractionStat[];
  };
  interactionStatistic?: InteractionStat[];
};

type InteractionStat = {
  interactionType?: { "@type"?: string };
  userInteractionCount?: number | string;
};

function stat(list: InteractionStat[] | undefined, action: string): number | null {
  if (!Array.isArray(list)) return null;
  const hit = list.find((entry) =>
    String(entry?.interactionType?.["@type"] ?? "").toLowerCase().includes(action.toLowerCase()),
  );
  if (!hit) return null;
  const value = Number(hit.userInteractionCount);
  return Number.isFinite(value) ? value : null;
}

/** "PT1M30S" → 90 */
function parseIsoDuration(raw?: string): number | null {
  if (!raw) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(raw.trim());
  if (!match) return null;
  const [, h, m, s] = match;
  const total = (Number(h ?? 0) * 3600) + (Number(m ?? 0) * 60) + Number(s ?? 0);
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}

export function tagFromKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9\u00C0-\u024F_]/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** Ordered tag candidates so one search can still reach 10+ unique clips. */
export function tagCandidates(keyword: string): string[] {
  const clean = keyword.trim().toLowerCase().replace(/^@/, "");
  const out: string[] = [];
  const push = (value: string) => {
    const tag = tagFromKeyword(value);
    if (tag && !out.includes(tag)) out.push(tag);
  };

  if (clean.startsWith("@")) {
    push(clean);
    return out;
  }

  push(clean);
  const words = clean.split(/[\s_-]+/).filter((w) => w.length > 2);
  if (words.length > 1) {
    push(words.join(""));
    words.forEach(push);
  } else {
    push(`${clean}memes`);
    push(`${clean}content`);
    push(`${clean}s`);
    push(`${clean}tiktok`);
  }
  return out.slice(0, 5);
}

function parseItemList(html: string): JsonLdItem[] {
  const match = html.match(
    /<script type="application\/ld\+json" id="ItemList">([\s\S]*?)<\/script>/,
  );
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    const items = parsed?.itemListElement;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function pageMeta(html: string, property: string): string | null {
  const match = html.match(
    new RegExp(`<meta[^>]+property="${property}"[^>]+content="([^"]{0,400})"`),
  );
  return match ? match[1] : null;
}

export type SearchPage = {
  tag: string;
  videos: TikTokVideo[];
  headline: string | null;
  failure?: string;
};

type ReadPageResult = { html: string; failure?: never } | { html: null; failure: string };

async function readPage(url: string): Promise<ReadPageResult> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": CRAWLER_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) {
      return { html: null, failure: `TikTok returned HTTP ${res.status}` };
    }
    return { html: await res.text() };
  } catch (error) {
    return {
      html: null,
      failure: error instanceof Error ? error.message : "TikTok could not be reached",
    };
  }
}

function toItem(raw: JsonLdItem, tag: string, index: number): TikTokVideo | null {
  const pageUrl = raw.url ?? "";
  const idMatch = /\/video\/(\d+)/.exec(pageUrl);
  const id = idMatch?.[1];
  if (!id) return null;

  const username =
    raw.creator?.alternateName ??
    /tiktok\.com\/@([^/]+)/.exec(pageUrl)?.[1] ??
    "unknown";
  const nickname = raw.creator?.name ?? username;
  const caption = (raw.embeddedTextCaption ?? raw.name ?? "")
    .replace(/\s*\|\s*TikTok\s*$/i, "")
    .trim();

  const thumb = Array.isArray(raw.thumbnailUrl) ? raw.thumbnailUrl[0] : raw.thumbnailUrl;
  const seconds = parseIsoDuration(raw.duration);

  return {
    id,
    caption,
    authorUsername: username,
    authorNickname: nickname,
    authorAvatar: raw.creator?.image ?? null,
    coverUrl: thumb ?? null,
    originCoverUrl:
      thumb ?? `https://www.tiktok.com/api/img/?itemId=${id}&location=0&aid=1988`,
    playUrl: raw.contentUrl ?? null,
    ttPlayUrl: raw.contentUrl ?? null,
    hdPlayUrl: null,
    wmPlayUrl: null,
    shareUrl: pageUrl || `https://www.tiktok.com/@${username}/video/${id}`,
    musicTitle: raw.audio?.name ?? null,
    musicAuthor: raw.audio?.author ?? null,
    musicUrl: null,
    durationSec: seconds,
    region: raw.locationCreated ?? raw.inLanguage ?? null,
    postedAt: raw.uploadDate ? new Date(raw.uploadDate).toISOString() : null,
    playCount: stat(raw.interactionStatistic, "WatchAction"),
    diggCount: stat(raw.interactionStatistic, "LikeAction"),
    saveCount: stat(raw.interactionStatistic, "SaveAction"),
    shareCount: stat(raw.interactionStatistic, "ShareAction"),
    commentCount:
      Number(raw.commentCount ?? 0) || null,
    creatorFollowers: stat(raw.creator?.interactionStatistic, "FollowAction"),
    width: raw.width ?? null,
    height: raw.height ?? null,
    matchedTag: tag,
    source: "search",
    fetchedAt: new Date().toISOString(),
    enriched: false,
    rank: index,
  };
}

export async function searchTagPage(tag: string): Promise<SearchPage> {
  const url = tag.startsWith("@")
    ? `https://www.tiktok.com/${tag}`
    : `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`;
  const page = await readPage(url);
  if (!page.html) {
    return { tag, videos: [], headline: null, failure: page.failure };
  }
  const html = page.html;
  const items = parseItemList(html);
  const videos = items
    .map((item, index) => toItem(item, tag, index))
    .filter((video): video is TikTokVideo => Boolean(video));
  return {
    tag,
    videos,
    headline: pageMeta(html, "og:description") ?? pageMeta(html, "og:title"),
  };
}

export type SearchOutcome = {
  videos: TikTokVideo[];
  tagsTried: { tag: string; found: number }[];
  headline: string | null;
  notice?: string;
};

/**
 * Real TikTok search. Fans out over hashtag variants until we have `count`
 * unique clips, deduping by video id and keeping the most-engaged first.
 */
export async function searchTikTok(opts: {
  keyword: string;
  count?: number;
  region?: string;
}): Promise<SearchOutcome> {
  const count = Math.min(30, Math.max(4, opts.count ?? 10));
  const candidates = tagCandidates(opts.keyword);
  const byId = new Map<string, TikTokVideo>();
  const tried: { tag: string; found: number }[] = [];
  let headline: string | null = null;
  let upstreamFailure: string | undefined;

  for (const tag of candidates) {
    if (byId.size >= count) break;
    const page = await searchTagPage(tag);
    tried.push({ tag, found: page.videos.length });
    if (!upstreamFailure && page.failure) upstreamFailure = page.failure;
    if (!headline && page.headline) headline = page.headline;
    for (const video of page.videos) {
      if (!byId.has(video.id)) byId.set(video.id, video);
    }
    if (byId.size < count && candidates.indexOf(tag) < candidates.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 550));
    }
  }

  const videos = [...byId.values()]
    .sort(
      (a, b) =>
        (b.diggCount ?? 0) + (b.playCount ?? 0) / 100 -
        ((a.diggCount ?? 0) + (a.playCount ?? 0) / 100),
    )
    .slice(0, count);

  const totalFound = tried.reduce((sum, entry) => sum + entry.found, 0);
  let notice: string | undefined;
  if (!videos.length) {
    notice = upstreamFailure
      ? `TikTok search is temporarily unavailable (${upstreamFailure}). Try Link Grab with a TikTok video URL, or try again later.`
      : totalFound
        ? "TikTok returned clips but none matched — try a broader tag."
        : `TikTok had no public #${candidates[0]} list right now. Try another spelling or use Link Grab.`;
  } else if (videos.length < count) {
    notice = `Found ${videos.length} clips across ${tried
      .filter((entry) => entry.found > 0)
      .map((entry) => `#${entry.tag}`)
      .join(", ")}.`;
  } else {
    notice = `${videos.length} clips from ${tried
      .filter((entry) => entry.found > 0)
      .map((entry) => `#${entry.tag}`)
      .join(", ")}.`;
  }

  return { videos, tagsTried: tried, headline, notice };
}

export const CRAWLER_HEADERS = {
  "User-Agent": CRAWLER_UA,
  "Accept-Language": "en-US,en;q=0.9",
};
