"use client";

/**
 * Browser egress — when the server's IP is refused, the browser asks instead.
 *
 * Vercel/Lambda/Fly addresses are routinely blocked by tikwm (Cloudflare answers
 * a bot-challenge page) and soft-blocked by tiktok.com (it serves the website
 * shell instead of the API's JSON). No header fixes that: the address is the
 * problem. A phone or laptop on a normal home connection is normally not
 * blocked, so the cheapest fallback is to let the reader's own browser do the
 * request — and to race a few CORS-open relays for it, because the browser may
 * still be stopped by tikwm's own CORS headers or by an ad blocker.
 *
 * This module only *fetches* — normalising the payloads into clips happens on
 * the server (/api/tiktok/import), so there is exactly one parser.
 *
 * Everything is best effort and named: if nobody can read the upstream, the
 * attempts say who refused and why.
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
const TIMEOUT_MS = 8_000;

type Route = { name: string; build: (url: string) => string; headers?: Record<string, string> };

/**
 * Ways to reach an upstream from a browser.
 *
 * The direct call is fastest and carries the reader's real IP, but tikwm may
 * refuse to let another origin read it. The relays are CORS-open by design, so
 * they work even when the upstream's own headers would block us — and each one
 * borrows yet another address.
 */
const ROUTES: Route[] = [
  { name: "", build: (url) => url },
  {
    name: "allorigins → ",
    build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  },
  {
    name: "codetabs → ",
    build: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  },
  {
    name: "jina → ",
    build: (url) => `https://r.jina.ai/${url}`,
    headers: { "x-return-format": "text" },
  },
  {
    name: "cors.lol → ",
    build: (url) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
  },
  {
    name: "corsproxy.io → ",
    build: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  },
];

export function browserEgressSupported(): boolean {
  return typeof window !== "undefined" && typeof fetch === "function";
}

function describe(err: unknown): string {
  if (err instanceof TypeError) {
    return "the browser could not read it (CORS, ad blocker or network)";
  }
  return err instanceof Error ? err.message : "browser fetch failed";
}

function clip(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Pull the first JSON object/array out of a body wrapped in prose or fences. */
function extractJson(text: string): any | null {
  const body = text.replace(/^\uFEFF/, "").trim();
  if (!body) return null;
  const candidates = [body];
  const from = body.indexOf("{");
  const to = body.lastIndexOf("}");
  if (from !== -1 && to > from) candidates.push(body.slice(from, to + 1));
  const arrFrom = body.indexOf("[");
  const arrTo = body.lastIndexOf("]");
  if (arrFrom !== -1 && arrTo > arrFrom) candidates.push(body.slice(arrFrom, arrTo + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

async function readJson(url: string, headers?: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      headers: { Accept: "application/json, text/plain, */*", ...(headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = extractJson(text);
    if (!json) throw new Error("answered with a page, not JSON");
    return json;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`timed out after ${(TIMEOUT_MS / 1000).toFixed(0)}s`);
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

type RouteResult = { name: string; body: any; ms: number } | { name: string; error: string };

/** Ask every route at once and keep the first that returns clips. */
async function raceRoutes(url: string): Promise<{
  winner: { name: string; body: any; ms: number } | null;
  results: RouteResult[];
}> {
  const started = Date.now();
  const settled = await Promise.all(
    ROUTES.map(async (route): Promise<RouteResult> => {
      try {
        const body = await readJson(route.build(url), route.headers);
        return { name: route.name, body, ms: Date.now() - started };
      } catch (err) {
        return { name: route.name, error: describe(err) };
      }
    }),
  );
  const winner =
    settled.find(
      (result): result is { name: string; body: any; ms: number } =>
        !("error" in result) && videosIn(result.body) > 0,
    ) ?? null;
  return { winner, results: settled };
}

/**
 * Ask for a search / creator / link / firehose page from the reader's network.
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
    const { winner, results } = await raceRoutes(target.url);
    const label = (name: string) => `your browser → ${name}${target.what}`;

    if (winner) {
      attempts.push({
        provider: label(winner.name),
        query: target.query,
        found: videosIn(winner.body),
        ms: winner.ms,
      });
      payloads.push({ provider: label(winner.name), ms: winner.ms, body: winner.body });
    } else {
      /* Nothing worked: report every route so the wall is never a mystery. */
      for (const result of results) {
        attempts.push({
          provider: label(result.name),
          query: target.query,
          found: 0,
          error: clip("error" in result ? result.error : "no clips in the answer"),
          ms: 0,
        });
      }
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
