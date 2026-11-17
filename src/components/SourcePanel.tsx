"use client";

import { useMemo } from "react";
import type { FetchMode, Settings } from "@/lib/types";
import { REGIONS, extractTikTokLinks } from "@/lib/tiktok-client";
import { HASHTAG_PACKS, STYLE_META } from "@/lib/captions";
import { Button, Chip, Field, Spinner, inputClass } from "./ui";
import {
  IconAlert,
  IconArrow,
  IconLink,
  IconRadar,
  IconScan,
  IconSliders,
  IconTag,
} from "./icons";

export type FetchState = {
  loading: boolean;
  appending: boolean;
  error: string | null;
  notice: string | null;
  upstream: string | null;
  degraded: boolean;
  count: number;
  at: string | null;
  tagsTried?: { tag: string; found: number }[];
  resolving?: number;
};

const MODES: { id: FetchMode; label: string; blurb: string; Icon: typeof IconRadar }[] = [
  {
    id: "search",
    label: "Search TikTok",
    blurb: "Real tag search — the clips actually carrying your keyword.",
    Icon: IconScan,
  },
  {
    id: "link",
    label: "Link grab",
    blurb: "Paste TikTok links, short links or video IDs from your FYP.",
    Icon: IconLink,
  },
  {
    id: "firehose",
    label: "Firehose",
    blurb: "Whatever is trending in a region right now, paged.",
    Icon: IconRadar,
  },
];

const QUICK_SEARCHES = [
  "relatable",
  "relatable memes",
  "work memes",
  "school",
  "introvert",
  "gym memes",
  "3am thoughts",
  "siblings",
  "retail",
  "adulting",
];

