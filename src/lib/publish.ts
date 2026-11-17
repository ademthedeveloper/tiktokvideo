import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/init";
import { tiktokAccounts } from "@/db/schema";
import type { PrivacyLevel, PublishMode, TikTokAccount, TikTokVideo } from "./types";

const OPEN_API = "https://open.tiktokapis.com";
const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const CRAWLER_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export const REQUIRED_SCOPES = ["video.publish", "video.upload", "user.info.basic"];
/** TikTok caps FILE_UPLOAD chunks between 5MB and 64MB. */
const MIN_CHUNK = 5 * 1024 * 1024;
const MAX_CHUNK = 64 * 1024 * 1024;
/** Content Posting API title limit (UTF-16 code units). */
export const TITLE_LIMIT = 2200;

export class PublishError extends Error {
  code: string;
  hint?: string;
  constructor(message: string, code = "publish_failed", hint?: string) {
    super(message);
    this.name = "PublishError";
    this.code = code;
    this.hint = hint;
  }
}

export function envConfig() {
  return {
    clientKey: process.env.TIKTOK_CLIENT_KEY?.trim() ?? "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET?.trim() ?? "",
    envToken: process.env.TIKTOK_ACCESS_TOKEN?.trim() ?? "",
    redirectUri: process.env.TIKTOK_REDIRECT_URI?.trim() ?? "",
  };
}

