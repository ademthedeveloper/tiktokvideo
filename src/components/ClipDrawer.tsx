"use client";

import { useEffect, useRef, useState } from "react";
import type { CaptionVariant, SavedPost, Settings, TikTokVideo } from "@/lib/types";
import {
  TIKTOK_CAPTION_LIMIT,
  VISIBLE_BEFORE_MORE,
  formatAgo,
  formatCount,
  formatDuration,
} from "@/lib/captions";
import { proxiedMedia } from "@/lib/tiktok-client";
import { Button, CopyButton, inputClass, useToast } from "./ui";
import { Thumb } from "./Thumb";
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconComment,
  IconDownload,
  IconExternal,
  IconEye,
  IconHeart,
  IconMusic,
  IconRefresh,
  IconSave,
  IconShare,
  IconSpark,
  IconUpload,
} from "./icons";

function useTypewriter(text: string, speed = 14) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setOut(text);
      return;
    }
    setOut("");
    let index = 0;
    const id = setInterval(() => {
      index += 1;
      setOut(text.slice(0, index));
      if (index >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return out;
}

export function ClipDrawer({
  video,
  settings,
  variants,
  seed,
  saved,
  onReroll,
  onSave,
  onPublish,
  onResolve,
  onClose,
}: {
  video: TikTokVideo | null;
  settings: Settings;
  variants: CaptionVariant[];
  seed: number;
  saved: SavedPost | null;
  onReroll: () => void;
  onSave: (variant: CaptionVariant) => void;
  onPublish: (variant: CaptionVariant) => void;
  onResolve: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [activeIndex, setActiveIndex] = useState(0);
  const [note, setNote] = useState("");
  const [mediaError, setMediaError] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setActiveIndex(0);
    setMediaError(false);
    setNote("");
  }, [video?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    if (video) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [video, onClose]);

  const active = video ? (variants[activeIndex] ?? variants[0]) : undefined;
  const typed = useTypewriter(active?.text ?? "");

  if (!video) return null;

  const streamUrl = proxiedMedia(video.playUrl ?? video.ttPlayUrl ?? video.hdPlayUrl);
  const previewLine = (active?.text ?? "").slice(0, VISIBLE_BEFORE_MORE * 2);

  const download = async (hd: boolean) => {
    const url = hd
      ? (video.hdPlayUrl ?? video.playUrl ?? video.ttPlayUrl)
      : (video.playUrl ?? video.ttPlayUrl ?? video.hdPlayUrl);
    if (!url) {
      toast("No download URL from the source", "warn");
      return;
    }
    toast(`Fetching ${hd ? "HD" : "SD"} file…`, "info", "Watermark-free stream via the desk proxy");
    try {
      const res = await fetch(
        `${proxiedMedia(url)}&download=1&filename=tiktok-${video.authorUsername}-${video.id}.mp4`,
      );
      if (!res.ok) throw new Error(`proxy responded ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `tiktok-${video.authorUsername}-${video.id}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      toast("Download started", "ok", `${(blob.size / 1_048_576).toFixed(1)} MB saved`);
    } catch (err) {
      toast("Download failed", "warn", err instanceof Error ? err.message : "unknown error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close dossier"
        onClick={onClose}
        className="absolute inset-0 bg-ink/78 backdrop-blur-[3px]"
      />
      <aside className="drawer-in scroll-thin relative flex h-full w-full max-w-[640px] flex-col overflow-y-auto border-l border-line bg-pit/97 shadow-[-40px_0_90px_-40px_rgba(0,0,0,.9)]">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-pit/95 px-4 py-3 backdrop-blur-md">
          <span className="mono-num border border-flare/40 bg-flare/12 px-2 py-1 text-[9.5px] tracking-[0.2em] text-flare uppercase">
            dossier
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-[13px] font-bold tracking-wide text-text uppercase">
              @{video.authorUsername}
            </p>
            <p className="mono-num truncate text-[10px] text-dim">
              id {video.id} · {formatAgo(video.postedAt)} · {video.region ?? "?"}
              {video.matchedTag ? ` · #${video.matchedTag}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-line2 p-1.5 text-muted transition-colors hover:border-flare/60 hover:text-flare"
            aria-label="Close"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_210px]">
          {/* player */}
          <div className="relative aspect-[9/14] w-full overflow-hidden border border-line bg-ink">
            {streamUrl && !mediaError ? (
              <video
                ref={videoRef}
                src={streamUrl}
                poster={video.coverUrl ?? undefined}
                controls
                loop
                playsInline
                muted={muted}
                autoPlay
                onError={() => setMediaError(true)}
                className="h-full w-full bg-ink object-contain"
              />
            ) : (
              <>
                <Thumb video={video} className="h-full w-full" kenburns />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/70 px-4 text-center">
                  <IconAlert className="h-5 w-5 text-amber" />
                  <p className="text-[12px] leading-snug text-muted">
                    In-app playback was blocked for this clip. Download it or open the source.
                  </p>
                </div>
              </>
            )}
            <div className="pointer-events-none absolute top-2 left-2 flex gap-1.5">
              <span className="mono-num border border-line2/70 bg-ink/80 px-1.5 py-0.5 text-[9.5px] tracking-[0.16em] text-muted uppercase">
                {formatDuration(video.durationSec)}
              </span>
              <span className="mono-num border border-line2/70 bg-ink/80 px-1.5 py-0.5 text-[9.5px] tracking-[0.16em] text-muted uppercase">
                no watermark
              </span>
            </div>
            {streamUrl && !mediaError ? (
              <button
                type="button"
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  if (videoRef.current) videoRef.current.muted = next;
                }}
                className="mono-num absolute top-2 right-2 border border-line2/70 bg-ink/80 px-2 py-1 text-[9.5px] tracking-[0.16em] text-muted uppercase transition-colors hover:text-signal"
              >
                {muted ? "unmute" : "mute"}
              </button>
            ) : null}
          </div>

          {/* side column */}
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { Icon: IconEye, label: "plays", value: video.playCount },
                { Icon: IconHeart, label: "likes", value: video.diggCount },
                { Icon: IconComment, label: "comments", value: video.commentCount },
                { Icon: IconShare, label: "shares", value: video.shareCount },
              ].map(({ Icon, label, value }) => (
                <div key={label} className="border border-line bg-panel/60 px-2 py-1.5">
                  <p className="mono-num flex items-center gap-1 text-[9px] tracking-[0.16em] text-dim uppercase">
                    <Icon className="h-3 w-3" />
                    {label}
                  </p>
                  <p className="mono-num text-[14px] font-semibold text-text">{formatCount(value)}</p>
                </div>
              ))}
            </div>

            <div className="border border-line bg-panel/60 p-2.5">
              <p className="mono-num text-[9px] tracking-[0.2em] text-dim uppercase">sound</p>
              <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-snug text-muted">
                <IconMusic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-dim" />
                <span className="break-words">{video.musicTitle ?? "original sound"}</span>
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Button variant="primary" onClick={() => download(false)}>
                <IconDownload className="h-3.5 w-3.5" />
                Download SD
              </Button>
              <Button onClick={() => download(true)} disabled={!video.hdPlayUrl}>
                <IconSpark className="h-3.5 w-3.5" />
                Download HD
              </Button>
              {!video.enriched ? (
                <Button
                  onClick={onResolve}
                  title="Ask tikwm for the watermark-free HD file (1 request/second upstream)"
                >
                  <IconRefresh className="h-3.5 w-3.5" />
                  Resolve HD file
                </Button>
              ) : null}
              <a
                href={video.shareUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="font-display flex items-center justify-center gap-1.5 border border-line2 bg-panel2/60 px-3.5 py-2 text-[12.5px] font-semibold tracking-[0.1em] text-muted uppercase transition-colors hover:border-signal/60 hover:text-signal"
              >
                <IconExternal className="h-3.5 w-3.5" />
                Open source
              </a>
            </div>

            {/* phone preview */}
            <div className="mt-1 border border-line bg-panel/50 p-2.5">
              <p className="mono-num text-[9px] tracking-[0.2em] text-dim uppercase">
                on-screen preview
              </p>
              <div className="relative mt-2 aspect-[9/16] w-full overflow-hidden rounded-[14px] border border-line2 bg-ink">
                <Thumb video={video} className="absolute inset-0 h-full w-full" kenburns />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/10 to-ink/40" />
                <div className="absolute right-2 bottom-14 flex flex-col items-center gap-2.5 text-text">
                  {[
                    { Icon: IconHeart, value: video.diggCount },
                    { Icon: IconComment, value: video.commentCount },
                    { Icon: IconShare, value: video.shareCount },
                  ].map(({ Icon, value }, index) => (
                    <span key={index} className="flex flex-col items-center">
                      <Icon className="h-4 w-4" />
                      <span className="mono-num text-[8px]">{formatCount(value)}</span>
                    </span>
                  ))}
                </div>
                <div className="absolute bottom-2.5 left-2.5 right-9">
                  <p className="text-[10px] font-bold text-text">
                    @{settings.handle || "yourpage"}
                  </p>
                  <p className="mt-1 line-clamp-3 text-[9.5px] leading-snug break-words whitespace-pre-line text-text/95">
                    {typed}
                    {typed.length < (active?.text.length ?? 0) ? (
                      <span className="caret" />
                    ) : null}
                  </p>
                  <p className="mono-num mt-1 flex items-center gap-1 text-[8px] text-text/70">
                    <IconMusic className="h-2.5 w-2.5" />
                    <span className="truncate">{video.musicTitle ?? "original sound"}</span>
                  </p>
                </div>
              </div>
              <p className="mono-num mt-2 text-[9.5px] leading-snug text-dim">
                Followers see the first ~{VISIBLE_BEFORE_MORE} characters before “more”.
              </p>
            </div>
          </div>
        </div>

        {/* original caption */}
        <section className="mx-4 mb-4 border border-line bg-panel/50 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="mono-num text-[9.5px] tracking-[0.22em] text-dim uppercase">
              original caption from @{video.authorUsername}
            </p>
            <CopyButton value={video.caption} label="Copy raw" size="sm" variant="ghost" />
          </div>
          <p className="mt-2 text-[13px] leading-relaxed break-words whitespace-pre-line text-muted">
            {video.caption || "(the creator posted this with no caption)"}
          </p>
        </section>

        {/* variants */}
        <section className="mx-4 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-[13px] font-bold tracking-[0.12em] text-text uppercase">
              Your repost caption
            </p>
            <div className="flex items-center gap-1.5">
              <span className="mono-num text-[10px] text-dim uppercase">roll #{seed + 1}</span>
              <Button size="sm" onClick={onReroll} title="Rewrite hooks with a new variation">
                <IconRefresh className="h-3.5 w-3.5" />
                Reroll
              </Button>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {variants.map((variant, index) => (
              <button
                key={variant.style}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`mono-num border px-2.5 py-1 text-[10px] tracking-[0.14em] uppercase transition-all duration-200 ${
                  index === activeIndex
                    ? "border-signal/70 bg-signal/14 text-signal"
                    : "border-line text-dim hover:border-line2 hover:text-muted"
                }`}
              >
                {variant.label}
              </button>
            ))}
          </div>

          {active ? (
            <div className="mt-3 border border-signal/25 bg-signal/[0.04] p-3.5">
              <div className="scroll-thin max-h-[38vh] overflow-y-auto">
                <p className="text-[13.5px] leading-relaxed break-words whitespace-pre-line text-text">
                  {active.text}
                </p>
              </div>
              <div className="mono-num mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[10px] tracking-[0.12em] text-dim uppercase">
                <span>
                  {active.length}/{TIKTOK_CAPTION_LIMIT} chars
                </span>
                <span>credit · <span className="text-signal">{active.credit}</span></span>
                <span>{active.tags.length} tags</span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden bg-line">
                <div
                  className={`h-full transition-all duration-500 ${
                    active.length > TIKTOK_CAPTION_LIMIT * 0.8 ? "bg-flare" : "bg-signal"
                  }`}
                  style={{ width: `${Math.min(100, (active.length / TIKTOK_CAPTION_LIMIT) * 100)}%` }}
                />
              </div>
              {active.warnings.length ? (
                <ul className="mt-2 space-y-1">
                  {active.warnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-1.5 text-[11px] text-amber">
                      <IconAlert className="mt-0.5 h-3 w-3 shrink-0" />
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <CopyButton value={active.text} label="Copy caption" size="md" variant="primary" />
                <Button size="md" onClick={() => onPublish(active)} variant="flare">
                  <IconUpload className="h-3.5 w-3.5" />
                  Post to TikTok
                </Button>
                <Button size="md" onClick={() => onSave(active)} variant={saved ? "outline" : "ghost"}>
                  {saved ? <IconCheck className="h-3.5 w-3.5" /> : <IconSave className="h-3.5 w-3.5" />}
                  {saved ? "Update queue" : "Send to queue"}
                </Button>
              </div>
              <p className="mono-num mt-2 text-[10px] leading-relaxed text-dim uppercase">
                posting sends this caption as the TikTok title and uploads the clip through the
                Content Posting API
              </p>

              <div className="mt-3">
                <input
                  className={`${inputClass} text-[12px]`}
                  value={note}
                  placeholder="Internal note (posting day, angle, who to tag…)"
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>

              <p className="mono-num mt-2.5 text-[10px] leading-relaxed text-dim">
                {previewLine.length > 0
                  ? `first fold: “${active.visibleLine}”`
                  : "empty caption body"}
              </p>
            </div>
          ) : null}
        </section>

        {saved ? (
          <section className="mx-4 mb-6 border border-line bg-panel/50 p-3">
            <p className="mono-num flex items-center gap-2 text-[9.5px] tracking-[0.2em] text-signal uppercase">
              <IconCheck className="h-3.5 w-3.5" />
              in queue · {saved.status} · saved {formatAgo(saved.savedAt)}
            </p>
            {saved.note ? (
              <p className="mt-1.5 text-[11.5px] text-muted">note: {saved.note}</p>
            ) : null}
          </section>
        ) : (
          <div className="h-2" />
        )}
        {!streamUrl ? (
          <p className="mx-4 mb-6 flex items-center gap-2 text-[11px] text-amber">
            <IconAlert className="h-3.5 w-3.5" /> No media URL returned for this clip.
          </p>
        ) : null}
      </aside>
    </div>
  );
}