export function SourcePanel({
  mode,
  setMode,
  region,
  setRegion,
  keyword,
  setKeyword,
  links,
  setLinks,
  count,
  setCount,
  state,
  hasMore,
  settings,
  onFetch,
  onLoadMore,
  onGotoRecipe,
}: {
  mode: FetchMode;
  setMode: (mode: FetchMode) => void;
  region: string;
  setRegion: (region: string) => void;
  keyword: string;
  setKeyword: (keyword: string) => void;
  links: string;
  setLinks: (links: string) => void;
  count: number;
  setCount: (count: number) => void;
  state: FetchState;
  hasMore: boolean;
  settings: Settings;
  onFetch: () => void;
  onLoadMore: () => void;
  onGotoRecipe: () => void;
}) {
  const parsedLinks = useMemo(() => extractTikTokLinks(links), [links]);
  const busy = state.loading || state.appending;
  const activeTags = settings.packs.flatMap((pack) => HASHTAG_PACKS[pack]?.tags ?? []);
  const triedSummary = (state.tagsTried ?? [])
    .filter((entry) => entry.found > 0)
    .map((entry) => `#${entry.tag} (${entry.found})`);

  return (
    <div className="flex flex-col gap-4">
      <div
        className="border border-line bg-panel/70 p-4 backdrop-blur-[2px]"
        style={{
          clipPath:
            "polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))",
        }}
      >
        <p className="mono-num text-[10px] tracking-[0.24em] text-dim uppercase">
          01 · source
        </p>
        <h2 className="font-display mt-1 text-[16px] font-bold tracking-wide uppercase">
          Find clips
        </h2>

        <div className="mt-3 flex flex-col gap-1.5">
          {MODES.map(({ id, label, blurb, Icon }) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`group flex items-start gap-3 border px-3 py-2.5 text-left transition-all duration-200 ${
                  active
                    ? "border-signal/50 bg-signal/[0.07]"
                    : "border-line bg-pit/40 hover:border-line2 hover:bg-white/[0.03]"
                }`}
              >
                <span className={`mt-0.5 ${active ? "text-signal" : "text-dim group-hover:text-muted"}`}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span
                    className={`font-display block text-[12.5px] font-semibold tracking-[0.1em] uppercase ${
                      active ? "text-signal" : "text-text"
                    }`}
                  >
                    {label}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{blurb}</span>
                </span>
                {active ? (
                  <span className="ml-auto mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-signal blip" />
                ) : null}
              </button>
            );
          })}
        </div>

        {mode === "search" ? (
          <div className="mt-4 space-y-3">
            <Field label="Search TikTok" hint="keyword, phrase or #tag">
              <div className="flex gap-1.5">
                <input
                  className={inputClass}
                  value={keyword}
                  placeholder="relatable, work memes, #gym…"
                  onChange={(event) => setKeyword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !busy) onFetch();
                  }}
                />
                <Button variant="primary" onClick={onFetch} disabled={busy} className="shrink-0">
                  {busy ? <Spinner className="h-4 w-4" /> : <IconScan className="h-4 w-4" />}
                </Button>
              </div>
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SEARCHES.map((word) => (
                <Chip
                  key={word}
                  tone="neutral"
                  active={keyword.toLowerCase() === word}
                  onClick={() => {
                    setKeyword(word);
                    setTimeout(onFetch, 20);
                  }}
                >
                  {word}
                </Chip>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-dim">
              The desk reads TikTok's public tag pages, so you get the clips that are actually
              ranked under your search — with their real captions, stats and creators.
            </p>
          </div>
        ) : null}

        {mode === "link" ? (
          <div className="mt-4 space-y-3">
            <Field label="TikTok links" hint="one per line · max 25">
              <textarea
                className={`${inputClass} mono-num h-32 resize-y text-[11.5px] leading-relaxed`}
                value={links}
                spellCheck={false}
                placeholder={
                  "https://www.tiktok.com/@someone/video/7106594312292453675\nhttps://vm.tiktok.com/ZM6xxxxx/\n7348273948201936160"
                }
                onChange={(event) => setLinks(event.target.value)}
              />
            </Field>
            <p className="mono-num text-[10.5px] tracking-[0.14em] text-dim uppercase">
              {parsedLinks.length} link{parsedLinks.length === 1 ? "" : "s"} parsed
              {parsedLinks.length > 25 ? <span className="text-flare"> · capped at 25</span> : null}
            </p>
          </div>
        ) : null}

        {mode === "firehose" ? (
          <div className="mt-4">
            <Field label="Region" hint={REGIONS.find((entry) => entry.code === region)?.label}>
              <div className="flex flex-wrap gap-1.5">
                {REGIONS.slice(0, 8).map((entry) => (
                  <Chip
                    key={entry.code}
                    active={region === entry.code}
                    onClick={() => setRegion(entry.code)}
                    title={entry.label}
                  >
                    {entry.code}
                  </Chip>
                ))}
                <select
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  className={`${inputClass} mono-num w-auto px-2 py-1 text-[11px] uppercase`}
                  aria-label="All regions"
                >
                  {REGIONS.map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.code}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          </div>
        ) : null}

        <div className="mt-4">
          <Field
            label="Clips per pull"
            hint={mode === "link" ? "set by your links" : `${count} videos`}
          >
            <input
              type="range"
              min={6}
              max={24}
              step={2}
              value={count}
              disabled={mode === "link"}
              onChange={(event) => setCount(Number(event.target.value))}
              className="w-full disabled:opacity-40"
            />
          </Field>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[8, 10, 12, 16].map((preset) => (
              <Chip
                key={preset}
                tone="neutral"
                active={count === preset}
                onClick={() => setCount(preset)}
              >
                {preset}
              </Chip>
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="primary" size="lg" className="flex-1" onClick={onFetch} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <IconScan className="h-4 w-4" />}
            {busy
              ? state.appending
                ? "Loading more…"
                : "Fetching…"
              : mode === "search"
                ? `Search ${count} clips`
                : "Fetch clips"}
          </Button>
          {hasMore && mode === "firehose" ? (
            <Button onClick={onLoadMore} disabled={busy} title="Load the next page">
              <IconArrow className="h-4 w-4" />
              More
            </Button>
          ) : null}
        </div>

        {state.error ? (
          <div className="mt-3 flex items-start gap-2 border border-flare/40 bg-flare/[0.08] px-3 py-2">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-flare" />
            <p className="text-[11.5px] leading-snug text-flare/90">{state.error}</p>
          </div>
        ) : null}

        {state.notice ? (
          <div className="mt-3 flex items-start gap-2 border border-line bg-pit/60 px-3 py-2">
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                state.degraded ? "bg-amber" : "bg-signal"
              }`}
            />
            <p className="text-[11.5px] leading-snug text-muted">
              {state.notice}
              {state.resolving ? (
                <span className="mono-num ml-1 text-signal">
                  · resolving watermark-free files {state.resolving}…
                </span>
              ) : null}
            </p>
          </div>
        ) : null}

        {triedSummary.length ? (
          <p className="mono-num mt-2 text-[10px] tracking-[0.1em] text-dim uppercase">
            read {triedSummary.join(" · ")}
          </p>
        ) : null}

        {state.upstream ? (
          <p className="mono-num mt-2 text-[10px] tracking-[0.12em] text-dim uppercase">
            via {state.upstream}
            {state.at ? ` · ${state.at}` : ""}
          </p>
        ) : null}
      </div>

      {/* recipe summary */}
      <div
        className="border border-line bg-panel/50 p-4"
        style={{
          clipPath:
            "polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="mono-num text-[10px] tracking-[0.24em] text-dim uppercase">
            02 · caption recipe
          </p>
          <button
            type="button"
            onClick={onGotoRecipe}
            className="font-display flex items-center gap-1 text-[10.5px] font-semibold tracking-[0.14em] text-signal uppercase transition-colors hover:text-text"
          >
            <IconSliders className="h-3.5 w-3.5" />
            edit
          </button>
        </div>

        <div className="mt-3 border border-line2/70 bg-pit/70 p-3">
          <p className="text-[12.5px] leading-relaxed text-muted">
            “i just love being the only one who understands the assignment 💀”
          </p>
          <p className="mt-2 text-[12.5px] font-semibold text-signal">
            {settings.creditPrefix} @creator
          </p>
          {settings.footer ? (
            <p className="mt-1.5 text-[11.5px] text-muted">{settings.footer}</p>
          ) : null}
          <p className="mono-num mt-2 text-[10.5px] break-words text-dim">
            {activeTags.slice(0, settings.maxHashtags).map((tag) => `#${tag}`).join(" ") ||
              "no hashtags"}
          </p>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          {[
            ["style", STYLE_META[settings.defaultStyle].label],
            ["credit", `${settings.creditPrefix} ${settings.creditMode}`],
            ["placement", settings.creditPlacement],
            ["emoji", settings.emojiMode],
            ["max tags", String(settings.maxHashtags)],
            ["max chars", String(settings.maxCaptionLength)],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="mono-num text-[9.5px] tracking-[0.18em] text-dim uppercase">
                {label}
              </dt>
              <dd className="truncate text-[12px] font-semibold text-text capitalize">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <IconTag className="h-3.5 w-3.5 text-dim" />
          <p className="text-[11px] leading-snug text-dim">
            Caption length cap for posting is 2200 characters — the recipe keeps you under it.
          </p>
        </div>
      </div>
    </div>
  );
}
