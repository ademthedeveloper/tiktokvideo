import type { PublishJob, SavedPost, TikTokVideo } from "./types";
import { makeVideo } from "./video-factory";

/** Row → API/UI shape for saved clips. */
export function toSavedPost(row: any): SavedPost {
  return {
    id: String(row.id),
    tiktokId: String(row.tiktokId ?? ""),
    originalCaption: row.originalCaption ?? "",
    caption: row.caption ?? "",
    captionStyle: row.captionStyle ?? "verbatim",
    authorUsername: row.authorUsername ?? "",
    authorNickname: row.authorNickname ?? "",
    authorAvatar: row.authorAvatar ?? null,
    coverUrl: row.coverUrl ?? null,
    playUrl: row.playUrl ?? null,
    hdPlayUrl: row.hdPlayUrl ?? null,
    shareUrl: row.shareUrl ?? null,
    musicTitle: row.musicTitle ?? null,
    durationSec: row.durationSec ?? null,
    region: row.region ?? null,
    postedAt: row.postedAt ? new Date(row.postedAt).toISOString() : null,
    playCount: row.playCount ?? null,
    diggCount: row.diggCount ?? null,
    commentCount: row.commentCount ?? null,
    shareCount: row.shareCount ?? null,
    status: row.status ?? "queued",
    note: row.note ?? "",
    source: row.source ?? "firehose",
    savedAt: row.savedAt ? new Date(row.savedAt).toISOString() : new Date().toISOString(),
  };
}

/** Saved queue row → the video shape the desk and publisher work with. */
export function postToVideo(post: SavedPost): TikTokVideo {
  return makeVideo({
    id: post.tiktokId,
    caption: post.originalCaption || post.caption,
    authorUsername: post.authorUsername,
    authorNickname: post.authorNickname,
    authorAvatar: post.authorAvatar,
    coverUrl: post.coverUrl,
    originCoverUrl: post.coverUrl,
    playUrl: post.playUrl,
    hdPlayUrl: post.hdPlayUrl,
    ttPlayUrl: post.playUrl,
    shareUrl: post.shareUrl ?? undefined,
    musicTitle: post.musicTitle,
    durationSec: post.durationSec,
    region: post.region,
    postedAt: post.postedAt,
    playCount: post.playCount,
    diggCount: post.diggCount,
    commentCount: post.commentCount,
    shareCount: post.shareCount,
    source: post.source === "link" ? "link" : post.source === "firehose" ? "firehose" : "search",
    enriched: Boolean(post.hdPlayUrl),
  });
}

export function toPublishJob(row: any): PublishJob {
  return {
    id: String(row.id),
    tiktokId: String(row.tiktokId ?? ""),
    authorUsername: row.sourceUsername ?? "",
    caption: row.caption ?? "",
    mode: row.mode ?? "DIRECT_POST",
    privacyLevel: row.privacyLevel ?? "SELF_ONLY",
    publishId: row.publishId ?? null,
    provider: row.provider ?? "",
    status: row.status ?? "PENDING",
    failReason: row.failReason ?? null,
    publicPostIds: row.publicPostIds ?? "",
    fileName: row.fileName ?? null,
    videoSize: row.videoSize ?? null,
    uploadedBytes: row.uploadedBytes ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
  };
}
