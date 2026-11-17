/**
 * Post to TikTok without a developer account.
 *
 * A TikTok "sessionid" cookie is the whole credential: it is what your browser
 * uses after you log in. The open-source uploader tools (wkaisertexas/
 * tiktok-uploader, MIT) drive a real browser with that cookie to post a video.
 * This module bridges the desk to whichever tool you installed:
 *
 *   TIKTOK_UPLOAD_MODE=cli    run a command per upload (default: tiktok-uploader)
 *   TIKTOK_UPLOAD_MODE=http   POST the file to an uploader you run as a service
 *   TIKTOK_UPLOAD_MODE=off    disabled
 *
 * Nothing here needs an app review, a client key or a redirect URI.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/init";
import { tiktokSessions } from "@/db/schema";
import type { SessionStatus, UploaderMode } from "./types";
import { probeSession, type SessionProbe } from "./providers/tiktok-web";

export class SessionPublishError extends Error {
  code: string;
  hint?: string;
  constructor(message: string, code = "session_upload_failed", hint?: string) {
    super(message);
    this.name = "SessionPublishError";
    this.code = code;
    this.hint = hint;
  }
}

export type UploaderConfig = {
  /** What the desk should do: cli, http, off, or auto (http when a URL is set). */
  requested: UploaderMode | "auto";
  mode: UploaderMode;
  /** Command template; placeholders: {file} {caption} {cookies} {visibility}. */
  command: string;
  /** First token of the command, used for the readiness probe. */
  bin: string;
  url: string;
  token: string;
  cookieFile: string;
  timeoutMs: number;
};

const DEFAULT_COMMAND = "tiktok-uploader -v {file} -d {caption} -c {cookies}";

export function uploaderConfig(): UploaderConfig {
  const raw = (process.env.TIKTOK_UPLOAD_MODE ?? "auto").trim().toLowerCase();
  const requested: UploaderMode | "auto" =
    raw === "cli" || raw === "http" || raw === "off" ? raw : "auto";
  const url = process.env.TIKTOK_UPLOADER_URL?.trim() ?? "";
  const command = process.env.TIKTOK_UPLOADER_CMD?.trim() || DEFAULT_COMMAND;
  const mode: UploaderMode =
    requested === "auto" ? (url ? "http" : "cli") : requested;
  const bin = process.env.TIKTOK_UPLOADER_BIN?.trim() || tokenize(command)[0] || "tiktok-uploader";
  return {
    requested,
    mode,
    command,
    bin,
    url,
    token: process.env.TIKTOK_UPLOADER_TOKEN?.trim() ?? "",
    cookieFile: process.env.TIKTOK_COOKIES_FILE?.trim() ?? "",
    timeoutMs: Math.max(
      20_000,
      Number(process.env.TIKTOK_UPLOADER_TIMEOUT_MS ?? 240_000) || 240_000,
    ),
  };
}

/* ── stored session ────────────────────────────────────────────── */

export type StoredSession = {
  sessionId: string;
  cookieHeader: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  verified: boolean;
  note: string;
  updatedAt: string | null;
  source: "db" | "env" | "none";
};

async function readRow() {
  await ensureSchema();
  const rows = await db.select().from(tiktokSessions).where(eq(tiktokSessions.id, 1)).limit(1);
  return rows[0];
}

function sessionIdFromCookie(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /(?:^|;\s*)sessionid=([^;]+)/.exec(trimmed);
  if (match) return decodeURIComponent(match[1].trim());
  if (/^[A-Za-z0-9%._-]{16,}$/.test(trimmed)) return decodeURIComponent(trimmed);
  return null;
}

