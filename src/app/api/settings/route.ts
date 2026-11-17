import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/init";
import { appSettings } from "@/db/schema";
import { DEFAULT_SETTINGS, parseList, settingsFromRow } from "@/lib/captions";
import type { Settings } from "@/lib/types";

export const dynamic = "force-dynamic";

async function readRow() {
  await ensureSchema();
  const rows = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  return rows[0];
}

export async function GET() {
  try {
    const row = await readRow();
    if (!row) return NextResponse.json({ settings: DEFAULT_SETTINGS });
    return NextResponse.json({ settings: settingsFromRow(row), saved: true });
  } catch (err) {
    return NextResponse.json(
      { settings: DEFAULT_SETTINGS, error: err instanceof Error ? err.message : "db error" },
      { status: 200 },
    );
  }
}

function bool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export async function PUT(request: Request) {
  try {
    const row = await readRow();
    const current = row ? settingsFromRow(row) : DEFAULT_SETTINGS;
    const body = (await request.json()) as Partial<Settings>;

    const next: Settings = {
      ...current,
      handle: (body.handle ?? current.handle).replace(/^@/, "").trim().slice(0, 60),
      creditPrefix: (body.creditPrefix ?? current.creditPrefix).trim().slice(0, 12) || "cr:",
      creditMode: body.creditMode ?? current.creditMode,
      creditPlacement: body.creditPlacement ?? current.creditPlacement,
      defaultStyle: body.defaultStyle ?? current.defaultStyle,
      includeOriginal: bool(body.includeOriginal, current.includeOriginal),
      keepOriginalHashtags: bool(body.keepOriginalHashtags, current.keepOriginalHashtags),
      stripMentions: bool(body.stripMentions, current.stripMentions),
      stripBoilerplate: bool(body.stripBoilerplate, current.stripBoilerplate),
      emojiMode: body.emojiMode ?? current.emojiMode,
      packs: Array.isArray(body.packs) ? body.packs : current.packs,
      extraHashtags: Array.isArray(body.extraHashtags)
        ? body.extraHashtags
        : typeof body.extraHashtags === "string"
          ? parseList(body.extraHashtags)
          : current.extraHashtags,
      blockedHashtags: Array.isArray(body.blockedHashtags)
        ? body.blockedHashtags
        : typeof body.blockedHashtags === "string"
          ? parseList(body.blockedHashtags)
          : current.blockedHashtags,
      maxHashtags: Math.max(0, Math.min(20, Number(body.maxHashtags ?? current.maxHashtags))),
      maxCaptionLength: Math.max(
        120,
        Math.min(4000, Number(body.maxCaptionLength ?? current.maxCaptionLength)),
      ),
      footer: (body.footer ?? current.footer).slice(0, 240),
      defaultRegion: (body.defaultRegion ?? current.defaultRegion).toUpperCase().slice(0, 2),
      autoSave: bool(body.autoSave, current.autoSave),
    };

    await ensureSchema();
    await db
      .insert(appSettings)
      .values({
        id: 1,
        handle: next.handle,
        creditPrefix: next.creditPrefix,
        creditMode: next.creditMode,
        creditPlacement: next.creditPlacement,
        defaultStyle: next.defaultStyle,
        includeOriginal: next.includeOriginal,
        keepOriginalHashtags: next.keepOriginalHashtags,
        stripMentions: next.stripMentions,
        stripBoilerplate: next.stripBoilerplate,
        emojiMode: next.emojiMode,
        packs: next.packs.join(","),
        extraHashtags: next.extraHashtags.join(","),
        blockedHashtags: next.blockedHashtags.join(","),
        maxHashtags: next.maxHashtags,
        maxCaptionLength: next.maxCaptionLength,
        footer: next.footer,
        defaultRegion: next.defaultRegion,
        autoSave: next.autoSave,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettings.id,
        set: {
          handle: next.handle,
          creditPrefix: next.creditPrefix,
          creditMode: next.creditMode,
          creditPlacement: next.creditPlacement,
          defaultStyle: next.defaultStyle,
          includeOriginal: next.includeOriginal,
          keepOriginalHashtags: next.keepOriginalHashtags,
          stripMentions: next.stripMentions,
          stripBoilerplate: next.stripBoilerplate,
          emojiMode: next.emojiMode,
          packs: next.packs.join(","),
          extraHashtags: next.extraHashtags.join(","),
          blockedHashtags: next.blockedHashtags.join(","),
          maxHashtags: next.maxHashtags,
          maxCaptionLength: next.maxCaptionLength,
          footer: next.footer,
          defaultRegion: next.defaultRegion,
          autoSave: next.autoSave,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ settings: next, saved: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not save settings" },
      { status: 500 },
    );
  }
}
