"use client";

import { useMemo, useState } from "react";
import type { SavedPost, Settings } from "@/lib/types";
import { formatAgo, formatCount, formatDuration } from "@/lib/captions";
import { proxiedMedia } from "@/lib/tiktok-client";
import { Button, Chip, CopyButton, Reveal, inputClass, useToast } from "./ui";
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconDownload,
  IconExternal,
  IconQueue,
  IconRefresh,
  IconTrash,
  IconUpload,
} from "./icons";

const STATUSES = [
  { id: "queued", label: "queued", tone: "signal" },
  { id: "posted", label: "posted", tone: "acid" },
  { id: "skipped", label: "skipped", tone: "dim" },
] as const;

export function LibraryPanel({
  posts,
  tally,
  settings,
  loading,
  onStatus,
  onDelete,
  onClear,
  onRefresh,
  onPublish,
}: {
  posts: SavedPost[];
  tally: Record<string, number>;
  settings: Settings;
  loading: boolean;
  onStatus: (post: SavedPost, status: string) => void;
  onDelete: (post: SavedPost) => void;
  onClear: () => void;
  onRefresh: () => void;
  onPublish: (post: SavedPost) => void;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return posts.filter((post) => {
      const matchesStatus = filter === "all" ? true : post.status === filter;
      const matchesQuery = needle
        ? `${post.caption} ${post.originalCaption} ${post.authorUsername} ${post.note}`
            .toLowerCase()
            .includes(needle)
        : true;
      return matchesStatus && matchesQuery;
    });
  }, [posts, filter, query]);

  const copyAll = async () => {
    if (!filtered.length) {
      toast("Nothing to copy", "warn");
      return;
    }
    const payload = filtered
      .map(
        (post, index) =>
          `── ${String(index + 1).padStart(2, "0")} · cr: @${post.authorUsername} ──\n${post.caption}\n${post.shareUrl ?? ""}`,
      )
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(payload);
      toast(`${filtered.length} captions copied`, "ok", "Ready to paste into your scheduler");
    } catch {
      toast("Clipboard blocked", "warn");
    }
  };

  const exportAs = (format: "txt" | "csv" | "json") => {
    const url = `/api/export?format=${format}&status=${filter}`;
    window.open(url, "_blank", "noopener");
    toast(`Export started`, "info", `${format.toUpperCase()} of ${filter === "all" ? "all" : filter} clips`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="mono-num text-[10px] tracking-[0.24em] text-dim uppercase">
            post queue
          </p>
          <h2 className="font-display text-[26px] leading-none font-bold tracking-[0.04em] text-text uppercase">
            Ready to repost
          </h2>
          <p className="mt-1.5 text-[12.5px] text-muted">
            Every saved clip keeps the creator's caption and your{" "}
            <span className="text-signal">{settings.creditPrefix} @handle</span> credit line.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={copyAll}>
            Copy all captions
          </Button>
          <Button size="sm" onClick={() => exportAs("txt")}>
            TXT
          </Button>
          <Button size="sm" onClick={() => exportAs("csv")}>
            CSV
          </Button>
          <Button size="sm" onClick={() => exportAs("json")}>
            JSON
          </Button>
          <Button size="sm" onClick={onRefresh} title="Reload from the database">
            <IconRefresh className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" variant="danger" onClick={onClear} disabled={!posts.length}>
            <IconTrash className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {["all", ...STATUSES.map((s) => s.id)].map((status) => (
          <Chip
            key={status}
            active={filter === status}
            tone={status === "posted" ? "neutral" : "signal"}
            onClick={() => setFilter(status)}
          >
            {status} · {tally[status] ?? 0}
          </Chip>
        ))}
        <input
          className={`${inputClass} ml-auto w-full max-w-xs py-1.5 text-[12px]`}
          placeholder="Filter by caption, creator or note…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-line2 bg-panel/40 px-6 py-16 text-center">
          <IconQueue className="mx-auto h-8 w-8 text-line2" />
          <p className="font-display mt-3 text-[15px] tracking-[0.1em] text-muted uppercase">
            {posts.length ? "Nothing matches that filter" : "The queue is empty"}
          </p>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-dim">
            {posts.length
              ? "Try another status chip or clear the search field."
              : "Grab clips on the fetch desk, hit “Send to queue” in a dossier, and they land here with a finished caption, credit line and a watermark-free download."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filtered.map((post, index) => {
            const expanded = open === post.id;
            return (
              <Reveal
                as="li"
                key={post.id}
                delay={Math.min(index * 45, 400)}
                className="group relative border border-line bg-panel/60 transition-colors duration-300 hover:border-signal/40"
              >
                <div className="flex gap-3 p-3">
                  <div className="relative h-[104px] w-[74px] shrink-0 overflow-hidden border border-line bg-ink">
                    {post.coverUrl ? (
                      <img
                        src={post.coverUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        onError={(event) => {
                          const el = event.currentTarget as HTMLImageElement;
                          if (!el.src.includes("/api/media/stream")) {
                            el.src = proxiedMedia(post.coverUrl);
                          } else {
                            el.style.display = "none";
                          }
                        }}
                      />
                    ) : (
                      <span className="font-display flex h-full items-center justify-center text-[18px] text-white/[0.07]">
                        {(post.authorUsername || "tt").slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="mono-num absolute right-0 bottom-0 bg-ink/85 px-1 text-[9px] text-text">
                      {formatDuration(post.durationSec)}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] font-bold text-text">@{post.authorUsername}</p>
                      <span className="mono-num text-[10px] text-dim">
                        {formatCount(post.playCount)} plays · {formatAgo(post.savedAt)}
                      </span>
                      <span
                        className={`mono-num ml-auto border px-1.5 py-0.5 text-[9.5px] tracking-[0.16em] uppercase ${
                          post.status === "posted"
                            ? "border-acid/50 bg-acid/12 text-acid"
                            : post.status === "skipped"
                              ? "border-line2 text-dim"
                              : "border-signal/50 bg-signal/12 text-signal"
                        }`}
                      >
                        {post.status}
                      </span>
                    </div>

                    <p
                      className={`mt-1.5 text-[12.5px] leading-snug break-words whitespace-pre-line text-muted ${
                        expanded ? "" : "line-clamp-2"
                      }`}
                    >
                      {post.caption}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onPublish(post)}
                        className="font-display flex items-center gap-1.5 border border-acid/40 bg-acid/[0.08] px-2.5 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-acid uppercase transition-colors hover:bg-acid/[0.16]"
                      >
                        <IconUpload className="h-3.5 w-3.5" />
                        Post to TikTok
                      </button>
                      <CopyButton value={post.caption} label="Copy" size="sm" />
                      <Button size="sm" variant="ghost" onClick={() => setOpen(expanded ? null : post.id)}>
                        {expanded ? "Collapse" : "Expand"}
                      </Button>
                      <a
                        href={post.shareUrl ?? "#"}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-display flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-dim uppercase transition-colors hover:text-signal"
                      >
                        <IconExternal className="h-3.5 w-3.5" />
                        Source
                      </a>
                      {post.playUrl ? (
                        <a
                          href={`${proxiedMedia(post.hdPlayUrl ?? post.playUrl)}&download=1&filename=tiktok-${post.authorUsername}-${post.tiktokId}.mp4`}
                          className="font-display flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-dim uppercase transition-colors hover:text-signal"
                        >
                          <IconDownload className="h-3.5 w-3.5" />
                          MP4
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onDelete(post)}
                        className="font-display ml-auto flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-dim uppercase transition-colors hover:text-flare"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                        Drop
                      </button>
                    </div>

                    {post.note ? (
                      <p className="mono-num mt-2 border-l-2 border-amber/60 pl-2 text-[11px] text-amber/90">
                        note · {post.note}
                      </p>
                    ) : null}

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line/70 pt-2.5">
                      {STATUSES.map((status) => (
                        <button
                          key={status.id}
                          type="button"
                          onClick={() => onStatus(post, status.id)}
                          className={`mono-num flex items-center gap-1 border px-2 py-1 text-[10px] tracking-[0.14em] uppercase transition-all ${
                            post.status === status.id
                              ? status.id === "posted"
                                ? "border-acid/60 bg-acid/14 text-acid"
                                : status.id === "skipped"
                                  ? "border-line2 bg-white/5 text-text"
                                  : "border-signal/60 bg-signal/14 text-signal"
                              : "border-line text-dim hover:border-line2 hover:text-muted"
                          }`}
                        >
                          {post.status === status.id ? (
                            status.id === "skipped" ? (
                              <IconClose className="h-3 w-3" />
                            ) : (
                              <IconCheck className="h-3 w-3" />
                            )
                          ) : null}
                          {status.label}
                        </button>
                      ))}
                      <span className="mono-num ml-auto text-[10px] text-dim uppercase">
                        {post.captionStyle} · {post.caption.length} chars
                      </span>
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </ul>
      )}

      {posts.length > 0 ? (
        <p className="mono-num flex items-center gap-2 text-[10.5px] text-dim uppercase">
          <IconAlert className="h-3.5 w-3.5" />
          Repost responsibly — credit the creator, and drop clips that ask not to be shared.
        </p>
      ) : null}
    </div>
  );
}
