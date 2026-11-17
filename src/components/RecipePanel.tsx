"use client";

import { useMemo } from "react";
import type { CaptionStyle, Settings, TikTokVideo } from "@/lib/types";
import {
  HASHTAG_PACKS,
  STYLE_META,
  STYLE_ORDER,
  TIKTOK_CAPTION_LIMIT,
  buildVariants,
} from "@/lib/captions";
import { REGIONS } from "@/lib/tiktok-client";
import { Button, Chip, CopyButton, Field, Toggle, inputClass } from "./ui";
import { IconRefresh, IconSpark, IconTag } from "./icons";

const CREDIT_PRESETS = ["cr:", "🎥 cr:", "vid:", "©", "src:", "📹"];
const PLACEMENTS: { id: Settings["creditPlacement"]; label: string }[] = [
  { id: "bottom", label: "bottom" },
  { id: "top", label: "top" },
  { id: "inline", label: "inline" },
];
const CREDIT_MODES: { id: Settings["creditMode"]; label: string; example: string }[] = [
  { id: "username", label: "@handle", example: "cr: @dailyrelatable" },
  { id: "nickname", label: "display name", example: "cr: Relatable Clips" },
  { id: "both", label: "both", example: "cr: @dailyrelatable (Relatable Clips)" },
];
const EMOJI_MODES: { id: Settings["emojiMode"]; label: string }[] = [
  { id: "keep", label: "keep" },
  { id: "strip", label: "strip" },
  { id: "boost", label: "boost" },
];

