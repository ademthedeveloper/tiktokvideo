import { makeVideo } from "./video-factory";
import type { TikTokVideo } from "./types";

export type SearchOutcome = {
  videos: TikTokVideo[];
  tagsTried: { tag: string; found: number }[];
  headline: string | null;
  notice?: string;
};

type ResearchVideo = {
  id?: string | number;
  video_id?: string | number;
  username?: string;
  video_description?: string;
  create_time?: number;
  region_code?: string;
  video_duration?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
};

let researchTokenCache: { value: string; expiresAt: number } | null = null;

async function getResearchAccessToken(): Promise<string> {
  const clientKey = process.env.TIKTOK_RESEARCH_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_RESEARCH_CLIENT_SECRET?.trim();

  if (clientKey && clientSecret) {
    if (researchTokenCache && researchTokenCache.expiresAt > Date.now() + 60_000) {
      return researchTokenCache.value;
    }

    const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null);
    const accessToken = payload?.access_token;
    if (!response.ok || typeof accessToken !== "string" || !accessToken) {
      throw new Error(
        "Could not obtain a TikTok Research API token. Check the Research API client credentials and project approval.",
      );
    }
    const expiresIn = Number(payload.expires_in) || 7200;
    researchTokenCache = {
      value: accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return accessToken;
  }

  const staticToken = process.env.TIKTOK_RESEARCH_ACCESS_TOKEN?.trim();
  if (staticToken) return staticToken.replace(/^Bearer\s+/i, "");

  throw new Error(
    "TikTok Research API is not configured. Add TIKTOK_RESEARCH_CLIENT_KEY and TIKTOK_RESEARCH_CLIENT_SECRET from an approved TikTok Research API project.",
  );
}

/** Search public videos using TikTok's approved Research API. */
export async function searchTikTok(opts: {
  keyword: string;
  count?: number;
  region?: string;
}): Promise<SearchOutcome> {
  const token = await getResearchAccessToken();
  const keyword = opts.keyword.trim();
  const count = Math.min(30, Math.max(4, opts.count ?? 10));
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  const dateValue = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");
  const conditions = [
    { operation: "EQ", field_name: "keyword", field_values: [keyword] },
  ];
  const region = opts.region?.toUpperCase();
  if (region && /^[A-Z]{2}$/.test(region)) {
    conditions.push({ operation: "IN", field_name: "region_code", field_values: [region] });
  }

  const fields = [
    "id",
    "video_description",
    "create_time",
    "region_code",
    "share_count",
    "view_count",
    "like_count",
    "comment_count",
    "username",
    "video_duration",
  ].join(",");
  const endpoint = new URL("https://open.tiktokapis.com/v2/research/video/query/");
  endpoint.searchParams.set("fields", fields);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: { and: conditions },
      start_date: dateValue(start),
      end_date: dateValue(end),
      max_count: count,
      cursor: 0,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });

  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    throw new Error("TikTok Research API rejected the token. Check its validity and Research API access.");
  }
  if (response.status === 403) {
    throw new Error(
      "TikTok Research API denied access. The app must be approved for research.data.basic and the token must belong to that approved project.",
    );
  }
  if (!response.ok || payload?.error?.code !== "ok") {
    const detail = String(payload?.error?.message ?? `HTTP ${response.status}`).slice(0, 180);
    throw new Error(`TikTok Research API request failed: ${detail}`);
  }

  const rawVideos: ResearchVideo[] = Array.isArray(payload?.data?.videos)
    ? payload.data.videos
    : [];
  const videos = rawVideos.flatMap((raw, index) => {
    const id = String(raw.id ?? raw.video_id ?? "").trim();
    if (!id) return [];
    const username = raw.username?.trim() || "unknown";
    const shareUrl = `https://www.tiktok.com/@${username}/video/${id}`;
    return [
      makeVideo({
        id,
        caption: raw.video_description ?? "",
        authorUsername: username,
        authorNickname: username,
        shareUrl,
        region: raw.region_code ?? null,
        postedAt: raw.create_time
          ? new Date(raw.create_time * 1000).toISOString()
          : null,
        durationSec: raw.video_duration ?? null,
        playCount: raw.view_count ?? null,
        diggCount: raw.like_count ?? null,
        commentCount: raw.comment_count ?? null,
        shareCount: raw.share_count ?? null,
        source: "search",
        rank: index,
      }),
    ];
  });

  return {
    videos,
    tagsTried: [{ tag: keyword, found: videos.length }],
    headline: null,
    notice: videos.length
      ? `${videos.length} matching public videos from the TikTok Research API (last 30 days).`
      : "No matching public videos were returned for that keyword in the last 30 days.",
  };
}
