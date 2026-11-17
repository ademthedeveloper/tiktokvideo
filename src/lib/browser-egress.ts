"use client";

/**
 * Browser egress — when the server's IP is refused, the browser asks instead.
 *
 * Vercel/Lambda/Fly addresses are routinely blocked by tikwm (Cloudflare answers
 * a bot-challenge page) and soft-blocked by tiktok.com (it serves the website
 * shell instead of the API's JSON). No header fixes that: the address is the
 * problem. A phone or laptop on a normal home connection is not blocked, so the
 * cheapest reliable fallback is to let the reader's own browser do the request.
 *
 * This module only *fetches* — normalising the payloads into clips happens on
 * the server (/api/tiktok/import), so there is exactly one parser.
 *
 * Everything here is best effort and named: if the browser cannot read the
 * upstream (CORS, offline, blocked), the attempt says so instead of failing
 * silently.
 */

import type { FetchMode, ProviderAttempt } from "./types";

export type EgressPayload = { provider: string; ms: number; body: unknown };

export type EgressOutcome = {
  ok: boolean;
  payloads: EgressPayload[];
  attempts: ProviderAttempt[];
  error: string | null;
};

const TIKWM_BASE = "https://www.tikwm.com";

export function browserEgressSupported(): boolean {
  return typeof window !== "undefined" && typeof fetch === "function";
}

function describe(err: unknown): string {
  if (err instanceof TypeError) {
    return "the browser could not read tikwm (CORS or network)";
  }
  return err instanceof Error ? err.message : "browser fetch failed";
}

function clip(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Ways to reach tikwm from a browser. The direct call needs tikwm to allow
 * cross-origin reads; the relays are CORS-open by design, so they work even when
 * tikwm's own headers would block us (or when the browser's IP is refused).
 */
const BROWSER_RELAYS: { name: string; wrap: (url: string) => string }[] = [
  { name: "", wrap: (url) => url },
  {
    name: "allorigins → ",
    wrap: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  },
  {
    name: "corsproxy.io → ",
    wrap: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  },
];

/** Read JSON straight from an upstream, with a timeout and a readable error. */
async function readJson(url: string, timeoutMs = 11_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}${text.trim() ? ` · ${clip(text.trim(), 60)}` : ""}`);
    const head = text.trimStart();
    if (!head.startsWith("{")) throw new Error("answered with a web page, not JSON");
    return JSON.parse(head);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`timed out after ${(timeoutMs / 1000).toFixed(0)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function videosIn(body: any): number {
  const data = body?.data ?? body;
  if (Array.isArray(data?.videos)) return data.videos.length;
  if (Array.isArray(data?.item_list)) return data.item_list.length;
  if (Array.isArray(data?.items)) return data.items.length;
  if (data && (data.id || data.video_id || data.aweme_id)) return 1;
  return 0;
}

/**
 * Ask tikwm from the reader's connection.
 * Returns raw payloads for the server to normalise — never clips.
 */
export async function browserEgress(opts: {
  mode: FetchMode;
  keyword?: string;
  links?: string[];
  region?: string;
  count?: number;
}): Promise<EgressOutcome> {
  const count = Math.min(30, Math.max(1, opts.count ?? 12));
  const region = (opts.region ?? "US").toUpperCase();
  const attempts: ProviderAttempt[] = [];
  const payloads: EgressPayload[] = [];

  const targets: { what: string; query: string; url: string }[] = [];
  if (opts.mode === "link") {
    for (const link of (opts.links ?? []).slice(0, 6)) {
      targets.push({
        what: "tikwm detail",
        query: link.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48),
        url: `${TIKWM_BASE}/api/?url=${encodeURIComponent(link)}&hd=1`,
      });
    }
  } else if (opts.mode === "firehose") {
    targets.push({
      what: "tikwm feed",
      query: region,
      url: `${TIKWM_BASE}/api/feed/list?region=${region}&count=${count}&cursor=0`,
    });
  } else {
    const keyword = (opts.keyword ?? "").trim();
    if (keyword.startsWith("@")) {
      targets.push({
        what: "tikwm user posts",
        query: keyword,
        url: `${TIKWM_BASE}/api/user/posts?unique_id=${encodeURIComponent(
          keyword.replace(/^@/, ""),
        )}&count=${count}&cursor=0`,
      });
    } else {
      targets.push({
        what: "tikwm search",
        query: keyword,
        url: `${TIKWM_BASE}/api/feed/search?keywords=${encodeURIComponent(
          keyword,
        )}&count=${count}&cursor=0&region=${region}`,
      });
    }
  }

  for (const target of targets) {
    /* Direct first (a home connection usually is not blocked), then relays that
     * are built to be read from a browser whatever tikwm's own CORS policy is. */
    for (const relay of BROWSER_RELAYS) {
      const started = Date.now();
      const label = `your browser → ${relay.name}${target.what}`;
      const query = target.query;
      try {
        const body = await readJson(relay.wrap(target.url));
        const found = videosIn(body);
        attempts.push({ provider: label, query, found, ms: Date.now() - started });
        if (found > 0) {
          payloads.push({ provider: label, ms: Date.now() - started, body });
          break;
        }
      } catch (err) {
        attempts.push({
          provider: label,
          query,
          found: 0,
          error: clip(describe(err)),
          ms: Date.now() - started,
        });
      }
      if (payloads.length >= 6) break;
    }
    if (payloads.length >= 6) break;
  }

  return {
    ok: payloads.length > 0,
    payloads,
    attempts,
    error: payloads.length ? null : attempts[0]?.error ?? "the browser could not reach tikwm",
  };
}
