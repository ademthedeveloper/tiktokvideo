/**
 * Optional self-hosted fetch service.
 *
 * Set TIKTOK_FETCH_URL to the base URL of any small service that speaks this
 * contract and the desk will use it *before* the public scrapers:
 *
 *   GET {base}/health
 *       → {"ok": true}
 *   GET {base}/search?q=relatable&count=10&region=US
 *       → {"items": [ <TikTok itemStruct | tikwm item | our TikTokVideo> ]}
 *   GET {base}/tag?tag=relatable&count=10
 *       → {"items": [...]}
 *   GET {base}/video?id=7300000000000000001   (or ?url=…)
 *       → {"item": {...}}  (a bare item object also works)
 *
 * Why: free scrapers come and go. If tikwm is blocked from your network you can
 * run tools/tiktok-sidecar on the same box and the desk is dependable again.
 */

import type { TikTokVideo } from "../types";
import { makeVideo } from "../video-factory";
import { UpstreamError, readJson, request, shortError } from "./net";
import { fromTikwm } from "./tikwm";
import { fromWebItem } from "./tiktok-web";

const PROVIDER = "sidecar";

export function sidecarUrl(): string | null {
  const raw = process.env.TIKTOK_FETCH_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function sidecarHeaders(): Record<string, string> {
  const token = process.env.TIKTOK_FETCH_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson(path: string, params: Record<string, string | number>) {
  const base = sidecarUrl();
  if (!base) throw new UpstreamError("No sidecar configured", "", PROVIDER);
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const res = await request(
    url.toString(),
    { headers: { Accept: "application/json", ...sidecarHeaders() } },
    20_000,
    PROVIDER,
  );
  if (!res.ok) {
    throw new UpstreamError(
      "The sidecar answered with an error",
      `HTTP ${res.status} on ${path}`,
      PROVIDER,
      res.status,
    );
  }
  return readJson<any>(res, PROVIDER);
}

/** Accepts itemStruct (web/mobile), tikwm items and our own video objects. */
export function fromAny(
  raw: any,
  source: TikTokVideo["source"] = "search",
  base?: TikTokVideo,
): TikTokVideo | null {
  if (!raw || typeof raw !== "object") return null;
  // Our own shape (already normalised) — trust it if it has the fields.
  if (raw.playUrl !== undefined && raw.authorUsername !== undefined && raw.id) {
    return makeVideo({ ...(base ?? {}), ...raw, source: base?.source ?? source });
  }
  if (raw.video || raw.stats || raw.statsV2 || raw.author?.uniqueId) {
    return fromWebItem(raw, source, base);
  }
  return fromTikwm(raw, source, base);
}

function itemsOf(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.videos)) return payload.videos;
  if (Array.isArray(payload.item_list)) return payload.item_list;
  if (payload.item) return [payload.item];
  if (payload.data) return itemsOf(payload.data);
  return [];
}

export async function sidecarSearch(opts: {
  query: string;
  count?: number;
  region?: string;
}): Promise<TikTokVideo[]> {
  const payload = await getJson("/search", {
    q: opts.query,
    keywords: opts.query,
    count: opts.count ?? 12,
    region: opts.region ?? "US",
  });
  return itemsOf(payload)
    .map((item) => fromAny(item, "search"))
    .filter((video): video is TikTokVideo => Boolean(video));
}

export async function sidecarTag(opts: {
  tag: string;
  count?: number;
}): Promise<TikTokVideo[]> {
  const payload = await getJson("/tag", { tag: opts.tag, count: opts.count ?? 12 });
  return itemsOf(payload)
    .map((item) => fromAny(item, "search"))
    .filter((video): video is TikTokVideo => Boolean(video));
}

export async function sidecarVideo(opts: {
  id?: string;
  url?: string;
}): Promise<TikTokVideo | null> {
  const payload = await getJson("/video", { id: opts.id ?? "", url: opts.url ?? "" });
  const item = itemsOf(payload)[0] ?? payload;
  return fromAny(item, "link");
}

export async function sidecarCheck(): Promise<{
  ok: boolean;
  latencyMs: number;
  detail: string;
}> {
  const base = sidecarUrl();
  const started = Date.now();
  if (!base) {
    return { ok: false, latencyMs: 0, detail: "not configured (TIKTOK_FETCH_URL)" };
  }
  try {
    const payload = await getJson("/health", {});
    return {
      ok: payload?.ok !== false,
      latencyMs: Date.now() - started,
      detail: `${base} · ${payload?.ok === false ? "reported unhealthy" : "healthy"}`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: `${base} · ${shortError(err)}`,
    };
  }
}
