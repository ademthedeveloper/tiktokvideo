import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Clips the curator pulled into the posting queue. */
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tiktokId: text("tiktok_id").notNull().unique(),
  originalCaption: text("original_caption").notNull().default(""),
  caption: text("caption").notNull().default(""),
  captionStyle: text("caption_style").notNull().default("verbatim"),
  authorUsername: text("author_username").notNull().default(""),
  authorNickname: text("author_nickname").notNull().default(""),
  authorAvatar: text("author_avatar"),
  coverUrl: text("cover_url"),
  playUrl: text("play_url"),
  hdPlayUrl: text("hd_play_url"),
  shareUrl: text("share_url"),
  musicTitle: text("music_title"),
  durationSec: integer("duration_sec"),
  region: text("region"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  playCount: integer("play_count"),
  diggCount: integer("digg_count"),
  commentCount: integer("comment_count"),
  shareCount: integer("share_count"),
  status: text("status").notNull().default("queued"),
  note: text("note").notNull().default(""),
  source: text("source").notNull().default("firehose"),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Single-row caption recipe used by the generator. */
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  handle: text("handle").notNull().default(""),
  creditPrefix: text("credit_prefix").notNull().default("cr:"),
  creditMode: text("credit_mode").notNull().default("username"),
  creditPlacement: text("credit_placement").notNull().default("bottom"),
  defaultStyle: text("default_style").notNull().default("verbatim"),
  includeOriginal: boolean("include_original").notNull().default(true),
  keepOriginalHashtags: boolean("keep_original_hashtags")
    .notNull()
    .default(true),
  stripMentions: boolean("strip_mentions").notNull().default(false),
  stripBoilerplate: boolean("strip_boilerplate").notNull().default(true),
  emojiMode: text("emoji_mode").notNull().default("keep"),
  packs: text("packs").notNull().default("relatable,funny"),
  extraHashtags: text("extra_hashtags").notNull().default(""),
  blockedHashtags: text("blocked_hashtags").notNull().default(""),
  maxHashtags: integer("max_hashtags").notNull().default(6),
  maxCaptionLength: integer("max_caption_length").notNull().default(2200),
  footer: text("footer").notNull().default(""),
  defaultRegion: text("default_region").notNull().default("US"),
  autoSave: boolean("auto_save").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Every caption the desk has cooked up, so nothing gets lost. */
export const captionLogs = pgTable("caption_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tiktokId: text("tiktok_id").notNull(),
  authorUsername: text("author_username").notNull().default(""),
  style: text("style").notNull(),
  body: text("body").notNull(),
  chosen: boolean("chosen").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Connected TikTok creator (OAuth tokens from the Content Posting API). */
export const tiktokAccounts = pgTable("tiktok_accounts", {
  id: integer("id").primaryKey().default(1),
  openId: text("open_id"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  scope: text("scope").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  username: text("username"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every publish attempt made from the desk. */
export const publishJobs = pgTable("publish_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id"),
  tiktokId: text("tiktok_id").notNull().default(""),
  sourceUsername: text("source_username").notNull().default(""),
  caption: text("caption").notNull().default(""),
  mode: text("mode").notNull().default("DIRECT_POST"),
  privacyLevel: text("privacy_level").notNull().default("SELF_ONLY"),
  fileName: text("file_name"),
  videoSize: integer("video_size"),
  uploadedBytes: integer("uploaded_bytes"),
  publishId: text("publish_id"),
  status: text("status").notNull().default("PENDING"),
  failReason: text("fail_reason"),
  publicPostIds: text("public_post_ids").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PostRow = typeof posts.$inferSelect;
export type SettingsRow = typeof appSettings.$inferSelect;
export type AccountRow = typeof tiktokAccounts.$inferSelect;
export type JobRow = typeof publishJobs.$inferSelect;
