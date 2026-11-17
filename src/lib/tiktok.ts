/**
 * The desk's fetch engine.
 *
 * Every read of TikTok goes through here and every read has a fallback:
 *
 *   search   tikwm /feed/search  →  tiktok.com hashtag API  →  tag page
 *            (and, when the host's IP is blocked, the browser does it instead)
 *   links    tikwm /api/         →  tiktok.com embed  →  video page  →  oEmbed
 *   firehose tikwm /feed/list    →  tikwm search "fyp"
 *   enrich   tikwm /api/         →  tiktok.com embed  →  video page
 *
 * Each attempt is recorded so the UI can say *which* upstream failed and why,
 * instead of the old "Nothing came back".
 */

import type { FetchMode, TikTokVideo } from "./types";
import { makeVideo } from "./video-factory";
import {
  type Attempt,
  UpstreamError,
  lastUpstreamRelay,
  resetUpstreamRelay,
  shortError,
  withTimeout,
} from "./providers/net";
import {
  fromTikwm,
  tikwmDetail,
  tikwmFeed,
  tikwmPing,
  tikwmSearch,
  tikwmUserPosts,
  tikwmConfiguredBase,
} from "./providers/tikwm";
import {
  extractUsername,
  extractVideoId,
  expandShortLink,
  resolveWebVideo,
  tagPage,
  webPing,
} from "./providers/tiktok-web";
import {
  challengeVideos,
  creatorVideos,
  videoDetail,
  webApiCheck,
} from "./providers/tiktok-api";
import { creativeCenterCheck, creativeCenterTop } from "./providers/creative-center";
import {
  fromAny,
  sidecarCheck,
  sidecarSearch,
  sidecarTag,
  sidecarUrl,
  sidecarVideo,
} from "./providers/sidecar";

export { UpstreamError } from "./providers/net";

/* ── query shaping ─────────────────────────────────────────────── */

export function tagFromKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9\u00C0-\u024F_]/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** Ordered hashtag candidates — used for `matchedTag` labels and the fallback. */
export function tagCandidates(keyword: string): string[] {
  const clean = keyword.trim().toLowerCase().replace(/^@/, "");
  const out: string[] = [];
  const push = (value: string) => {
    const tag = tagFromKeyword(value);
    if (tag && !out.includes(tag)) out.push(tag);
  };
  push(clean);
  const words = clean.split(/[\s_-]+/).filter((word) => word.length > 2);
  if (words.length > 1) {
    push(words.join(""));
    words.forEach(push);
  }
  return out.slice(0, 4);
}

/** What we actually send to the search API, most relevant first. */
export function searchQueries(keyword: string): { text: string; tag: string }[] {
  const raw = keyword.trim().replace(/\s+/g, " ");
  if (!raw) return [];
  if (raw.startsWith("@")) {
    return [{ text: raw, tag: raw.replace(/^@/, "").toLowerCase() }];
  }
  const out: { text: string; tag: string }[] = [];
  const push = (text: string) => {
    const value = text.trim();
    if (!value) return;
    if (out.some((entry) => entry.text.toLowerCase() === value.toLowerCase())) return;
    out.push({ text: value, tag: tagFromKeyword(value) || value.toLowerCase() });
  };

  push(raw);
  const words = raw.split(/[\s_-]+/).filter(Boolean);
  if (words.length > 1) push(`#${words.map((word) => tagFromKeyword(word)).filter(Boolean).join("")}`);
  else push(`#${tagFromKeyword(raw)}`);
  if (words.length > 1) push(words[0]);
  return out.slice(0, 3);
}

function clampCount(value: number | undefined, fallback = 12) {
  return Math.min(30, Math.max(1, Math.round(value ?? fallback) || fallback));
}

function engagement(video: TikTokVideo) {
  return (video.diggCount ?? 0) + (video.playCount ?? 0) / 100;
}

function trim(text: string, max = 110) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ── search ───────────────────────────────────────────────────── */

export type SearchOutcome = {
  videos: TikTokVideo[];
  tagsTried: { tag: string; found: number }[];
  attempts: Attempt[];
  headline: string | null;
  upstream: string;
  notice: string;
  degraded: boolean;
};