export function callbackUrl(request: Request): string {
  const configured = envConfig().redirectUri;
  if (configured) return configured;
  const forwarded = request.headers.get("x-forwarded-host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwarded
    ? `${proto}://${forwarded}`
    : new URL(request.url).origin;
  return `${origin}/api/tiktok/auth/callback`;
}

/* ── token storage ──────────────────────────────────────────────── */

async function readAccountRow() {
  await ensureSchema();
  const rows = await db
    .select()
    .from(tiktokAccounts)
    .where(eq(tiktokAccounts.id, 1))
    .limit(1);
  return rows[0];
}

export async function getAccessToken(): Promise<{
  token: string;
  scopes: string[];
  source: "oauth" | "env" | "none";
  expiresAt: string | null;
}> {
  const row = await readAccountRow();
  if (row?.accessToken && row.accessToken.length > 12) {
    const expired = row.expiresAt ? row.expiresAt.getTime() < Date.now() + 30_000 : false;
    if (expired && row.refreshToken) {
      try {
        const refreshed = await refreshTokens(row.refreshToken);
        return {
          token: refreshed.access_token,
          scopes: refreshed.scope.split(/[,\s]+/).filter(Boolean),
          source: "oauth",
          expiresAt: refreshed.expiresAt,
        };
      } catch {
        throw new PublishError(
          "Your TikTok session expired and could not be refreshed",
          "token_expired",
          "Reconnect the account to get a fresh token.",
        );
      }
    }
    return {
      token: row.accessToken,
      scopes: (row.scope ?? "").split(/[,\s]+/).filter(Boolean),
      source: "oauth",
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    };
  }

  const { envToken } = envConfig();
  if (envToken) {
    return {
      token: envToken,
      scopes: REQUIRED_SCOPES,
      source: "env",
      expiresAt: null,
    };
  }
  return { token: "", scopes: [], source: "none", expiresAt: null };
}

export async function describeAccount(request?: Request): Promise<TikTokAccount> {
  const { clientKey, clientSecret } = envConfig();
  const auth = await getAccessToken();
  const row = await readAccountRow();

  const account: TikTokAccount = {
    connected: Boolean(auth.token),
    openId: row?.openId ?? null,
    username: row?.username ?? null,
    displayName: row?.displayName ?? null,
    avatarUrl: row?.avatarUrl ?? null,
    scopes: auth.scopes,
    expiresAt: auth.expiresAt,
    source: auth.source,
    clientKeyConfigured: Boolean(clientKey),
    clientSecretConfigured: Boolean(clientSecret),
    canDirectPost: auth.scopes.length === 0 || auth.scopes.includes("video.publish"),
    canDraftUpload: auth.scopes.length === 0 || auth.scopes.includes("video.upload"),
    privacyLevels: ["SELF_ONLY"],
    maxVideoSizeMb: null,
    note: null,
  };

  if (!auth.token) {
    account.note = clientKey
      ? "Client key found — connect your TikTok account to start posting."
      : "Add TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET (or a TIKTOK_ACCESS_TOKEN) to enable posting.";
    return account;
  }

  // Ask TikTok what this creator is actually allowed to do.
  try {
    const info = await postOpenApi("/v2/post/publish/creator_info/query/", auth.token, {});
    const creator = info?.creator_info ?? info;
    const levels = creator?.privacy_level_options;
    if (Array.isArray(levels) && levels.length) {
      account.privacyLevels = levels as PrivacyLevel[];
    }
    const maxSize = Number(creator?.max_video_post_duration_sec ?? 0);
    account.maxVideoSizeMb = maxSize ? null : null;
    account.note = creator?.creator_avatar_url ? account.note : null;
    if (typeof creator?.comment_disabled === "boolean") {
      account.note = `Comments ${creator.comment_disabled ? "disabled" : "enabled"} · duet ${
        creator.duet_disabled ? "disabled" : "enabled"
      } · stitch ${creator.stitch_disabled ? "disabled" : "enabled"}`;
    }
  } catch (err) {
    account.note =
      err instanceof PublishError
        ? `Could not read creator settings: ${err.message}`
        : "Could not reach TikTok's creator info endpoint.";
  }

  if (!account.username && request) {
    try {
      const profile = await postOpenApi(
        "/v2/user/info/",
        auth.token,
        { fields: ["open_id", "display_name", "avatar_url", "username"] },
        {},
      );
      const user = profile?.user ?? profile;
      account.username = user?.username ?? account.username;
      account.displayName = user?.display_name ?? account.displayName;
      account.avatarUrl = user?.avatar_url ?? account.avatarUrl;
      account.openId = user?.open_id ?? account.openId;
    } catch {
      /* profile is optional */
    }
  }

  return account;
}

async function postOpenApi(
  path: string,
  token: string,
  payload: Record<string, unknown>,
  query: Record<string, string> = {},
): Promise<any> {
  const url = new URL(`${OPEN_API}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(payload ?? {}),
      cache: "no-store",
    });
  } catch (err) {
    throw new PublishError(
      "Could not reach open.tiktokapis.com",
      "network",
      err instanceof Error ? err.message : undefined,
    );
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new PublishError(
      `TikTok returned a non-JSON response (${res.status})`,
      "bad_response",
      text.slice(0, 200),
    );
  }
  const code = json?.error?.code ?? "";
  if (code && code !== "ok") {
    throw new PublishError(
      json?.error?.message || code,
      code,
      code === "access_token_invalid"
        ? "The stored token is no longer valid — reconnect your TikTok account."
        : code === "scope_not_authorized"
          ? "Your app does not have the video.publish scope approved."
          : undefined,
    );
  }
  if (!res.ok) {
    throw new PublishError(
      `TikTok responded ${res.status}`,
      `http_${res.status}`,
      json?.error?.message,
    );
  }
  return json?.data ?? json;
}

/* ── OAuth ──────────────────────────────────────────────────────── */

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const { clientKey } = envConfig();
  if (!clientKey) {
    throw new PublishError(
      "TIKTOK_CLIENT_KEY is not configured",
      "missing_client_key",
      "Add your TikTok app's client key to the environment.",
    );
  }
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("scope", REQUIRED_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(code: string, redirectUri: string) {
  const { clientKey, clientSecret } = envConfig();
  if (!clientKey || !clientSecret) {
    throw new PublishError(
      "TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be set to exchange a code",
      "missing_credentials",
    );
  }
  const res = await fetch(`${OPEN_API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  const json: any = await res.json().catch(() => ({}));
  if (json?.error && json.error !== "ok") {
    throw new PublishError(
      json.error_description ?? json.error,
      "oauth_exchange_failed",
      json.error_hint,
    );
  }
  if (!json?.access_token) {
    throw new PublishError("TikTok did not return an access token", "oauth_no_token");
  }
  await storeTokens(json);
  return json;
}

export async function refreshTokens(refreshToken: string) {
  const { clientKey, clientSecret } = envConfig();
  if (!clientKey || !clientSecret) {
    throw new PublishError("Client key/secret required to refresh", "missing_credentials");
  }
  const res = await fetch(`${OPEN_API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  const json: any = await res.json().catch(() => ({}));
  if (!json?.access_token) {
    throw new PublishError(
      json?.error_description ?? json?.error ?? "refresh failed",
      "refresh_failed",
    );
  }
  await storeTokens(json);
  return {
    access_token: json.access_token as string,
    scope: String(json.scope ?? ""),
    expiresAt: new Date(Date.now() + Number(json.expires_in ?? 86400) * 1000).toISOString(),
  };
}

async function storeTokens(json: any) {
  await ensureSchema();
  const expiresAt = new Date(Date.now() + Number(json.expires_in ?? 86400) * 1000);
  const values = {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : null,
    scope: String(json.scope ?? ""),
    openId: json.open_id ? String(json.open_id) : null,
    expiresAt,
    updatedAt: new Date(),
  };
  await db
    .insert(tiktokAccounts)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: tiktokAccounts.id, set: values });
}

/** Store a token pasted straight from the TikTok developer console. */
export async function storeManualToken(accessToken: string, scope = "") {
  const token = accessToken.trim();
  if (token.length < 12) {
    throw new PublishError("That does not look like an access token", "bad_token");
  }
  await ensureSchema();
  const values = {
    accessToken: token,
    refreshToken: null,
    scope: scope || REQUIRED_SCOPES.join(","),
    expiresAt: new Date(Date.now() + 23 * 3600 * 1000),
    updatedAt: new Date(),
  };
  await db
    .insert(tiktokAccounts)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: tiktokAccounts.id, set: values });
  return values;
}

export async function disconnectAccount() {
  await ensureSchema();
  await db.delete(tiktokAccounts).where(eq(tiktokAccounts.id, 1));
}

/* ── video bytes ────────────────────────────────────────────────── */

/** Download the clip we are going to post (watermark-free when possible). */
export async function resolveClipBytes(video: TikTokVideo): Promise<{
  bytes: Buffer;
  fileName: string;
  origin: string;
}> {
  const candidates: { url: string; ua: string; origin: string }[] = [];
  if (video.hdPlayUrl) candidates.push({ url: video.hdPlayUrl, ua: BROWSER_UA, origin: "tikwm HD" });
  if (video.playUrl && video.playUrl !== video.hdPlayUrl)
    candidates.push({ url: video.playUrl, ua: BROWSER_UA, origin: "tikwm SD" });
  if (video.ttPlayUrl) candidates.push({ url: video.ttPlayUrl, ua: CRAWLER_UA, origin: "tiktok.com" });

  let lastError = "no media URL on this clip";
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate.url, {
        headers: { "User-Agent": candidate.ua, Referer: "https://www.tiktok.com/" },
        cache: "no-store",
        redirect: "follow",
      });
      if (!res.ok) {
        lastError = `${candidate.origin} responded ${res.status}`;
        continue;
      }
      const arrayBuffer = await res.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);
      if (bytes.byteLength < 2048) {
        lastError = `${candidate.origin} returned an empty file`;
        continue;
      }
      return {
        bytes,
        fileName: `tiktok-${video.authorUsername}-${video.id}.mp4`,
        origin: candidate.origin,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "download failed";
    }
  }
  throw new PublishError(
    "Could not download the clip",
    "media_unavailable",
    `${lastError}. Open the dossier and hit “Resolve file” first.`,
  );
}

/* ── publish ────────────────────────────────────────────────────── */

export type PublishInput = {
  token: string;
  caption: string;
  privacyLevel: PrivacyLevel;
  mode: PublishMode;
  bytes: Buffer;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  coverTimestampMs?: number;
  isAigc?: boolean;
};

export async function publishVideo(input: PublishInput): Promise<{
  publishId: string;
  uploadUrl: string | null;
}> {
  const size = input.bytes.byteLength;
  if (size <= 0) throw new PublishError("Empty video file", "empty_file");
  if (size > 4 * 1024 * 1024 * 1024)
    throw new PublishError("Video is over 4GB", "too_large");

  const caption = input.caption.slice(0, TITLE_LIMIT);
  const direct = input.mode === "DIRECT_POST";
  const path = direct
    ? "/v2/post/publish/video/init/"
    : "/v2/post/publish/inbox/video/init/";

  // Files under 5MB must go as a single chunk; larger files split at <=64MB.
  const chunkSize = size < MIN_CHUNK ? size : Math.min(MAX_CHUNK, size);
  const totalChunks = Math.max(1, Math.ceil(size / chunkSize));

  const initPayload: Record<string, unknown> = {
    source_info: {
      source: "FILE_UPLOAD",
      video_size: size,
      chunk_size: chunkSize,
      total_chunk_count: totalChunks,
    },
  };
  if (direct) {
    initPayload.post_info = {
      title: caption,
      privacy_level: input.privacyLevel,
      disable_comment: Boolean(input.disableComment),
      disable_duet: Boolean(input.disableDuet),
      disable_stitch: Boolean(input.disableStitch),
      video_cover_timestamp_ms: Math.max(0, Math.floor(input.coverTimestampMs ?? 1000)),
      ...(input.isAigc ? { is_aigc: true } : {}),
    };
  }

  const init = await postOpenApi(path, input.token, initPayload);
  const publishId = String(init?.publish_id ?? "");
  const uploadUrl = init?.upload_url ? String(init.upload_url) : null;
  if (!publishId) throw new PublishError("TikTok did not return a publish_id", "no_publish_id");
  if (!uploadUrl) throw new PublishError("TikTok did not return an upload_url", "no_upload_url");

  // PUT the bytes, chunk by chunk, with the exact ranges TikTok expects.
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(size, start + chunkSize) - 1;
    const chunk = input.bytes.subarray(start, end + 1);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
      body: new Uint8Array(chunk),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new PublishError(
        `Upload chunk ${index + 1}/${totalChunks} failed (${res.status})`,
        "upload_failed",
        detail,
      );
    }
  }

  return { publishId, uploadUrl };
}

export async function fetchPublishStatus(token: string, publishId: string) {
  const data = await postOpenApi("/v2/post/publish/status/fetch/", token, {
    publish_id: publishId,
  });
  return {
    status: String(data?.status ?? "PROCESSING_UPLOAD"),
    failReason: data?.fail_reason ? String(data.fail_reason) : null,
    publicPostIds: Array.isArray(data?.publicaly_available_post_id)
      ? data.publicaly_available_post_id.map((value: unknown) => String(value)).join(",")
      : "",
    uploadedBytes: data?.uploaded_bytes != null ? Number(data.uploaded_bytes) : null,
    downloadedBytes: data?.downloaded_bytes != null ? Number(data.downloaded_bytes) : null,
  };
}

export const PRIVACY_LEVELS: { id: PrivacyLevel; label: string; blurb: string }[] = [
  {
    id: "PUBLIC_TO_EVERYONE",
    label: "Public",
    blurb: "Visible to everyone. Needs an audited TikTok app.",
  },
  {
    id: "MUTUAL_FOLLOW_FRIENDS",
    label: "Mutual follow",
    blurb: "Only people you follow who follow you back.",
  },
  {
    id: "FOLLOWER_OF_CREATOR",
    label: "Followers",
    blurb: "Anyone who follows your account.",
  },
  {
    id: "SELF_ONLY",
    label: "Only me",
    blurb: "Private. The only level allowed before your app passes audit.",
  },
];
