export type FetchMode = "search" | "firehose" | "link";

export type TikTokVideo = {
  id: string;
  caption: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatar: string | null;
  coverUrl: string | null;
  originCoverUrl: string | null;
  playUrl: string | null;
  /** TikTok's own signed clip URL (crawler path) — works without enrichment. */
  ttPlayUrl: string | null;
  hdPlayUrl: string | null;
  wmPlayUrl: string | null;
  shareUrl: string;
  musicTitle: string | null;
  musicAuthor: string | null;
  musicUrl: string | null;
  durationSec: number | null;
  region: string | null;
  postedAt: string | null;
  playCount: number | null;
  diggCount: number | null;
  saveCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  creatorFollowers: number | null;
  width: number | null;
  height: number | null;
  /** Which #tag this clip was found under. */
  matchedTag: string | null;
  source: FetchMode;
  fetchedAt: string;
  /** True once tikwm has supplied a watermark-free HD link. */
  enriched: boolean;
  rank: number;
};

export type SearchAttempt = { tag: string; found: number };

export type ProviderAttempt = {
  provider: string;
  query: string;
  found: number;
  error?: string;
  ms: number;
};

export type FetchResult = {
  videos: TikTokVideo[];
  nextCursor: number;
  hasMore: boolean;
  mode: FetchMode;
  upstream: string;
  notice?: string;
  degraded?: boolean;
  tagsTried?: SearchAttempt[];
  attempts?: ProviderAttempt[];
  failures?: { link: string; reason: string }[];
  headline?: string | null;
};

/** One row of the Source panel's provider health sweep. */
export type DiagnosticsCheck = {
  id: string;
  label: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
};

export type UploaderMode = "cli" | "http" | "off";

/** Cookie-session posting status (no developer account needed). */
export type SessionStatus = {
  connected: boolean;
  source: "db" | "env" | "none";
  maskedSessionId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  verified: boolean;
  detail: string | null;
  updatedAt: string | null;
  uploader: {
    mode: UploaderMode;
    requested: string;
    command: string;
    url: string;
    cookiesFileConfigured: boolean;
    ready: boolean | null;
    detail: string;
  };
  instructions: string[];
};

/** Which backend a publish attempt should use. */
export type PublishBackend = "auto" | "session" | "api";

export type PrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export type PublishMode = "DIRECT_POST" | "MEDIA_UPLOAD";

export type TikTokAccount = {
  connected: boolean;
  openId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  scopes: string[];
  expiresAt: string | null;
  source: "oauth" | "env" | "none";
  clientKeyConfigured: boolean;
  clientSecretConfigured: boolean;
  canDirectPost: boolean;
  canDraftUpload: boolean;
  privacyLevels: PrivacyLevel[];
  maxVideoSizeMb: number | null;
  note: string | null;
};

export type PublishJob = {
  id: string;
  tiktokId: string;
  authorUsername: string;
  caption: string;
  mode: PublishMode;
  privacyLevel: PrivacyLevel;
  publishId: string | null;
  /** "api" (Content Posting API) or "session" (cookie-based uploader). */
  provider: string;
  status: string;
  failReason: string | null;
  publicPostIds: string;
  fileName: string | null;
  videoSize: number | null;
  uploadedBytes: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CreditMode = "username" | "nickname" | "both";
export type CreditPlacement = "bottom" | "top" | "inline";
export type EmojiMode = "keep" | "strip" | "boost";
export type CaptionStyle =
  | "verbatim"
  | "relatable"
  | "pov"
  | "question"
  | "shoutout"
  | "minimal";

export type Settings = {
  handle: string;
  creditPrefix: string;
  creditMode: CreditMode;
  creditPlacement: CreditPlacement;
  defaultStyle: CaptionStyle;
  includeOriginal: boolean;
  keepOriginalHashtags: boolean;
  stripMentions: boolean;
  stripBoilerplate: boolean;
  emojiMode: EmojiMode;
  packs: string[];
  extraHashtags: string[];
  blockedHashtags: string[];
  maxHashtags: number;
  maxCaptionLength: number;
  footer: string;
  defaultRegion: string;
  autoSave: boolean;
};

export type SavedPost = {
  id: string;
  tiktokId: string;
  originalCaption: string;
  caption: string;
  captionStyle: string;
  authorUsername: string;
  authorNickname: string;
  authorAvatar: string | null;
  coverUrl: string | null;
  playUrl: string | null;
  hdPlayUrl: string | null;
  shareUrl: string | null;
  musicTitle: string | null;
  durationSec: number | null;
  region: string | null;
  postedAt: string | null;
  playCount: number | null;
  diggCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  status: string;
  note: string;
  source: string;
  savedAt: string;
};

export type CaptionVariant = {
  style: CaptionStyle;
  label: string;
  text: string;
  body: string;
  credit: string;
  tags: string[];
  length: number;
  visibleLine: string;
  warnings: string[];
};