export async function searchClips(opts: {
  keyword: string;
  count?: number;
  region?: string;
}): Promise<SearchOutcome> {
  const keyword = opts.keyword.trim();
  const count = clampCount(opts.count, 12);
  const region = (opts.region ?? "US").toUpperCase();
  const attempts: Attempt[] = [];
  resetUpstreamRelay();
  const tagsTried: { tag: string; found: number }[] = [];
  const byId = new Map<string, TikTokVideo>();
  let headline: string | null = null;
  let degraded = false;
  let upstream = `tikwm ${tikwmConfiguredBase()} /feed/search`;
  /** Routed fetch has to answer inside the request window. */
  const deadline = Date.now() + 45_000;
  const outOfTime = () => Date.now() > deadline;

  const add = (videos: TikTokVideo[], tag: string) => {
    let fresh = 0;
    for (const video of videos) {
      if (byId.has(video.id)) continue;
      video.matchedTag = tag;
      byId.set(video.id, video);
      fresh += 1;
    }
    tagsTried.push({ tag, found: fresh });
    return fresh;
  };

  /* @handle → that creator's recent clips */
  if (keyword.startsWith("@")) {
    const username = keyword.replace(/^@/, "").trim();
    const started = Date.now();
    try {
      const page = await withTimeout(
        tikwmUserPosts({ uniqueId: username, count }),
        18_000,
        "tikwm user posts",
      );
      const videos = page.raw
        .map((raw) => fromTikwm(raw, "search"))
        .filter((video): video is TikTokVideo => Boolean(video));
      add(videos, username.toLowerCase());
      attempts.push({
        provider: "tikwm user posts",
        query: `@${username}`,
        found: videos.length,
        ms: Date.now() - started,
      });
    } catch (err) {
      attempts.push({
        provider: "tikwm user posts",
        query: `@${username}`,
        found: 0,
        error: trim(shortError(err)),
        ms: Date.now() - started,
      });
      degraded = true;
    }

    if (!byId.size && !outOfTime()) {
      const apiStarted = Date.now();
      try {
        const videos = await withTimeout(
          creatorVideos({ username, count }),
          16_000,
          "tiktok.com creator list",
        );
        add(videos, username.toLowerCase());
        attempts.push({
          provider: "tiktok.com api",
          query: `@${username}`,
          found: videos.length,
          ms: Date.now() - apiStarted,
        });
        if (videos.length) upstream = "tiktok.com web api";
      } catch (err) {
        attempts.push({
          provider: "tiktok.com api",
          query: `@${username}`,
          found: 0,
          error: trim(shortError(err)),
          ms: Date.now() - apiStarted,
        });
        degraded = true;
      }
    }
  } else {
    /* keyword / hashtag search: optional sidecar → tikwm → hashtag page */
    const sidecarReady = Boolean(sidecarUrl());
    let sidecarDead = false;
    let tikwmDead = false;

    for (const query of searchQueries(keyword)) {
      if (byId.size >= count || outOfTime()) break;

      if (sidecarReady && !sidecarDead) {
        const started = Date.now();
        try {
          const videos = await withTimeout(
            sidecarSearch({ query: query.text, count, region }),
            18_000,
            "sidecar search",
          );
          const fresh = add(videos, query.tag);
          attempts.push({
            provider: "sidecar search",
            query: query.text,
            found: fresh,
            ms: Date.now() - started,
          });
          if (videos.length) upstream = "self-hosted sidecar";
        } catch (err) {
          const message = shortError(err);
          attempts.push({
            provider: "sidecar search",
            query: query.text,
            found: 0,
            error: trim(message),
            ms: Date.now() - started,
          });
          degraded = true;
          sidecarDead = true;
        }
      }

      if (byId.size >= count || tikwmDead) continue;

      const started = Date.now();
      try {
        const page = await withTimeout(
          tikwmSearch({ keywords: query.text, count, region, timeoutMs: 12_000, attempts: 1 }),
          15_000,
          "tikwm search",
        );
        const videos = page.raw
          .map((raw) => fromTikwm(raw, "search"))
          .filter((video): video is TikTokVideo => Boolean(video));
        const fresh = add(videos, query.tag);
        attempts.push({
          provider: "tikwm search",
          query: query.text,
          found: fresh,
          ms: Date.now() - started,
        });
      } catch (err) {
        const message = shortError(err);
        attempts.push({
          provider: "tikwm search",
          query: query.text,
          found: 0,
          error: trim(message),
          ms: Date.now() - started,
        });
        degraded = true;
        if (/reach|timed out|challenge|malformed|refused/i.test(message)) tikwmDead = true;
      }
    }

    /* TikTok's own hashtag item list (no middleman, works from datacenter IPs) */
    if (byId.size < count && !outOfTime()) {
      for (const tag of tagCandidates(keyword).slice(0, 2)) {
        if (byId.size >= count || outOfTime()) break;
        const apiStarted = Date.now();
        try {
          const page = await withTimeout(
            challengeVideos({ tag, count }),
            16_000,
            "tiktok.com hashtag list",
          );
          const fresh = add(page.videos, tag);
          attempts.push({
            provider: "tiktok.com api",
            query: `#${tag}`,
            found: fresh,
            ms: Date.now() - apiStarted,
          });
          if (page.videos.length) upstream = "tiktok.com web api";
        } catch (err) {
          attempts.push({
            provider: "tiktok.com api",
            query: `#${tag}`,
            found: 0,
            error: trim(shortError(err)),
            ms: Date.now() - apiStarted,
          });
        }
      }
    }

    /* last resort: read the hashtag page itself */
    if (!byId.size) {
      for (const tag of tagCandidates(keyword).slice(0, 2)) {
        const started = Date.now();
        try {
          const videos =
            sidecarReady && !sidecarDead
              ? await withTimeout(sidecarTag({ tag, count }), 18_000, "sidecar tag")
              : [];
          if (videos.length) {
            const fresh = add(videos, tag);
            attempts.push({
              provider: "sidecar tag",
              query: `#${tag}`,
              found: fresh,
              ms: Date.now() - started,
            });
            upstream = "self-hosted sidecar";
            continue;
          }
        } catch (err) {
          attempts.push({
            provider: "sidecar tag",
            query: `#${tag}`,
            found: 0,
            error: trim(shortError(err)),
            ms: Date.now() - started,
          });
          sidecarDead = true;
        }

        const pageStarted = Date.now();
        try {
          const page = await withTimeout(tagPage(tag), 15_000, "tiktok.com tag page");
          const fresh = add(page.videos, tag);
          headline = headline ?? page.headline;
          attempts.push({
            provider: "tiktok.com tag page",
            query: `#${tag}`,
            found: fresh,
            ms: Date.now() - pageStarted,
          });
          if (page.videos.length && upstream.startsWith("tikwm")) upstream = "tiktok.com tag pages";
        } catch (err) {
          attempts.push({
            provider: "tiktok.com tag page",
            query: `#${tag}`,
            found: 0,
            error: trim(shortError(err)),
            ms: Date.now() - pageStarted,
          });
          degraded = true;
        }
      }
    }
  }

  const videos = [...byId.values()]
    .sort((a, b) => engagement(b) - engagement(a))
    .slice(0, count)
    .map((video, index) => ({ ...video, rank: index }));

  let notice: string;
  if (videos.length) {
    const hit = tagsTried.filter((entry) => entry.found > 0).map((entry) => `#${entry.tag}`);
    notice = `${videos.length} clip${videos.length === 1 ? "" : "s"}${
      hit.length ? ` from ${hit.slice(0, 3).join(", ")}` : ""
    }${videos.length < count ? " — that is everything public right now" : ""}.`;
    if (degraded) notice += " One upstream had to be skipped.";
  } else if (!attempts.length) {
    notice = "Type a keyword or #hashtag to search.";
  } else {
    const blocked = attempts.some((entry) =>
      /bot-challenge|bot challenge|bot-filtered|\b403\b|forbidden|instead of json/i.test(
        entry.error ?? "",
      ),
    );
    const hint = blocked
      ? "this host's IP is blocked by TikTok and tikwm — the app now retries the same search from your browser; if it still comes back empty, deploy tools/tiktok-proxy-worker and set TIKTOK_PROXY_URL."
      : "try another spelling, paste links in Link grab, or run diagnostics in fetch health.";
    notice = `No clips for “${keyword}”. ${attempts
      .map((entry) => `${entry.provider}: ${entry.error ?? "0 hits"}`)
      .join(" · ")} — ${hint}`;
  }

  const relay = lastUpstreamRelay();

  return {
    videos,
    tagsTried,
    attempts,
    headline,
    upstream: relay ? `${upstream} · relay ${relay}` : upstream,
    notice: trim(relay && videos.length ? `${notice} Borrowed the ${relay} relay to get past the block.` : notice, 420),
    degraded,
  };
}

