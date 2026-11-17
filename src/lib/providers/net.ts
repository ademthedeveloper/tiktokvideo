/**
 * Shared plumbing for every upstream the desk talks to.
 *
 * Scraping-adjacent providers fail in messy ways (bot challenges, HTML where
 * JSON should be, silent empty payloads). Everything here exists so a failure
 * arrives with a reason we can show the user instead of a bare "fetch failed".
 */

export class UpstreamError extends Error {
  /** Raw detail (status code, first bytes of the body, …) for the UI. */
  detail: string;
  /** Which upstream produced this failure. */
  provider: string;
  status: number | null;

  constructor(
    message: string,
    detail = "",
    provider = "upstream",
    status: number | null = null,
  ) {
    super(message);
    this.name = "UpstreamError";
    this.detail = detail;
    this.provider = provider;
    this.status = status;
  }
}

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
export const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
export const CRAWLER_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

export type Attempt = {
  provider: string;
  query: string;
  found: number;
  error?: string;
  ms: number;
};

export function nowMs() {
  return Date.now();
}

export function shortError(err: unknown): string {
  if (err instanceof UpstreamError) {
    return err.detail ? `${err.message} — ${err.detail}` : err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

const PROXIED_HOSTS = /^https:\/\/(?:www\.)?(?:tikwm\.com|tikwmapi\.com|tiktok\.com)\//i;

export function proxyUrl(): string | null {
  const configured = process.env.TIKTOK_PROXY_URL?.trim();
  return configured || null;
}

export function isProxyTarget(url: string): boolean {
  return PROXIED_HOSTS.test(url);
}

/**
 * Route a scraper request through an egress proxy when one is configured.
 *
 * Datacenter IPs (Vercel, Lambda, Fly) are routinely 403'd by Cloudflare, which
 * is what tikwm sits behind. TIKTOK_PROXY_URL points at any service that accepts
 * `?url=<target>` and returns the upstream body — see tools/tiktok-proxy-worker.
 */
function viaProxy(url: string): { url: string; headers: Record<string, string> } | null {
  const proxy = proxyUrl();
  if (!proxy || !isProxyTarget(url)) return null;
  const separator = proxy.includes("?") ? "&" : "?";
  const headers: Record<string, string> = {};
  const secret = process.env.TIKTOK_PROXY_SECRET?.trim();
  if (secret) headers["x-proxy-secret"] = secret;
  return { url: `${proxy}${separator}url=${encodeURIComponent(url)}`, headers };
}

/** One fetch with a hard timeout and a normalised network error. */
async function attemptFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  provider: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  }
  try {
    return await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
      cache: "no-store",
      redirect: init.redirect ?? "follow",
    });
  } catch (err) {
    const message = controller.signal.aborted
      ? `timed out after ${(timeoutMs / 1000).toFixed(1)}s`
      : err instanceof Error
        ? err.message
        : "network error";
    throw new UpstreamError("Could not reach the upstream", message, provider);
  } finally {
    clearTimeout(timer);
  }
}

/* ── public relays ─────────────────────────────────────────────────
 * Free, key-less "fetch this URL for me" services. They exist because some
 * hosts (Vercel, Lambda, Fly) get 403'd by Cloudflare on tikwm.com and served a
 * soft-block shell by tiktok.com. A relay borrows a different IP for us.
 *
 * Used only when TIKTOK_PROXY_URL is unset, only for GETs to hosts we already
 * scrape, and only when the direct answer looks like a block. Turn it off with
 * TIKTOK_PUBLIC_RELAY=off. Every success is recorded so the UI can say which
 * relay answered.
 */
const PUBLIC_RELAYS: { name: string; build: (url: string) => string }[] = [
  {
    name: "allorigins",
    build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  },
  {
    name: "corsproxy.io",
    build: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  },
  {
    name: "cors.lol",
    build: (url) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
  },
];

/** Statuses that mean "the host is refusing this IP", not "the request was wrong". */
const BLOCKED_STATUS = new Set([401, 403, 429, 500, 502, 503, 504]);

