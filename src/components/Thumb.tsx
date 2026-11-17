"use client";

import { useMemo, useState } from "react";
import type { TikTokVideo } from "@/lib/types";
import { IconPlay } from "./icons";

const proxied = (url: string) => `/api/media/stream?url=${encodeURIComponent(url)}`;

function usable(url: string | null | undefined): boolean {
  if (!url) return false;
  return !/\.(heic|avif)(\?|$)/i.test(url);
}

/**
 * TikTok sometimes serves .heic covers (undrawable in browsers) and its own
 * /api/img endpoint rejects browser agents — so order the candidates carefully.
 */
export function coverSources(video: TikTokVideo): string[] {
  const candidates = [video.originCoverUrl, video.coverUrl].filter(usable) as string[];
  const ordered: string[] = [];
  const push = (value: string) => {
    if (value && !ordered.includes(value)) ordered.push(value);
  };
  for (const candidate of candidates) {
    push(/tiktok\.com\/api\//i.test(candidate) ? proxied(candidate) : candidate);
  }
  for (const candidate of candidates) push(proxied(candidate));
  return ordered;
}

export function Thumb({
  video,
  className = "",
  kenburns = false,
  priority = false,
}: {
  video: TikTokVideo;
  className?: string;
  kenburns?: boolean;
  priority?: boolean;
}) {
  const sources = useMemo(() => coverSources(video), [video]);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = sources[index];
  const seed = Number(video.id.slice(-4)) || 7;

  return (
    <div className={`relative overflow-hidden bg-pit ${className}`}>
      {src ? (
        <img
          src={src}
          alt=""
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            if (index < sources.length - 1) setIndex(index + 1);
          }}
          className={`h-full w-full object-cover transition-opacity duration-500 ${
            loaded ? "opacity-100" : "opacity-0"
          } ${kenburns ? "kenburns" : ""}`}
        />
      ) : null}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          src && loaded ? "opacity-0" : "opacity-100"
        }`}
        style={{
          background: `linear-gradient(${140 + (seed % 60)}deg, #14202a 0%, #0c1118 55%, #1a1119 100%)`,
        }}
      />
      {(!src || !loaded) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-4xl font-bold text-white/[0.07]">
            {(video.authorUsername || "TT").slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/85 via-transparent to-ink/25" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-signal/50 bg-ink/70 text-signal backdrop-blur-sm">
          <IconPlay className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}
