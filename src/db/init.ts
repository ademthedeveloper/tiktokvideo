import { sql } from "drizzle-orm";
import { db } from "@/db";

let ensured: Promise<void> | null = null;

/**
 * Idempotent bootstrap so the app keeps working on a freshly created database
 * even before `drizzle-kit push` has been run.
 */
export function ensureSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS posts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tiktok_id text NOT NULL UNIQUE,
          original_caption text NOT NULL DEFAULT '',
          caption text NOT NULL DEFAULT '',
          caption_style text NOT NULL DEFAULT 'verbatim',
          author_username text NOT NULL DEFAULT '',
          author_nickname text NOT NULL DEFAULT '',
          author_avatar text,
          cover_url text,
          play_url text,
          hd_play_url text,
          share_url text,
          music_title text,
          duration_sec integer,
          region text,
          posted_at timestamptz,
          play_count integer,
          digg_count integer,
          comment_count integer,
          share_count integer,
          status text NOT NULL DEFAULT 'queued',
          note text NOT NULL DEFAULT '',
          source text NOT NULL DEFAULT 'firehose',
          saved_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_settings (
          id integer PRIMARY KEY DEFAULT 1,
          handle text NOT NULL DEFAULT '',
          credit_prefix text NOT NULL DEFAULT 'cr:',
          credit_mode text NOT NULL DEFAULT 'username',
          credit_placement text NOT NULL DEFAULT 'bottom',
          default_style text NOT NULL DEFAULT 'verbatim',
          include_original boolean NOT NULL DEFAULT true,
          keep_original_hashtags boolean NOT NULL DEFAULT true,
          strip_mentions boolean NOT NULL DEFAULT false,
          strip_boilerplate boolean NOT NULL DEFAULT true,
          emoji_mode text NOT NULL DEFAULT 'keep',
          packs text NOT NULL DEFAULT 'relatable,funny',
          extra_hashtags text NOT NULL DEFAULT '',
          blocked_hashtags text NOT NULL DEFAULT '',
          max_hashtags integer NOT NULL DEFAULT 6,
          max_caption_length integer NOT NULL DEFAULT 2200,
          footer text NOT NULL DEFAULT '',
          default_region text NOT NULL DEFAULT 'US',
          auto_save boolean NOT NULL DEFAULT false,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS caption_logs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tiktok_id text NOT NULL,
          author_username text NOT NULL DEFAULT '',
          style text NOT NULL,
          body text NOT NULL,
          chosen boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS tiktok_accounts (
          id integer PRIMARY KEY DEFAULT 1,
          open_id text,
          access_token text NOT NULL,
          refresh_token text,
          scope text NOT NULL DEFAULT '',
          expires_at timestamptz,
          username text,
          display_name text,
          avatar_url text,
          connected_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS publish_jobs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          post_id uuid,
          tiktok_id text NOT NULL DEFAULT '',
          source_username text NOT NULL DEFAULT '',
          caption text NOT NULL DEFAULT '',
          mode text NOT NULL DEFAULT 'DIRECT_POST',
          privacy_level text NOT NULL DEFAULT 'SELF_ONLY',
          file_name text,
          video_size integer,
          uploaded_bytes integer,
          publish_id text,
          status text NOT NULL DEFAULT 'PENDING',
          fail_reason text,
          public_post_ids text NOT NULL DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.execute(
        sql`INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
      );
      await db.execute(
        sql`INSERT INTO tiktok_accounts (id, access_token) VALUES (1, '') ON CONFLICT (id) DO NOTHING`,
      );
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