let lastRelay: string | null = null;

/** Name of the relay that answered the most recent successful request, if any. */
export function lastUpstreamRelay(): string | null {
  return lastRelay;
}

export function resetUpstreamRelay() {
  lastRelay = null;
}

export function publicRelayEnabled(): boolean {
  const flag = process.env.TIKTOK_PUBLIC_RELAY?.trim().toLowerCase();
  return flag !== "off" && flag !== "0" && flag !== "false";
}

/**
 * fetch() with a hard timeout, an optional egress proxy, and a last-resort
 * public-relay retry. Callers only ever see a Response or an UpstreamError.
 */
export async function request(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12_000,
  provider = "upstream",
): Promise<Response> {
  const proxied = viaProxy(url);
  if (proxied) {
    return attemptFetch(proxied.url, init, timeoutMs, provider, proxied.headers);
  }

  let direct: Response | null = null;
  let directError: unknown = null;
  try {
    direct = await attemptFetch(url, init, timeoutMs, provider);
  } catch (err) {
    directError = err;
  }

  const method = String(init.method ?? "GET").toUpperCase();
  const blocked = Boolean(directError) || (direct ? BLOCKED_STATUS.has(direct.status) : false);
  if (blocked && method === "GET" && publicRelayEnabled() && isProxyTarget(url)) {
    /* Keep the whole retry inside roughly one request window. */
    const budget = Date.now() + Math.max(8_000, Math.min(18_000, timeoutMs * 1.5));
    for (const relay of PUBLIC_RELAYS) {
      const left = budget - Date.now();
      if (left < 3_000) break;
      let res: Response;
      try {
        res = await attemptFetch(
          relay.build(url),
          { method: "GET", headers: { Accept: "application/json, text/plain, */*" } },
          Math.min(left, 9_000),
          provider,
        );
      } catch {
        continue;
      }
      if (res.ok) {
        lastRelay = relay.name;
        return res;
      }
      await res.text().catch(() => "");
    }
  }

  if (directError) throw directError;
  return direct as Response;
}

export function looksLikeHtml(body: string): boolean {
  const head = body.trimStart().slice(0, 40).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<");
}

export async function readJson<T = any>(
  res: Response,
  provider: string,
): Promise<T> {
  const text = await res.text();
  if (looksLikeHtml(text)) {
    throw new UpstreamError(
      "The upstream answered with a web page instead of data",
      `probably a bot challenge (HTTP ${res.status})`,
      provider,
      res.status,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(
      "The upstream returned malformed data",
      text.trim().slice(0, 160) || `HTTP ${res.status}`,
      provider,
      res.status,
    );
  }
}

/** Pull a `<script id="…" type="application/json">` blob out of an HTML page. */
export function readScriptJson(html: string, id: string): any | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<script[^>]*id=["']${escaped}["'][^>]*>([\\s\\S]*?)</script>`,
    "i",
  ).exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** Breadth-first hunt for the first object matching a predicate. */
export function deepFind<T>(
  root: unknown,
  predicate: (value: any) => boolean,
  maxNodes = 4000,
): T | null {
  const queue: unknown[] = [root];
  const seen = new Set<unknown>();
  let visited = 0;
  while (queue.length && visited < maxNodes) {
    const node = queue.shift();
    visited += 1;
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (predicate(node)) return node as T;
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

/** `"//cdn…"` / `"/video/…"` → absolute URL against the provider origin. */
export function absolutise(url: string | null | undefined, origin: string): string | null {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${origin.replace(/\/+$/, "")}${trimmed}`;
  return trimmed;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toIsoDate(secondsOrDate: unknown): string | null {
  if (secondsOrDate === null || secondsOrDate === undefined || secondsOrDate === "") return null;
  if (typeof secondsOrDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(secondsOrDate)) {
    const date = new Date(secondsOrDate);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const seconds = Number(secondsOrDate);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

/** Cap any provider call so a hanging upstream cannot stall a whole batch. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "upstream"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new UpstreamError(`${label} took too long`, `no answer within ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
