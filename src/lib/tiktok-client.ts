/** Isomorphic helpers shared by the browser UI and the API routes. */

export const REGIONS: { code: string; label: string }[] = [
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "ES", label: "Spain" },
  { code: "IT", label: "Italy" },
  { code: "BR", label: "Brazil" },
  { code: "MX", label: "Mexico" },
  { code: "PH", label: "Philippines" },
  { code: "ID", label: "Indonesia" },
  { code: "IN", label: "India" },
  { code: "SA", label: "Saudi Arabia" },
  { code: "TR", label: "Türkiye" },
];

export function extractTikTokLinks(input: string): string[] {
  if (!input) return [];
  const matches =
    input.match(
      /https?:\/\/(?:www\.|vm\.|vt\.|m\.)?tiktok\.com\/[^\s,]+/gi,
    ) ?? [];
  // tikwm resolves bare numeric aweme ids directly.
  const bareIds = input
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => /^\d{15,25}$/.test(token));
  const all = [...matches.map((match) => match.replace(/[).,'"]+$/, "")), ...bareIds];
  return [...new Set(all)];
}

export function proxiedMedia(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("/api/media/stream")) return url;
  return `/api/media/stream?url=${encodeURIComponent(url)}`;
}

/**
 * TikTok's own /api/img and /api/video endpoints reject browser user agents,
 * so those need the proxy; CDN links can be loaded straight from the browser.
 */
export function smartMedia(url: string | null | undefined): string {
  if (!url) return "";
  if (/tiktok\.com\/api\//i.test(url)) return proxiedMedia(url);
  return url;
}