/* ── links ────────────────────────────────────────────────────── */

export type ResolvedLink = { video: TikTokVideo; provider: string };
export type LinkOutcome = {
  videos: TikTokVideo[];
  failures: { link: string; reason: string }[];
  attempts: Attempt[];
  providers: string[];
  degraded: boolean;
};

export async function resolveLink(url: string): Promise<ResolvedLink> {
  const trimmed = url.trim();
  if (!trimmed) throw new UpstreamError("Empty link");

  const errors: string[] = [];

  if (sidecarUrl()) {
    try {
      const video = await withTimeout(
        sidecarVideo({ id: extractVideoId(trimmed) ?? undefined, url: trimmed }),
        16_000,
        "sidecar video",
      );
      if (video) return { video: fromAny(video, "link") ?? video, provider: "sidecar" };
      errors.push("sidecar returned no clip");
    } catch (err) {
      errors.push(`sidecar: ${shortError(err)}`);
    }
  }

  try {
    const raw = await withTimeout(
      tikwmDetail(trimmed, true, { timeoutMs: 12_000, attempts: 1 }),
      15_000,
      "tikwm",
    );
    const video = fromTikwm(raw, "link");
    if (video && (video.playUrl || video.hdPlayUrl || video.coverUrl)) {
      return { video, provider: "tikwm" };
    }
    errors.push("tikwm returned no media");
  } catch (err) {
    errors.push(`tikwm: ${shortError(err)}`);
  }

  const expanded = await expandShortLink(trimmed);
  const id = extractVideoId(expanded) ?? extractVideoId(trimmed);
  if (id) {
    try {
      const viaApi = await withTimeout(videoDetail(id), 15_000, "tiktok.com api");
      if (viaApi && (viaApi.playUrl || viaApi.coverUrl)) {
        return { video: viaApi, provider: "tiktok.com api" };
      }
      errors.push("tiktok.com api returned no clip");
    } catch (err) {
      errors.push(`tiktok.com api: ${shortError(err)}`);
    }

    try {
      const video = await withTimeout(
        resolveWebVideo(id, {
          username: extractUsername(expanded) ?? extractUsername(trimmed),
          oembedUrl: expanded,
        }),
        22_000,
        "tiktok.com",
      );
      if (video) return { video, provider: "tiktok.com" };
    } catch (err) {
      errors.push(`tiktok.com: ${shortError(err)}`);
    }
  } else {
    errors.push("that URL has no video id in it");
  }

  throw new UpstreamError(
    "That link did not resolve to a video",
    errors.slice(0, 2).join(" · "),
    "link",
  );
}

