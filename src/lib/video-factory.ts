import type { TikTokVideo } from "./types";

/** Fills every TikTokVideo field so partial sources stay type-safe. */
export function makeVideo(input: Partial<TikTokVideo> & { id: string }): TikTokVideo {
  return {
    id: input.id,
    caption: input.caption ?? "",
    authorUsername: input.authorUsername ?? "unknown",
    authorNickname: input.authorNickname ?? input.authorUsername ?? "unknown",
    authorAvatar: input.authorAvatar ?? null,
    coverUrl: input.coverUrl ?? null,
    originCoverUrl: input.originCoverUrl ?? null,
    playUrl: input.playUrl ?? null,
    ttPlayUrl: input.ttPlayUrl ?? null,
    hdPlayUrl: input.hdPlayUrl ?? null,
    wmPlayUrl: input.wmPlayUrl ?? null,
    shareUrl:
      input.shareUrl ??
      `https://www.tiktok.com/@${input.authorUsername ?? "unknown"}/video/${input.id}`,
    musicTitle: input.musicTitle ?? null,
    musicAuthor: input.musicAuthor ?? null,
    musicUrl: input.musicUrl ?? null,
    durationSec: input.durationSec ?? null,
    region: input.region ?? null,
    postedAt: input.postedAt ?? null,
    playCount: input.playCount ?? null,
    diggCount: input.diggCount ?? null,
    saveCount: input.saveCount ?? null,
    commentCount: input.commentCount ?? null,
    shareCount: input.shareCount ?? null,
    creatorFollowers: input.creatorFollowers ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    matchedTag: input.matchedTag ?? null,
    source: input.source ?? "search",
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    enriched: input.enriched ?? false,
    rank: input.rank ?? 0,
  };
}
