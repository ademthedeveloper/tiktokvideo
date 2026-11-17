"use client";

import { useEffect, useState } from "react";
import {
  LogoMark,
  IconRadar,
  IconQueue,
  IconSliders,
  IconRefresh,
  IconUpload,
} from "./icons";
import { ScrambleText } from "./ui";
import { postToVideo } from "@/lib/mappers";
import type { SavedPost, TikTokVideo } from "@/lib/types";

export type Tab = "desk" | "queue" | "publish" | "recipe";

type Health = { ok: boolean; latencyMs: number; detail: string } | null;

const TABS: { id: Tab; label: string; Icon: typeof IconRadar }[] = [
  { id: "desk", label: "Search desk", Icon: IconRadar },
  { id: "queue", label: "Post queue", Icon: IconQueue },
  { id: "publish", label: "Publish", Icon: IconUpload },
  { id: "recipe", label: "Caption recipe", Icon: IconSliders },
];

export function HeaderBar({
  tab,
  setTab,
  health,
  onPing,
  results,
  posts,
  pinging,
}: {
  tab: Tab;
  setTab: (next: Tab) => void;
  health: Health;
  onPing: () => void;
  results: TikTokVideo[];
  posts: SavedPost[];
  pinging: boolean;
}) {
  const wire = (results.length ? results : posts.slice(0, 14).map(postToVideoLike));
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const queued = posts.filter((p) => p.status === "queued").length;
  const avgLen = posts.length
    ? Math.round(posts.reduce((sum, p) => sum + (p.caption?.length ?? 0), 0) / posts.length)
    : 0;

  const statusTone = !health
    ? { label: "probing", cls: "text-dim border-line2", dot: "bg-dim" }
    : health.ok
      ? { label: `source live · ${health.latencyMs}ms`, cls: "text-signal border-signal/40", dot: "bg-signal blip" }
      : { label: "source degraded", cls: "text-flare border-flare/40", dot: "bg-flare" };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/88 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-70">
        <div className="sweep" />
      </div>
      <div className="pointer-events-none absolute inset-0 grid-lines opacity-60" />

      <div className="relative mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 lg:px-7">
        <div className="flex items-center gap-3">
          <LogoMark className="h-10 w-10 shrink-0" />
          <div className="leading-none">
            <h1 className="font-display text-[22px] font-bold tracking-[0.06em] text-text uppercase">
              <ScrambleText text="REPOST DESK" />
            </h1>
            <p className="mono-num mt-1 text-[10px] tracking-[0.22em] text-dim uppercase">
              tiktok clip fetcher · caption writer · cr: engine
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onPing}
          title="Re-check the upstream source"
          className={`mono-num group flex items-center gap-2 border px-2.5 py-1.5 text-[10.5px] tracking-[0.14em] uppercase transition-colors hover:bg-white/[0.04] ${statusTone.cls}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${statusTone.dot}`} />
          {statusTone.label}
          <IconRefresh className={`h-3 w-3 opacity-60 ${pinging ? "animate-spin" : ""}`} />
        </button>

        <div className="mono-num ml-auto hidden items-center gap-5 text-[10.5px] tracking-[0.16em] text-dim uppercase md:flex">
          <span>
            fetched <b className="text-text">{results.length}</b>
          </span>
          <span>
            queued <b className="text-signal">{queued}</b>
          </span>
          <span>
            saved <b className="text-text">{posts.length}</b>
          </span>
          <span>
            avg caption <b className="text-text">{avgLen || "—"}</b>
          </span>
          <span className="text-muted">{now}</span>
        </div>

        <nav className="flex items-center gap-1">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`font-display group relative flex items-center gap-2 px-3 py-2 text-[11.5px] font-semibold tracking-[0.14em] uppercase transition-all duration-200 ${
                tab === id
                  ? "bg-panel2 text-signal"
                  : "text-muted hover:bg-white/[0.04] hover:text-text"
              }`}
              style={{
                clipPath:
                  "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))",
              }}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
              {id === "queue" && queued > 0 ? (
                <span className="mono-num bg-signal/20 px-1.5 py-0.5 text-[9.5px] text-signal">
                  {queued}
                </span>
              ) : null}
              {tab === id ? (
                <span className="absolute inset-x-0 -bottom-px h-px bg-signal shadow-[0_0_10px_2px_rgba(36,224,210,.6)]" />
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      {/* wire ticker */}
      <div className="relative flex items-center gap-3 border-t border-line/70 bg-pit/70">
        <span className="mono-num shrink-0 border-r border-line bg-flare/12 px-3 py-1.5 text-[9.5px] tracking-[0.24em] text-flare uppercase">
          wire
        </span>
        <div className="relative flex-1 overflow-hidden py-1.5">
          {wire.length ? (
            <div className="ticker-track gap-8">
              {[...wire, ...wire].map((video, index) => (
                <span
                  key={`${video.id}-${index}`}
                  className="mono-num flex shrink-0 items-center gap-2 text-[11px] whitespace-nowrap text-muted"
                >
                  <span className="text-signal">@{video.authorUsername}</span>
                  <span className="text-dim">·</span>
                  <span className="max-w-[46ch] truncate">
                    {(video.caption || "(no caption)").replace(/\s+/g, " ")}
                  </span>
                  <span className="text-dim">·</span>
                  <span className="text-dim">{video.id}</span>
                </span>
              ))}
            </div>
          ) : (
            <span className="mono-num px-1 text-[11px] text-dim">
              idle — pick a source on the left and pull clips into the desk
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

function postToVideoLike(post: SavedPost): TikTokVideo {
  return postToVideo(post);
}