export async function resolveLinks(links: string[]): Promise<LinkOutcome> {
  const videos: TikTokVideo[] = [];
  const failures: { link: string; reason: string }[] = [];
  const attempts: Attempt[] = [];
  resetUpstreamRelay();
  const providers = new Set<string>();
  let degraded = false;

  const deadline = Date.now() + 55_000;

  for (const [index, link] of links.entries()) {
    const started = Date.now();
    if (Date.now() > deadline) {
      failures.push({ link, reason: "ran out of time — split the batch" });
      continue;
    }
    try {
      const resolved = await resolveLink(link);
      resolved.video.source = "link";
      resolved.video.rank = videos.length;
      providers.add(resolved.provider);
      videos.push(resolved.video);
      attempts.push({
        provider: resolved.provider,
        query: link,
        found: 1,
        ms: Date.now() - started,
      });
    } catch (err) {
      degraded = true;
      const reason = shortError(err);
      failures.push({ link, reason: trim(reason, 160) });
      attempts.push({
        provider: "link resolve",
        query: link,
        found: 0,
        error: trim(reason),
        ms: Date.now() - started,
      });
    }
    if (index < links.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  return {
    videos,
    failures,
    attempts,
    providers: [...providers],
    degraded,
  };
}

/* ── firehose ─────────────────────────────────────────────────── */

export type FirehosePage = {
  videos: TikTokVideo[];
  nextCursor: number;
  hasMore: boolean;
  upstream: string;
  notice: string;
  degraded: boolean;
};

export async function fetchFirehose(opts: {
  region: string;
  cursor?: number;
  count?: number;
}): Promise<FirehosePage> {
  const region = (opts.region || "US").toUpperCase();
  const count = clampCount(opts.count, 20);
  const cursor = Math.max(0, Math.round(opts.cursor ?? 0));

  try {
    const page = await withTimeout(
      tikwmFeed({ region, count, cursor, timeoutMs: 12_000, attempts: 1 }),
      15_000,
      "tikwm feed",
    );
    const videos = page.raw
      .map((raw) => fromTikwm(raw, "firehose"))
      .filter((video): video is TikTokVideo => Boolean(video))
      .map((video, index) => ({ ...video, rank: cursor + index }));
    if (videos.length) {
      return {
        videos,
        nextCursor: page.cursor,
        hasMore: true,
        upstream: `tikwm ${tikwmConfiguredBase()} /feed/list`,
        notice: `${videos.length} trending clips from ${region}.`,
        degraded: false,
      };
    }
  } catch {
    /* fall through to the search-backed firehose */
  }

  try {
    const page = await withTimeout(challengeVideos({ tag: "fyp", count }), 16_000, "tiktok.com hashtag list");
    const videos = page.videos.map((video, index) => ({ ...video, rank: cursor + index }));
    if (videos.length) {
      return {
        videos,
        nextCursor: cursor + count,
        hasMore: page.hasMore,
        upstream: "tiktok.com web api #fyp",
        notice: `${videos.length} clips from TikTok's #fyp list.`,
        degraded: true,
      };
    }
  } catch {
    /* fall through to search */
  }

  /* TikTok's own trends report — no tikwm, no www.tiktok.com shell. */
  try {
    const page = await withTimeout(
      creativeCenterTop({ region, count }),
      16_000,
      "creative center trends",
    );
    if (page.videos.length) {
      return {
        videos: page.videos.map((video, index) => ({ ...video, rank: cursor + index })),
        nextCursor: cursor + count,
        hasMore: false,
        upstream: "TikTok Creative Center (official trends)",
        notice: `${page.videos.length} of TikTok's top ${region} videos right now, straight from TikTok's own trends report.`,
        degraded: true,
      };
    }
  } catch {
    /* fall through to search */
  }

  const fallback = await searchClips({ keyword: "fyp", count, region });
  return {
    videos: fallback.videos,
    nextCursor: cursor + count,
    hasMore: fallback.videos.length > 0,
    upstream: "tikwm search “fyp” (firehose fallback)",
    notice: fallback.videos.length
      ? `The region feed was empty, so these are the busiest #fyp clips instead.`
      : `Nothing came back: ${fallback.notice}`,
    degraded: true,
  };
}

/* ── enrich ───────────────────────────────────────────────────── */

export type EnrichOutcome = {
  video: TikTokVideo;
  enriched: boolean;
  provider: string | null;
  reason: string | null;
};

/**
 * Swap in a watermark-free MP4 / HD link for a clip found by search. Search
 * results already carry metadata, so a failure here is never fatal — it just
 * leaves the clip as it was and says why.
 */
export async function enrichVideo(base: TikTokVideo): Promise<EnrichOutcome> {
  const reasons: string[] = [];
  /** Serverless functions get killed around 60s — leave room to answer. */
  const deadline = Date.now() + 32_000;
  const outOfTime = () => Date.now() > deadline;

  if (sidecarUrl() && !outOfTime()) {
    try {
      const viaSidecar = await withTimeout(
        sidecarVideo({ id: base.id, url: base.shareUrl }),
        14_000,
        "sidecar video",
      );
      if (viaSidecar && (viaSidecar.playUrl || viaSidecar.hdPlayUrl)) {
        return {
          video: makeVideo({
            ...base,
            playUrl: viaSidecar.playUrl ?? base.playUrl,
            hdPlayUrl: viaSidecar.hdPlayUrl ?? base.hdPlayUrl,
            ttPlayUrl: viaSidecar.ttPlayUrl ?? base.ttPlayUrl,
            enriched: true,
          }),
          enriched: true,
          provider: "sidecar",
          reason: null,
        };
      }
      reasons.push("sidecar returned no file");
    } catch (err) {
      reasons.push(`sidecar: ${shortError(err)}`);
    }
  }

  if (outOfTime()) {
    reasons.push("ran out of time before tikwm");
  } else {
    try {
      const raw = await withTimeout(
        tikwmDetail(base.shareUrl, true, { timeoutMs: 10_000, attempts: 1 }),
        13_000,
        "tikwm",
      );
      const merged = fromTikwm(raw, base.source, base);
      if (merged && (merged.playUrl || merged.hdPlayUrl)) {
        return {
          video: makeVideo({
            ...merged,
            caption: base.caption || merged.caption,
            matchedTag: base.matchedTag,
            rank: base.rank,
            source: base.source,
          }),
          enriched: true,
          provider: "tikwm",
          reason: null,
        };
      }
      reasons.push("tikwm returned no file");
    } catch (err) {
      reasons.push(`tikwm: ${shortError(err)}`);
    }
  }

  if (!outOfTime()) {
    try {
      const viaApi = await withTimeout(videoDetail(base.id), 12_000, "tiktok.com api");
      if (viaApi && (viaApi.playUrl || viaApi.hdPlayUrl)) {
        return {
          video: makeVideo({
            ...base,
            playUrl: viaApi.playUrl ?? base.playUrl,
            hdPlayUrl: viaApi.hdPlayUrl ?? base.hdPlayUrl,
            ttPlayUrl: viaApi.ttPlayUrl ?? base.ttPlayUrl,
            coverUrl: base.coverUrl ?? viaApi.coverUrl,
            durationSec: base.durationSec ?? viaApi.durationSec,
            enriched: true,
          }),
          enriched: true,
          provider: "tiktok.com api",
          reason: null,
        };
      }
      reasons.push("tiktok.com api returned no file");
    } catch (err) {
      reasons.push(`tiktok.com api: ${shortError(err)}`);
    }
  }

  if (outOfTime()) {
    reasons.push("ran out of time before tiktok.com");
  } else {
    try {
      const web = await withTimeout(
        resolveWebVideo(base.id, {
          username: base.authorUsername === "unknown" ? null : base.authorUsername,
          oembedUrl: base.shareUrl,
        }),
        16_000,
        "tiktok.com",
      );
      if (web?.playUrl || web?.hdPlayUrl) {
        return {
          video: makeVideo({
            ...base,
            playUrl: web.playUrl ?? base.playUrl,
            hdPlayUrl: web.hdPlayUrl ?? base.hdPlayUrl,
            ttPlayUrl: web.ttPlayUrl ?? base.ttPlayUrl,
            coverUrl: base.coverUrl ?? web.coverUrl,
            durationSec: base.durationSec ?? web.durationSec,
            enriched: true,
          }),
          enriched: true,
          provider: "tiktok.com",
          reason: null,
        };
      }
      reasons.push("tiktok.com had no playable file");
    } catch (err) {
      reasons.push(`tiktok.com: ${shortError(err)}`);
    }
  }

  return {
    video: base,
    enriched: Boolean(base.playUrl || base.ttPlayUrl),
    provider: null,
    reason: trim(reasons.join(" · "), 240) || "no upstream answered",
  };
}

/* ── health / diagnostics ─────────────────────────────────────── */

export type ProviderCheck = {
  id: string;
  label: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
};

export async function pingUpstream(): Promise<{
  ok: boolean;
  latencyMs: number;
  detail: string;
  providers: ProviderCheck[];
}> {
  const [sidecar, tikwm, web] = await Promise.all([sidecarCheck(), tikwmPing(), webPing()]);
  const providers: ProviderCheck[] = [];
  if (sidecarUrl()) {
    providers.push({
      id: "sidecar",
      label: `sidecar ${sidecarUrl()}`,
      ok: sidecar.ok,
      latencyMs: sidecar.latencyMs,
      detail: sidecar.detail,
    });
  }
  providers.push(
    {
      id: "tikwm",
      label: `tikwm ${tikwm.base}`,
      ok: tikwm.ok,
      latencyMs: tikwm.latencyMs,
      detail: tikwm.detail,
    },
    {
      id: "tiktok-web",
      label: "tiktok.com (direct reads)",
      ok: web.ok,
      latencyMs: web.latencyMs,
      detail: web.detail,
    },
  );
  return {
    ok: providers.some((provider) => provider.ok),
    latencyMs: Math.max(...providers.map((provider) => provider.latencyMs)),
    detail: providers
      .map((provider) => `${provider.id} ${provider.ok ? "live" : "down"}`)
      .join(" · "),
    providers,
  };
}

/** One-shot health sweep used by /api/tiktok/diagnostics. */
export async function describeProviders(): Promise<ProviderCheck[]> {
  const checks: ProviderCheck[] = [];

  const [sidecar, tikwm, web] = await Promise.all([sidecarCheck(), tikwmPing(), webPing()]);
  if (sidecarUrl()) {
    checks.push({
      id: "sidecar",
      label: `self-hosted fetch service (${sidecarUrl()})`,
      ok: sidecar.ok,
      latencyMs: sidecar.latencyMs,
      detail: sidecar.detail,
    });
  }
  checks.push({
    id: "tikwm-feed",
    label: `tikwm feed (${tikwm.base})`,
    ok: tikwm.ok,
    latencyMs: tikwm.latencyMs,
    detail: tikwm.detail,
  });
  checks.push({
    id: "tiktok-web",
    label: "tiktok.com reachability",
    ok: web.ok,
    latencyMs: web.latencyMs,
    detail: web.detail,
  });

  const apiCheck = await webApiCheck();
  checks.push({
    id: "tiktok-api",
    label: "tiktok.com web api (hashtag list)",
    ok: apiCheck.ok,
    latencyMs: apiCheck.latencyMs,
    detail: apiCheck.detail,
  });

  const searchStarted = Date.now();
  try {
    const page = await tikwmSearch({ keywords: "cat", count: 3 });
    checks.push({
      id: "tikwm-search",
      label: "tikwm keyword search",
      ok: page.raw.length > 0,
      latencyMs: Date.now() - searchStarted,
      detail: page.raw.length
        ? `“cat” → ${page.raw.length} clips`
        : "answering but no clips for “cat”",
    });
  } catch (err) {
    checks.push({
      id: "tikwm-search",
      label: "tikwm keyword search",
      ok: false,
      latencyMs: Date.now() - searchStarted,
      detail: shortError(err),
    });
  }

  const tagStarted = Date.now();
  try {
    const page = await tagPage("cat");
    checks.push({
      id: "tiktok-tag",
      label: "tiktok.com #tag page",
      ok: page.videos.length > 0,
      latencyMs: Date.now() - tagStarted,
      detail: page.videos.length
        ? `#cat → ${page.videos.length} clips`
        : `page read, no inline clips${page.headline ? ` · “${trim(page.headline, 60)}”` : ""}`,
    });
  } catch (err) {
    checks.push({
      id: "tiktok-tag",
      label: "tiktok.com #tag page",
      ok: false,
      latencyMs: Date.now() - tagStarted,
      detail: shortError(err),
    });
  }

  const trendsCheck = await creativeCenterCheck();
  checks.push({
    id: "creative-center",
    label: "TikTok Creative Center trends",
    ok: trendsCheck.ok,
    latencyMs: trendsCheck.latencyMs,
    detail: trendsCheck.detail,
  });

  /* Say out loud when a public relay did the borrowing. */
  const relay = lastUpstreamRelay();
  if (relay) {
    for (const check of checks) {
      if (check.ok && /tikwm/.test(check.id) && !/relay/.test(check.detail)) {
        check.detail = `${check.detail} · via ${relay} relay`;
      }
    }
  }

  return checks;
}

export { REGIONS, extractTikTokLinks, proxiedMedia, smartMedia } from "./tiktok-client";