export async function getSession(): Promise<StoredSession> {
  const envSession =
    sessionIdFromCookie(process.env.TIKTOK_SESSION_ID ?? "") ??
    sessionIdFromCookie(process.env.TIKTOK_COOKIE ?? "");

  try {
    const row = await readRow();
    if (row?.sessionId) {
      return {
        sessionId: row.sessionId,
        cookieHeader: row.cookieHeader || `sessionid=${row.sessionId}`,
        username: row.username ?? null,
        displayName: row.displayName ?? null,
        avatarUrl: row.avatarUrl ?? null,
        verified: Boolean(row.verified),
        note: row.note ?? "",
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        source: "db",
      };
    }
  } catch {
    /* database down — fall back to the env session below */
  }

  if (envSession) {
    return {
      sessionId: envSession,
      cookieHeader: process.env.TIKTOK_COOKIE?.trim() || `sessionid=${envSession}`,
      username: null,
      displayName: null,
      avatarUrl: null,
      verified: false,
      note: "read from TIKTOK_SESSION_ID / TIKTOK_COOKIE",
      updatedAt: null,
      source: "env",
    };
  }

  return {
    sessionId: "",
    cookieHeader: "",
    username: null,
    displayName: null,
    avatarUrl: null,
    verified: false,
    note: "",
    updatedAt: null,
    source: "none",
  };
}

export async function saveSession(input: {
  sessionId?: string;
  cookie?: string;
}): Promise<StoredSession> {
  const raw = (input.cookie ?? input.sessionId ?? "").trim();
  const sessionId = sessionIdFromCookie(raw);
  if (!sessionId || sessionId.length < 16) {
    throw new SessionPublishError(
      "That does not look like a TikTok sessionid",
      "bad_session",
      "Copy the value of the `sessionid` cookie from tiktok.com in your browser's dev tools (Application → Cookies).",
    );
  }

  const cookieHeader = /sessionid=/.test(raw) ? raw : `sessionid=${sessionId}`;
  // Never let a slow/filtered TikTok hold up saving the cookie.
  const probe = await Promise.race<SessionProbe>([
    probeSession(sessionId),
    new Promise<SessionProbe>((resolve) =>
      setTimeout(
        () =>
          resolve({
            verified: false,
            username: null,
            displayName: null,
            avatarUrl: null,
            detail: "TikTok did not answer the identity check in time — session stored anyway",
          }),
        10_000,
      ),
    ),
  ]);

  const values = {
    sessionId,
    cookieHeader,
    username: probe.username,
    displayName: probe.displayName,
    avatarUrl: probe.avatarUrl,
    verified: probe.verified,
    note: probe.detail,
    updatedAt: new Date(),
  };
  try {
    await ensureSchema();
    await db
      .insert(tiktokSessions)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: tiktokSessions.id, set: values });
  } catch (err) {
    throw new SessionPublishError(
      "Could not save the session — the database is unavailable",
      "db_error",
      err instanceof Error ? err.message.split("\n")[0].slice(0, 160) : undefined,
    );
  }

  return {
    sessionId,
    cookieHeader,
    username: probe.username,
    displayName: probe.displayName,
    avatarUrl: probe.avatarUrl,
    verified: probe.verified,
    note: probe.detail,
    updatedAt: values.updatedAt.toISOString(),
    source: "db",
  };
}

export async function clearSession(): Promise<void> {
  try {
    await ensureSchema();
    await db.delete(tiktokSessions).where(eq(tiktokSessions.id, 1));
  } catch (err) {
    throw new SessionPublishError(
      "Could not clear the session — the database is unavailable",
      "db_error",
      err instanceof Error ? err.message.split("\n")[0].slice(0, 160) : undefined,
    );
  }
}

