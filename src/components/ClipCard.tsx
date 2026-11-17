"use client";

import { useState } from "react";
import type { CaptionVariant, TikTokVideo } from "@/lib/types";
import { formatAgo, formatCount, formatDuration } from "@/lib/captions";
import { smartMedia } from "@/lib/tiktok-client";
import { Reveal } from "./ui";
import { Thumb } from "./Thumb";
import {
  IconArrow,
  IconComment,
  IconEye,
  IconHeart,
  IconMusic,
  IconSave,
  IconShare,
  IconUpload,
} from "./icons";

export function ClipCard({
  video,
  variant,
  saved,
  featured,
  resolving,
  onOpen,
  onSave,
  onPublish,
}: {
  video: TikTokVideo;
  variant: CaptionVariant;
  saved: boolean;
  featured?: boolean;
  resolving?: boolean;
  onOpen: () => void;
  onSave: () => void;
  onPublish: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(variant.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const initials = (video.authorUsername || "tt").slice(0, 2).toUpperCase();

  return (
    <Reveal
      as="article"
      className={`group relative flex flex-col border border-line bg-panel/60 transition-all duration-300 hover:-translate-y-1 hover:border-signal/45 hover:bg-panel2/70 hover:shadow-[0_26px_60px_-34px_rgba(36,224,210,.55)] ${
        featured ? "lg:col-span-2 lg:flex-row" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className={`relative block shrink-0 overflow-hidden text-left ${
          featured ? "aspect-[4/5] w-full lg:aspect-auto lg:w-[46%]" : "aspect-[4/5] w-full"
        }`}
        aria-label={`Open dossier for clip ${video.id}`}
      >
        <Thumb video={video} className="h-full w-full" />
        <span className="mono-num absolute top-2 left-2 border border-line2/80 bg-ink/80 px-1.5 py-0.5 text-[9.5px] tracking-[0.16em] text-muted uppercase backdrop-blur-sm">
          {video.matchedTag ? `#${video.matchedTag}` : video.source} · {video.region ?? "?"}
        </span>
        <span className="mono-num absolute right-2 bottom-2 border border-line2/80 bg-ink/80 px-1.5 py-0.5 text-[10px] text-text backdrop-blur-sm">
          {formatDuration(video.durationSec)}
        </span>
        {saved ? (
          <span className="mono-num absolute top-2 right-2 bg-signal px-1.5 py-0.5 text-[9.5px] font-semibold tracking-[0.16em] text-[#04120f] uppercase">
            queued
          </span>
        ) : null}
      </button>

      <div className={`flex min-w-0 flex-1 flex-col p-3.5 ${featured ? "lg:p-5" : ""}`}>
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line2 bg-pit">
            {video.authorAvatar ? (
              <img
                src={smartMedia(video.authorAvatar)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(event) => {
                  (event.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : null}
            <span className="font-display absolute text-[10px] font-bold text-dim">{initials}</span>
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[12.5px] font-bold text-text">
              @{video.authorUsername}
            </p>
            <p className="mono-num truncate text-[10px] tracking-[0.1em] text-dim uppercase">
              {video.authorNickname} · {formatAgo(video.postedAt)}
            </p>
          </div>
        </div>

        <div className="mono-num mt-3 grid grid-cols-4 gap-1.5 border-y border-line/80 py-2 text-[10.5px] text-muted">
          {[
            { Icon: IconEye, value: video.playCount },
            { Icon: IconHeart, value: video.diggCount },
            { Icon: IconComment, value: video.commentCount },
            { Icon: IconShare, value: video.shareCount },
          ].map(({ Icon, value }, index) => (
            <span key={index} className="flex items-center gap-1">
              <Icon className="h-3.5 w-3.5 text-dim" />
              {formatCount(value)}
            </span>
          ))}
        </div>

        <p
          className={`mt-2.5 line-clamp-2 text-[12px] leading-snug text-muted italic ${
            featured ? "lg:line-clamp-3" : ""
          }`}
        >
          {video.caption || "(no caption on the original)"}
        </p>

        <div className="relative mt-2.5 border-l-2 border-signal/70 bg-signal/[0.05] px-3 py-2">
          <p className="mono-num text-[9.5px] tracking-[0.2em] text-signal/80 uppercase">
            ready to post · {variant.label}
          </p>
          <p
            className={`mt-1 line-clamp-3 text-[12.5px] leading-snug break-words whitespace-pre-line text-text ${
              featured ? "lg:line-clamp-5" : ""
            }`}
          >
            {variant.text}
          </p>
          <p className="mono-num mt-1.5 text-[10px] text-dim">
            {variant.length} chars · {variant.tags.length} tags ·{" "}
            <span className="text-signal">{variant.credit}</span>
          </p>
        </div>

        {video.musicTitle ? (
          <p className="mono-num mt-2 flex items-center gap-1.5 truncate text-[10.5px] text-dim">
            <IconMusic className="h-3 w-3 shrink-0" />
            <span className="truncate">{video.musicTitle}</span>
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
          <button
            type="button"
            onClick={onOpen}
            className="font-display flex items-center gap-1.5 border border-line2 bg-panel2/70 px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-text uppercase transition-colors hover:border-signal/60 hover:text-signal"
          >
            Dossier
            <IconArrow className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={copy}
            className={`font-display border px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase transition-all ${
              copied
                ? "border-signal/70 bg-signal/20 text-signal"
                : "border-line2 bg-panel2/70 text-muted hover:border-signal/60 hover:text-signal"
            }`}
          >
            {copied ? "Copied ✓" : "Copy caption"}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPublish();
            }}
            title={resolving ? "Still resolving the watermark-free file" : "Post this clip to your TikTok"}
            className="font-display flex items-center gap-1.5 border border-acid/40 bg-acid/[0.08] px-2.5 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-acid uppercase transition-colors hover:bg-acid/[0.16]"
          >
            <IconUpload className="h-3.5 w-3.5" />
            Post
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSave();
            }}
            title={saved ? "Already in the queue — click to open" : "Save to post queue"}
            className={`font-display ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase transition-colors ${
              saved ? "text-signal" : "text-dim hover:text-flare"
            }`}
          >
            <IconSave className="h-3.5 w-3.5" />
            {saved ? "In queue" : "Queue"}
          </button>
        </div>
      </div>

    </Reveal>
  );
}