export function RecipePanel({
  settings,
  sample,
  onChange,
  onReset,
  saving,
  savedAt,
}: {
  settings: Settings;
  sample: TikTokVideo;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  saving: boolean;
  savedAt: string | null;
}) {
  const variants = useMemo(() => buildVariants(sample, settings, 0), [sample, settings]);
  const active = variants[0];

  const togglePack = (pack: string) => {
    const next = settings.packs.includes(pack)
      ? settings.packs.filter((p) => p !== pack)
      : [...settings.packs, pack];
    onChange({ packs: next });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-4">
        <div className="border-b border-line pb-3">
          <p className="mono-num text-[10px] tracking-[0.24em] text-dim uppercase">
            caption recipe
          </p>
          <h2 className="font-display text-[26px] leading-none font-bold tracking-[0.04em] text-text uppercase">
            How your reposts read
          </h2>
          <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">
            Every fetched clip runs through this recipe. Keep the creator's caption, add your
            credit line, and let the desk handle tags, emoji and length limits.
          </p>
        </div>

        <section className="border border-line bg-panel/60 p-4">
          <h3 className="font-display text-[13px] font-bold tracking-[0.14em] text-text uppercase">
            Identity & credit
          </h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Your repost handle" hint="used in CTAs and the preview">
              <div className="flex items-center gap-1">
                <span className="mono-num border border-line bg-pit px-2 py-2 text-[13px] text-dim">
                  @
                </span>
                <input
                  className={inputClass}
                  value={settings.handle}
                  placeholder="relatable.replays"
                  onChange={(event) => onChange({ handle: event.target.value })}
                />
              </div>
            </Field>
            <Field label="Credit prefix">
              <input
                className={inputClass}
                value={settings.creditPrefix}
                maxLength={12}
                onChange={(event) => onChange({ creditPrefix: event.target.value })}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CREDIT_PRESETS.map((preset) => (
                  <Chip
                    key={preset}
                    active={settings.creditPrefix === preset}
                    onClick={() => onChange({ creditPrefix: preset })}
                  >
                    {preset}
                  </Chip>
                ))}
              </div>
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Credit uses">
              <div className="flex flex-col gap-1.5">
                {CREDIT_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => onChange({ creditMode: mode.id })}
                    className={`flex items-center justify-between gap-2 border px-3 py-2 text-left transition-colors ${
                      settings.creditMode === mode.id
                        ? "border-signal/60 bg-signal/[0.07]"
                        : "border-line bg-pit/40 hover:border-line2"
                    }`}
                  >
                    <span className="font-display text-[11.5px] tracking-[0.1em] text-text uppercase">
                      {mode.label}
                    </span>
                    <span className="mono-num text-[10.5px] text-dim">{mode.example}</span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Credit placement">
              <div className="flex flex-wrap gap-1.5">
                {PLACEMENTS.map((placement) => (
                  <Chip
                    key={placement.id}
                    active={settings.creditPlacement === placement.id}
                    onClick={() => onChange({ creditPlacement: placement.id })}
                  >
                    {placement.label}
                  </Chip>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-dim">
                Bottom keeps the caption clean; top makes credit impossible to miss; inline
                appends it to the last line with a dash.
              </p>
            </Field>
          </div>
        </section>

        <section className="border border-line bg-panel/60 p-4">
          <h3 className="font-display text-[13px] font-bold tracking-[0.14em] text-text uppercase">
            Default treatment
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {STYLE_ORDER.map((style: CaptionStyle) => {
              const meta = STYLE_META[style];
              const isActive = settings.defaultStyle === style;
              return (
                <button
                  key={style}
                  type="button"
                  onClick={() => onChange({ defaultStyle: style })}
                  className={`group border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                    isActive
                      ? "border-signal/60 bg-signal/[0.07]"
                      : "border-line bg-pit/40 hover:border-line2"
                  }`}
                >
                  <p
                    className={`font-display text-[12px] font-bold tracking-[0.1em] uppercase ${
                      isActive ? "text-signal" : "text-text"
                    }`}
                  >
                    {meta.label}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-snug text-muted">{meta.blurb}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Toggle
              checked={settings.includeOriginal}
              onChange={(next) => onChange({ includeOriginal: next })}
              label="Use the creator's caption"
              description="Off = credit line and tags only."
            />
            <Toggle
              checked={settings.stripBoilerplate}
              onChange={(next) => onChange({ stripBoilerplate: next })}
              label="Strip TikTok boilerplate"
              description="Removes 'check out TikTok's … community', sound names and URLs."
            />
            <Toggle
              checked={settings.stripMentions}
              onChange={(next) => onChange({ stripMentions: next })}
              label="Strip @mentions from the body"
              description="Avoids tagging random accounts; credit still carries the creator."
            />
            <Toggle
              checked={settings.autoSave}
              onChange={(next) => onChange({ autoSave: next })}
              label="Auto-queue every fetched clip"
              description="Sends each pull straight into the post queue with its default caption."
            />
          </div>

          <div className="mt-4">
            <Field label="Emoji handling">
              <div className="flex flex-wrap gap-1.5">
                {EMOJI_MODES.map((mode) => (
                  <Chip
                    key={mode.id}
                    active={settings.emojiMode === mode.id}
                    onClick={() => onChange({ emojiMode: mode.id })}
                  >
                    {mode.label}
                  </Chip>
                ))}
              </div>
            </Field>
          </div>
        </section>

        <section className="border border-line bg-panel/60 p-4">
          <h3 className="font-display flex items-center gap-2 text-[13px] font-bold tracking-[0.14em] text-text uppercase">
            <IconTag className="h-4 w-4 text-signal" />
            Hashtag packs
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(HASHTAG_PACKS).map(([key, pack]) => {
              const isActive = settings.packs.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => togglePack(key)}
                  className={`border p-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                    isActive
                      ? "border-signal/55 bg-signal/[0.06]"
                      : "border-line bg-pit/40 hover:border-line2"
                  }`}
                >
                  <p
                    className={`font-display text-[11.5px] font-semibold tracking-[0.1em] uppercase ${
                      isActive ? "text-signal" : "text-text"
                    }`}
                  >
                    {pack.label}
                  </p>
                  <p className="mono-num mt-1 line-clamp-2 text-[10px] leading-snug text-dim">
                    {pack.tags.map((tag) => `#${tag}`).join(" ")}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Always add" hint="space or comma separated">
              <input
                className={inputClass}
                value={settings.extraHashtags.join(" ")}
                placeholder="fyp yourpage relatable"
                onChange={(event) =>
                  onChange({
                    extraHashtags: event.target.value
                      .split(/[\s,]+/)
                      .map((t) => t.replace(/^#/, ""))
                      .filter(Boolean),
                  })
                }
              />
            </Field>
            <Field label="Never use" hint="banned or over-saturated tags">
              <input
                className={inputClass}
                value={settings.blockedHashtags.join(" ")}
                placeholder="xyzbca follow"
                onChange={(event) =>
                  onChange({
                    blockedHashtags: event.target.value
                      .split(/[\s,]+/)
                      .map((t) => t.replace(/^#/, ""))
                      .filter(Boolean),
                  })
                }
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Max hashtags" hint={String(settings.maxHashtags)}>
              <input
                type="range"
                min={0}
                max={20}
                value={settings.maxHashtags}
                onChange={(event) => onChange({ maxHashtags: Number(event.target.value) })}
                className="w-full"
              />
            </Field>
            <Field label="Max caption length" hint={`${settings.maxCaptionLength} / ${TIKTOK_CAPTION_LIMIT}`}>
              <input
                type="range"
                min={120}
                max={4000}
                step={20}
                value={settings.maxCaptionLength}
                onChange={(event) => onChange({ maxCaptionLength: Number(event.target.value) })}
                className="w-full"
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Footer line" hint="CTA under the caption">
              <input
                className={inputClass}
                value={settings.footer}
                placeholder={settings.handle ? `follow @${settings.handle} for daily relatable clips` : "follow for daily relatable clips"}
                onChange={(event) => onChange({ footer: event.target.value })}
              />
            </Field>
            <Field label="Default region">
              <div className="flex flex-wrap gap-1.5">
                {REGIONS.slice(0, 10).map((region) => (
                  <Chip
                    key={region.code}
                    active={settings.defaultRegion === region.code}
                    onClick={() => onChange({ defaultRegion: region.code })}
                  >
                    {region.code}
                  </Chip>
                ))}
              </div>
            </Field>
          </div>
        </section>
      </div>

      {/* live preview rail */}
      <aside className="flex flex-col gap-3 xl:sticky xl:top-[132px] xl:self-start">
        <div className="border border-signal/25 bg-signal/[0.04] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="mono-num text-[9.5px] tracking-[0.22em] text-signal uppercase">
              live output · {active.label}
            </p>
            <IconSpark className="h-4 w-4 text-signal" />
          </div>
          <p className="mono-num mt-2 text-[10px] text-dim uppercase">
            sample clip · @{sample.authorUsername}
          </p>
          <div className="scroll-thin mt-2 max-h-[34vh] overflow-y-auto border border-line bg-pit/80 p-3">
            <p className="text-[13px] leading-relaxed break-words whitespace-pre-line text-text">
              {active.text}
            </p>
          </div>
          <div className="mono-num mt-2 flex items-center justify-between text-[10px] text-dim uppercase">
            <span>{active.length} chars</span>
            <span>{active.tags.length} tags</span>
            <span>{active.credit}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton value={active.text} label="Copy sample" variant="primary" />
            <Button size="sm" onClick={onReset} disabled={saving}>
              <IconRefresh className="h-3.5 w-3.5" />
              Reset recipe
            </Button>
          </div>
          <p className="mono-num mt-3 text-[10px] text-dim">
            {saving ? "saving recipe…" : savedAt ? `saved ${savedAt}` : "autosaves as you type"}
          </p>
        </div>

        <div className="border border-line bg-panel/50 p-4">
          <p className="mono-num text-[9.5px] tracking-[0.22em] text-dim uppercase">
            all treatments
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {variants.map((variant) => (
              <li
                key={variant.style}
                className={`border px-2.5 py-2 transition-colors ${
                  variant.style === settings.defaultStyle
                    ? "border-signal/45 bg-signal/[0.05]"
                    : "border-line bg-pit/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-muted uppercase">
                    {variant.label}
                  </p>
                  <span className="mono-num text-[9.5px] text-dim">{variant.length}</span>
                </div>
                <p className="mt-1 line-clamp-3 text-[11.5px] leading-snug break-words whitespace-pre-line text-text/90">
                  {variant.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