function mask(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function describeSession(): Promise<SessionStatus> {
  const session = await getSession();
  const config = uploaderConfig();
  return {
    connected: Boolean(session.sessionId) || Boolean(config.cookieFile),
    source: session.source,
    maskedSessionId: session.sessionId ? mask(session.sessionId) : null,
    username: session.username,
    displayName: session.displayName,
    avatarUrl: session.avatarUrl,
    verified: session.verified,
    detail: session.note || null,
    updatedAt: session.updatedAt,
    uploader: {
      mode: config.mode,
      requested: config.requested,
      command: config.mode === "cli" ? config.command : config.url ? "POST <upload url>" : "—",
      url: config.url,
      cookiesFileConfigured: Boolean(config.cookieFile),
      ready: null,
      detail:
        config.mode === "off"
          ? "Session uploads are switched off (TIKTOK_UPLOAD_MODE=off)."
          : config.mode === "http"
            ? `Uploads go to ${config.url}`
            : `Uploads shell out to: ${config.command}`,
    },
    instructions: [
      "Install the open-source uploader: pip install tiktok-uploader && playwright install chromium",
      "Log in to tiktok.com in your browser, open DevTools → Application → Cookies → .tiktok.com",
      "Copy the `sessionid` value and paste it above (or set TIKTOK_SESSION_ID)",
      "Optionally point TIKTOK_UPLOADER_CMD at your own tool — {file}, {caption}, {cookies} are substituted",
    ],
  };
}

/** Is the configured uploader actually present on this machine? */
export async function probeUploader(): Promise<{
  ok: boolean;
  mode: UploaderMode;
  detail: string;
  latencyMs: number;
}> {
  const config = uploaderConfig();
  const started = Date.now();

  if (config.mode === "off") {
    return { ok: false, mode: "off", detail: "session uploads disabled", latencyMs: 0 };
  }

  if (config.mode === "http") {
    if (!config.url) {
      return { ok: false, mode: "http", detail: "TIKTOK_UPLOADER_URL is empty", latencyMs: 0 };
    }
    try {
      const res = await fetch(config.url, {
        method: "GET",
        headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      return {
        ok: res.status < 500,
        mode: "http",
        detail: `${config.url} → HTTP ${res.status}`,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        ok: false,
        mode: "http",
        detail: `${config.url} unreachable: ${err instanceof Error ? err.message : "error"}`,
        latencyMs: Date.now() - started,
      };
    }
  }

  return new Promise((resolve) => {
    execFile(
      config.bin,
      ["--version"],
      { timeout: 10_000, env: process.env },
      (error, stdout, stderr) => {
        const latencyMs = Date.now() - started;
        if (error) {
          resolve({
            ok: false,
            mode: "cli",
            detail: `“${config.bin}” not runnable (${
              error.message.split("\n")[0]
            }). pip install tiktok-uploader`,
            latencyMs,
          });
          return;
        }
        const version = `${stdout} ${stderr}`.trim().split("\n")[0];
        resolve({
          ok: true,
          mode: "cli",
          detail: `${config.bin} ${version || "found"}`.trim(),
          latencyMs,
        });
      },
    );
  });
}

/* ── upload ───────────────────────────────────────────────────── */

export type SessionUploadInput = {
  bytes: Buffer;
  fileName: string;
  caption: string;
  visibility: "everyone" | "friends" | "only_you";
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
};

export type SessionUploadResult = {
  ok: boolean;
  status: "PUBLISH_COMPLETE" | "FAILED";
  message: string;
  provider: string;
  detail: string | null;
};

function tokenize(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

export function sessionCookieFile(cookieHeader: string): string {
  const expiry = Math.floor(Date.now() / 1000) + 180 * 24 * 3600;
  const lines = ["# Netscape HTTP Cookie File", "# written by the TikTok desk"];
  const pairs = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!name) continue;
    lines.push(`.tiktok.com\tTRUE\t/\tFALSE\t${expiry}\t${name}\t${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function uploadWithSession(input: SessionUploadInput): Promise<SessionUploadResult> {
  const config = uploaderConfig();
  if (config.mode === "off") {
    throw new SessionPublishError(
      "Session uploads are disabled",
      "session_disabled",
      "Set TIKTOK_UPLOAD_MODE=cli (or http) to enable them.",
    );
  }

  const session = await getSession();
  if (!session.sessionId && !config.cookieFile) {
    throw new SessionPublishError(
      "No TikTok session stored",
      "no_session",
      "Paste your TikTok sessionid on the Publish tab (or set TIKTOK_SESSION_ID).",
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), "tiktok-desk-"));
  const baseName = input.fileName.replace(/[^\w.-]+/g, "-").slice(-64) || "clip.mp4";
  const filePath = join(workDir, baseName.endsWith(".mp4") ? baseName : `${baseName}.mp4`);
  const cookiesPath = config.cookieFile || join(workDir, "cookies.txt");

  try {
    await writeFile(filePath, input.bytes);
    if (!config.cookieFile) {
      await writeFile(cookiesPath, sessionCookieFile(session.cookieHeader || `sessionid=${session.sessionId}`), {
        mode: 0o600,
      });
    }

    if (config.mode === "http") {
      return await uploadOverHttp(config, input, filePath);
    }

    return await uploadViaCommand(config, input, filePath, cookiesPath, session.sessionId);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function uploadViaCommand(
  config: UploaderConfig,
  input: SessionUploadInput,
  filePath: string,
  cookiesPath: string,
  sessionId: string,
): Promise<SessionUploadResult> {
  const args = tokenize(config.command).map((token) =>
    token
      .replaceAll("{file}", filePath)
      .replaceAll("{caption}", input.caption)
      .replaceAll("{cookies}", cookiesPath)
      .replaceAll("{visibility}", input.visibility)
      .replaceAll("{file_name}", input.fileName),
  );
  if (!args.length) {
    throw new SessionPublishError("TIKTOK_UPLOADER_CMD is empty", "bad_config");
  }

  const bin = args[0];
  const rest = args.slice(1);

  return new Promise<SessionUploadResult>((resolve, reject) => {
    execFile(
      bin,
      rest,
      {
        timeout: config.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          // Several uploaders (and the Python CLI's `tiktok-auth` flow) read this.
          TIKTOK_SESSION: sessionId || process.env.TIKTOK_SESSION || "",
        },
      },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
        const tail = output.split("\n").filter(Boolean).slice(-4).join(" · ").slice(0, 400);

        if (!error) {
          resolve({
            ok: true,
            status: "PUBLISH_COMPLETE",
            message: "Posted with your logged-in TikTok session.",
            provider: `session · ${bin}`,
            detail: tail || null,
          });
          return;
        }

        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(
            new SessionPublishError(
              `The uploader command “${bin}” was not found`,
              "uploader_missing",
              "pip install tiktok-uploader && playwright install chromium — or set TIKTOK_UPLOADER_CMD to your own tool.",
            ),
          );
          return;
        }
        if (code === "ETIMEDOUT" || /timed out/i.test(error.message)) {
          reject(
            new SessionPublishError(
              "The uploader took too long and was stopped",
              "uploader_timeout",
              "Raise TIKTOK_UPLOADER_TIMEOUT_MS if your machine is slow.",
            ),
          );
          return;
        }

        resolve({
          ok: false,
          status: "FAILED",
          message: tail || error.message.split("\n")[0] || "the uploader exited with an error",
          provider: `session · ${bin}`,
          detail: tail || null,
        });
      },
    );
  });
}

async function uploadOverHttp(
  config: UploaderConfig,
  input: SessionUploadInput,
  filePath: string,
): Promise<SessionUploadResult> {
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(filePath);
  const endpoint = /\/[^/]*$/.test(new URL(config.url).pathname)
    ? config.url
    : `${config.url.replace(/\/+$/, "")}/upload`;

  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), input.fileName);
  form.set("caption", input.caption);
  form.set("description", input.caption);
  form.set("visibility", input.visibility);
  form.set("disableComment", String(Boolean(input.disableComment)));
  form.set("disableDuet", String(Boolean(input.disableDuet)));
  form.set("disableStitch", String(Boolean(input.disableStitch)));

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      body: form,
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    throw new SessionPublishError(
      "Could not reach the uploader service",
      "uploader_unreachable",
      err instanceof Error ? err.message : undefined,
    );
  }

  const text = (await res.text().catch(() => "")).trim();
  if (!res.ok) {
    return {
      ok: false,
      status: "FAILED",
      message: text.slice(0, 300) || `uploader responded ${res.status}`,
      provider: `session · ${endpoint}`,
      detail: text.slice(0, 400) || null,
    };
  }

  return {
    ok: true,
    status: "PUBLISH_COMPLETE",
    message: "Posted through your uploader service.",
    provider: `session · ${endpoint}`,
    detail: text.slice(0, 400) || null,
  };
}
