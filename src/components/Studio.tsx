"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CaptionVariant,
  FetchMode,
  FetchResult,
  SavedPost,
  Settings,
  TikTokVideo,
} from "@/lib/types";
import { DEFAULT_SETTINGS, buildVariants, formatCount } from "@/lib/captions";
import { makeVideo } from "@/lib/video-factory";
import { HeaderBar, type Tab } from "./HeaderBar";
import { SourcePanel, type FetchState } from "./SourcePanel";
import { ClipCard } from "./ClipCard";
import { ClipDrawer } from "./ClipDrawer";
import { LibraryPanel } from "./LibraryPanel";
import { PublishPanel, type PublishTarget } from "./PublishPanel";
import { RecipePanel } from "./RecipePanel";
import { Button, Reveal, ToastHost, useToast } from "./ui";
import {
  IconAlert,
  IconArrow,
  IconLink,
  IconRadar,
  IconScan,
  IconSpark,
  IconUpload,
} from "./icons";

const SAMPLE_VIDEO: TikTokVideo = makeVideo({
  id: "7300000000000000001",
  caption:
    "me pretending i heard the assignment 💀 why is group work always 3 people doing nothing #relatable #school #fyp",
  authorUsername: "dailyrelatable",
  authorNickname: "Relatable Clips",
  durationSec: 17,
  region: "US",
  postedAt: new Date(Date.now() - 86_400_000 * 3).toISOString(),
  playCount: 842_000,
  diggCount: 96_400,
  commentCount: 2_310,
  shareCount: 18_900,
  matchedTag: "relatable",
  source: "search",
});

const IDLE_STATE: FetchState = {
  loading: false,
  appending: false,
  error: null,
  notice: null,
  upstream: null,
  degraded: false,
  count: 0,
  at: null,
};

function clock() {
  return new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function Studio({
  initialSettings,
  initialPosts,
}: {
  initialSettings: Settings;
  initialPosts: SavedPost[];
}) {
  return (
    <ToastHost>
      <StudioInner initialSettings={initialSettings} initialPosts={initialPosts} />
    </ToastHost>
  );
}

function StudioInner({
  initialSettings,
  initialPosts,
}: {
  initialSettings: Settings;
  initialPosts: SavedPost[];
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("desk");
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [posts, setPosts] = useState<SavedPost[]>(initialPosts);
  const [tally, setTally] = useState<Record<string, number>>({});
  const [loadingPosts, setLoadingPosts] = useState(false);

  const [mode, setMode] = useState<FetchMode>("search");
  const [region, setRegion] = useState(initialSettings.defaultRegion || "US");
  const [keyword, setKeyword] = useState("relatable");
  const [links, setLinks] = useState("");
  const [count, setCount] = useState(10);

  const [results, setResults] = useState<TikTokVideo[]>([]);
  const [state, setState] = useState<FetchState>(IDLE_STATE);
  const [cursor, setCursor] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [seedMap, setSeedMap] = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [publishTarget, setPublishTarget] = useState<PublishTarget>(null);
  const [flash, setFlash] = useState<{ kind: string; text: string } | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; latencyMs: number; detail: string } | null>(
    null,
  );
  const [pinging, setPinging] = useState(false);
  const firstRun = useRef(true);
  const resultsRef = useRef<TikTokVideo[]>([]);
  const enrichQueue = useRef<string[]>([]);
  const enriching = useRef(false);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const savedByTiktokId = useMemo(() => {
    const map: Record<string, SavedPost> = {};
    for (const post of posts) map[post.tiktokId] = post;
    return map;
  }, [posts]);

  /* ── upstream health ─────────────────────────────────────────── */
  const ping = useCallback(async () => {
    setPinging(true);
    try {
      const res = await fetch("/api/tiktok/health", { cache: "no-store" });
      setHealth(await res.json());
    } catch {
      setHealth({ ok: false, latencyMs: 0, detail: "unreachable" });
    } finally {
      setPinging(false);
    }
  }, []);

  const refreshPosts = useCallback(async (silent = false) => {
    if (!silent) setLoadingPosts(true);
    try {
      const res = await fetch("/api/posts", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data.posts)) setPosts(data.posts);
      if (data.tally) setTally(data.tally);
    } catch {
      if (!silent) toast("Could not load the queue", "warn");
    } finally {
      setLoadingPosts(false);
    }
  }, [toast]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      void ping();
      void refreshPosts(true);
      // deep-link from the TikTok OAuth redirect
      const params = new URLSearchParams(window.location.search);
      const flag = params.get("tiktok");
      if (flag) {
        const reason = params.get("tiktok_reason");
        if (flag === "connected") {
          setFlash({ kind: "connected", text: "TikTok account connected — you can post now." });
          setTab("publish");
        } else if (flag === "denied") {
          setFlash({ kind: "denied", text: `You declined the TikTok connection${reason ? `: ${reason}` : ""}.` });
          setTab("publish");
        } else {
          setFlash({
            kind: "failed",
            text: `TikTok connection failed${reason ? `: ${decodeURIComponent(reason)}` : ""}`,
          });
          setTab("publish");
        }
        window.history.replaceState({}, "", "/");
      }
      if (params.get("tab") === "publish") setTab("publish");
    }
  }, [ping, refreshPosts]);

  /* ── settings autosave ───────────────────────────────────────── */
  useEffect(() => {
    const id = setTimeout(async () => {
      setSavingSettings(true);
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        });
        const data = await res.json();
        if (data?.settings) {
          setSettings(data.settings);
          setSavedAt(clock());
        }
      } catch {
        toast("Recipe not saved", "warn", "Database unavailable — changes stay local");
      } finally {
        setSavingSettings(false);
      }
    }, 700);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  /* ── caption variants (derived) ──────────────────────────────── */
  const variantMap = useMemo(() => {
    const map: Record<string, CaptionVariant[]> = {};
    for (const video of results) {
      map[video.id] = buildVariants(video, settings, seedMap[video.id] ?? 0);
    }
    return map;
  }, [results, settings, seedMap]);

  const variantsFor = useCallback(
    (video: TikTokVideo): CaptionVariant[] =>
      variantMap[video.id] ?? buildVariants(video, settings, seedMap[video.id] ?? 0),
    [variantMap, settings, seedMap],
  );

  const activeVideo = useMemo(
    () => results.find((video) => video.id === activeId) ?? null,
    [results, activeId],
  );
  const activeSeed = activeVideo ? (seedMap[activeVideo.id] ?? 0) : 0;
  const activeVariants = useMemo(() => {
    if (!activeVideo) return [];
    return variantMap[activeVideo.id] ?? buildVariants(activeVideo, settings, activeSeed);
  }, [activeVideo, variantMap, settings, activeSeed]);

  /* ── progressive media resolution (watermark-free files) ─────── */
  const runEnrichment = useCallback(async (incoming: TikTokVideo[]) => {
    const pending = incoming.filter((video) => !video.enriched && !video.hdPlayUrl);
    if (!pending.length) return;
    enrichQueue.current = pending.map((video) => video.id);
    if (enriching.current) return;
    enriching.current = true;
    setState((prev) => ({ ...prev, resolving: enrichQueue.current.length }));

    while (enrichQueue.current.length) {
      const id = enrichQueue.current.shift();
      if (!id) break;
      const video = resultsRef.current.find((item) => item.id === id);
      if (video) {
        try {
          const res = await fetch("/api/tiktok/enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video }),
          });
          const data = await res.json();
          if (data?.video) {
            const enriched = makeVideo({
              ...video,
              ...data.video,
              matchedTag: video.matchedTag ?? data.video.matchedTag,
              rank: video.rank,
              source: video.source,
            });
            setResults((prev) => prev.map((item) => (item.id === id ? enriched : item)));
            resultsRef.current = resultsRef.current.map((item) =>
              item.id === id ? enriched : item,
            );
          }
        } catch {
          /* one clip failing should not stop the rest */
        }
      }
      setState((prev) => ({ ...prev, resolving: enrichQueue.current.length }));
    }

    enriching.current = false;
    setState((prev) => ({ ...prev, resolving: 0 }));
  }, []);

  /* ── fetching ────────────────────────────────────────────────── */
  const runFetch = useCallback(
    async (append = false, override?: { mode?: FetchMode; keyword?: string }) => {
      const useMode = override?.mode ?? mode;
      const useKeyword = override?.keyword ?? keyword;
      setState((prev) => ({
        ...prev,
        loading: !append,
        appending: append,
        error: null,
        tagsTried: [],
      }));
      try {
        const res = await fetch("/api/tiktok/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: useMode,
            region,
            keyword: useKeyword,
            links,
            count,
            cursor: append ? cursor : 0,
          }),
        });
        const data = (await res.json()) as FetchResult & {
          error?: string;
          failures?: { link: string; reason: string }[];
        };
        if (!res.ok || data.error) throw new Error(data.error ?? `Request failed (${res.status})`);

        const incoming = data.videos ?? [];
        setResults((prev) => {
          if (!append) return incoming;
          const seen = new Set(prev.map((video) => video.id));
          return [...prev, ...incoming.filter((video) => !seen.has(video.id))];
        });
        setCursor(data.nextCursor ?? 0);
        setHasMore(Boolean(data.hasMore) && useMode === "firehose");
        setState({
          loading: false,
          appending: false,
          error: null,
          notice: data.notice ?? `${incoming.length} clips pulled`,
          upstream: data.upstream ?? "tiktok.com",
          degraded: Boolean(data.degraded),
          count: incoming.length,
          at: clock(),
          tagsTried: data.tagsTried ?? [],
          attempts: data.attempts ?? [],
          resolving: 0,
        });

        if (incoming.length) {
          toast(
            `${incoming.length} clip${incoming.length === 1 ? "" : "s"} found`,
            "ok",
            data.notice ?? undefined,
          );
          void runEnrichment(incoming);

          if (settings.autoSave) {
            let savedCount = 0;
            for (const video of incoming) {
              const variant = buildVariants(video, settings, 0)[0];
              try {
                const saveRes = await fetch("/api/posts", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    video,
                    caption: variant.text,
                    captionStyle: variant.style,
                  }),
                });
                if (saveRes.ok) savedCount += 1;
              } catch {
                /* keep going */
              }
            }
            if (savedCount) {
              toast(`${savedCount} clips auto-queued`, "ok", "Auto-save is on in the recipe");
              await refreshPosts(true);
            }
          }
        } else {
          toast("No clips matched", "warn", data.notice ?? "Try another tag, region, or Link grab");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Fetch failed";
        setState((prev) => ({
          ...prev,
          loading: false,
          appending: false,
          error: message,
          notice: null,
          attempts: [],
          resolving: 0,
        }));
        toast("Fetch failed", "warn", message);
      }
    },
    [mode, keyword, region, links, count, cursor, settings, toast, runEnrichment, refreshPosts],
  );

  /* ── save / status / delete ──────────────────────────────────── */
  const saveClip = useCallback(
    async (video: TikTokVideo, variant?: CaptionVariant, note = "") => {
      const chosen = variant ?? buildVariants(video, settings, 0)[0];
      try {
        const res = await fetch("/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video,
            caption: chosen.text,
            captionStyle: chosen.style,
            note,
            status: savedByTiktokId[video.id]?.status ?? "queued",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "save failed");
        await refreshPosts(true);
        toast(`@${video.authorUsername} queued`, "ok", `${chosen.label} · ${chosen.length} chars`);
      } catch (err) {
        toast("Could not save the clip", "warn", err instanceof Error ? err.message : undefined);
      }
    },
    [settings, savedByTiktokId, toast, refreshPosts],
  );

  const changeStatus = useCallback(
    async (post: SavedPost, status: string) => {
      setPosts((prev) => prev.map((item) => (item.id === post.id ? { ...item, status } : item)));
      try {
        await fetch(`/api/posts/${post.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        await refreshPosts(true);
      } catch {
        toast("Status not persisted", "warn");
      }
    },
    [toast, refreshPosts],
  );

  const deletePost = useCallback(
    async (post: SavedPost) => {
      setPosts((prev) => prev.filter((item) => item.id !== post.id));
      try {
        await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
        await refreshPosts(true);
        toast("Clip dropped from the queue", "info", `@${post.authorUsername}`);
      } catch {
        toast("Delete failed", "warn");
      }
    },
    [toast, refreshPosts],
  );

  const clearQueue = useCallback(async () => {
    if (!posts.length) return;
    try {
      await fetch("/api/posts?all=1", { method: "DELETE" });
      setPosts([]);
      setTally({});
      toast("Queue cleared", "info", "Every saved clip and caption log was removed");
    } catch {
      toast("Could not clear the queue", "warn");
    }
  }, [posts.length, toast]);

  const reroll = useCallback(() => {
    if (!activeVideo) return;
    const id = activeVideo.id;
    setSeedMap((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  }, [activeVideo]);

  const openPublish = useCallback(
    (target: PublishTarget) => {
      setPublishTarget(target);
      setTab("publish");
    },
    [],
  );

  const resolvedCount = results.filter((video) => video.hdPlayUrl).length;
  const pipeline = [
    { label: "Found", value: formatCount(results.length), hint: `search “${keyword}”` },
    {
      label: "Files ready",
      value: `${resolvedCount}/${results.length || 0}`,
      hint: state.resolving ? `resolving ${state.resolving} more` : "watermark-free mp4",
    },
    { label: "Queue", value: formatCount(posts.length), hint: `${tally.queued ?? 0} waiting` },
    {
      label: "Credit",
      value: settings.creditPrefix || "cr:",
      hint: `${settings.creditMode} · ${settings.creditPlacement}`,
    },
  ];

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 grid-lines opacity-40" aria-hidden="true" />

      <HeaderBar
        tab={tab}
        setTab={setTab}
        health={health}
        onPing={ping}
        pinging={pinging}
        results={results}
        posts={posts}
      />

      <main className="relative mx-auto max-w-[1560px] px-4 py-6 lg:px-7">
        {tab === "desk" ? (
          <div className="grid gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-[132px] lg:self-start">
              <SourcePanel
                mode={mode}
                setMode={setMode}
                region={region}
                setRegion={setRegion}
                keyword={keyword}
                setKeyword={setKeyword}
                links={links}
                setLinks={setLinks}
                count={count}
                setCount={setCount}
                state={state}
                hasMore={hasMore}
                settings={settings}
                onFetch={() => void runFetch(false)}
                onLoadMore={() => void runFetch(true)}
                onGotoRecipe={() => setTab("recipe")}
              />
            </div>

            <div className="min-w-0">
              <Reveal className="relative mb-4 border border-line bg-panel/50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-y-3">
                  {pipeline.map((step, index) => (
                    <div key={step.label} className="flex min-w-[128px] flex-1 items-center gap-3">
                      <div className="min-w-0">
                        <p className="mono-num text-[9.5px] tracking-[0.22em] text-dim uppercase">
                          0{index + 1} · {step.label}
                        </p>
                        <p className="font-display truncate text-[19px] leading-tight font-bold text-text">
                          {step.value}
                        </p>
                        <p className="truncate text-[10.5px] text-dim">{step.hint}</p>
                      </div>
                      {index < pipeline.length - 1 ? (
                        <span className="mono-num hidden flex-1 text-center text-line2 lg:block">
                          ───▶
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Reveal>

              {state.error ? (
                <div className="mb-4 flex items-start gap-3 border border-flare/40 bg-flare/[0.07] px-4 py-3">
                  <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-flare" />
                  <div>
                    <p className="text-[13px] font-semibold text-flare">{state.error}</p>
                    <p className="mt-1 text-[11.5px] leading-snug text-muted">
                      Try a different spelling of the tag, another region, or paste the exact TikTok
                      links with Link Grab.
                    </p>
                  </div>
                </div>
              ) : null}

              {results.length === 0 ? (
                <IdleDesk
                  keyword={keyword}
                  onSearch={() => void runFetch(false, { mode: "search" })}
                  onLink={() => setMode("link")}
                  onFirehose={() => {
                    setMode("firehose");
                    void runFetch(false, { mode: "firehose" });
                  }}
                  busy={state.loading}
                  health={health}
                />
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-line pb-2.5">
                    <div>
                      <h2 className="font-display text-[20px] leading-none font-bold tracking-[0.04em] text-text uppercase">
                        {mode === "link"
                          ? "Grabbed clips"
                          : mode === "firehose"
                            ? `Firehose · ${region}`
                            : `TikTok search · ${keyword}`}
                      </h2>
                      <p className="mono-num mt-1.5 text-[10.5px] tracking-[0.14em] text-dim uppercase">
                        {results.length} clips · original caption + your repost caption ·{" "}
                        {state.resolving
                          ? `resolving ${state.resolving} file${state.resolving === 1 ? "" : "s"}`
                          : `${resolvedCount} files ready`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        onClick={async () => {
                          const payload = results
                            .map((video) => {
                              const variant =
                                variantMap[video.id]?.[0] ?? buildVariants(video, settings, 0)[0];
                              return `── cr: @${video.authorUsername} ──\n${variant.text}\n${video.shareUrl}`;
                            })
                            .join("\n\n");
                          try {
                            await navigator.clipboard.writeText(payload);
                            toast(`${results.length} captions copied`, "ok");
                          } catch {
                            toast("Clipboard blocked", "warn");
                          }
                        }}
                      >
                        Copy every caption
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void runFetch(false)}>
                        <IconRadar className="h-3.5 w-3.5" />
                        Re-run
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {results.map((video, index) => (
                      <ClipCard
                        key={video.id}
                        video={video}
                        variant={variantsFor(video)[0]}
                        saved={Boolean(savedByTiktokId[video.id])}
                        featured={index === 0 && results.length > 2}
                        resolving={!video.hdPlayUrl && Boolean(state.resolving)}
                        onOpen={() => setActiveId(video.id)}
                        onSave={() => void saveClip(video)}
                        onPublish={() => openPublish({ kind: "video", id: video.id })}
                      />
                    ))}
                  </div>

                  {state.loading || state.appending ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {[0, 1, 2].map((index) => (
                        <div key={index} className="shimmer h-[380px] border border-line" />
                      ))}
                    </div>
                  ) : null}

                  {hasMore ? (
                    <div className="mt-4 flex justify-center">
                      <Button size="lg" onClick={() => void runFetch(true)} disabled={state.appending}>
                        Load the next page
                        <IconArrow className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}

        {tab === "queue" ? (
          <LibraryPanel
            posts={posts}
            tally={tally}
            settings={settings}
            loading={loadingPosts}
            onStatus={changeStatus}
            onDelete={deletePost}
            onClear={clearQueue}
            onRefresh={() => void refreshPosts()}
            onPublish={(post) => openPublish({ kind: "post", id: post.id })}
          />
        ) : null}

        {tab === "publish" ? (
          <PublishPanel
            posts={posts}
            deskVideos={results}
            settings={settings}
            target={publishTarget}
            onClearTarget={() => setPublishTarget(null)}
            onPublished={() => void refreshPosts(true)}
            flash={flash}
          />
        ) : null}

        {tab === "recipe" ? (
          <RecipePanel
            settings={settings}
            sample={results[0] ?? SAMPLE_VIDEO}
            onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
            onReset={() => {
              setSettings({ ...DEFAULT_SETTINGS, defaultRegion: settings.defaultRegion });
              toast("Recipe reset to defaults", "info");
            }}
            saving={savingSettings}
            savedAt={savedAt}
          />
        ) : null}

        <footer className="mono-num mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-[10.5px] tracking-[0.14em] text-dim uppercase">
          <span>repost desk · tiktok search · caption writer · publisher</span>
          <span>sources: tiktok.com tag pages + tikwm</span>
          <span>credit every creator you repost</span>
          <span className="ml-auto flex items-center gap-1.5">
            <IconSpark className="h-3.5 w-3.5 text-signal" />
            {settings.handle ? `posting as @${settings.handle}` : "set your handle in the recipe"}
          </span>
        </footer>
      </main>

      <ClipDrawer
        video={activeVideo}
        settings={settings}
        variants={activeVariants}
        seed={activeSeed}
        saved={activeVideo ? (savedByTiktokId[activeVideo.id] ?? null) : null}
        onReroll={reroll}
        onSave={(variant) => activeVideo && void saveClip(activeVideo, variant)}
        onPublish={(variant) => {
          if (!activeVideo) return;
          void saveClip(activeVideo, variant);
          setActiveId(null);
          openPublish({ kind: "video", id: activeVideo.id });
        }}
        onResolve={() => void runEnrichment(activeVideo ? [activeVideo] : [])}
        onClose={() => setActiveId(null)}
      />
    </div>
  );
}

function IdleDesk({
  keyword,
  onSearch,
  onLink,
  onFirehose,
  busy,
  health,
}: {
  keyword: string;
  onSearch: () => void;
  onLink: () => void;
  onFirehose: () => void;
  busy: boolean;
  health: { ok: boolean; latencyMs: number; detail: string } | null;
}) {
  return (
    <Reveal className="relative overflow-hidden border border-line bg-panel/50">
      <div className="pointer-events-none absolute inset-0 grid-lines opacity-70" />
      <div className="relative grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:p-8">
        <div>
          <p className="mono-num text-[10px] tracking-[0.26em] text-flare uppercase">
            desk idle · awaiting search
          </p>
          <h2 className="font-display mt-2 max-w-xl text-[34px] leading-[0.98] font-bold tracking-[0.01em] text-text uppercase sm:text-[44px]">
            Search TikTok.
            <br />
            <span className="text-signal">Keep the caption.</span>
            <br />
            Post it back.
          </h2>
          <p className="mt-4 max-w-xl text-[13.5px] leading-relaxed text-muted">
            Type what you want — <span className="text-text">relatable</span>,{" "}
            <span className="text-text">work memes</span>,{" "}
            <span className="text-text">#gym</span> — and the desk reads TikTok's public tag pages
            to pull the clips actually ranked there, with their real captions, creators and stats.
            It then writes your repost caption with{" "}
            <span className="text-signal">cr: @creator</span> credit, and can publish the clip
            straight back to your TikTok account.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="lg" variant="primary" onClick={onSearch} disabled={busy}>
              <IconScan className="h-4 w-4" />
              Search “{keyword}”
            </Button>
            <Button size="lg" onClick={onLink} disabled={busy}>
              <IconLink className="h-4 w-4" />
              Paste links instead
            </Button>
            <Button size="lg" variant="ghost" onClick={onFirehose} disabled={busy}>
              <IconRadar className="h-4 w-4" />
              Trending firehose
            </Button>
          </div>

          <p className="mono-num mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] tracking-[0.12em] text-dim uppercase">
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  health ? (health.ok ? "bg-signal blip" : "bg-flare") : "bg-dim"
                }`}
              />
              {health
                ? health.ok
                  ? `media source live · ${health.latencyMs}ms`
                  : `media source degraded · ${health.detail}`
                : "probing source…"}
            </span>
            <span>watermark-free mp4</span>
            <span>direct post + drafts</span>
            <span>queue export txt/csv/json</span>
          </p>
        </div>

        <div className="relative border border-line2/70 bg-pit/70 p-4">
          <p className="mono-num text-[9.5px] tracking-[0.22em] text-dim uppercase">
            what a finished caption looks like
          </p>
          <div className="mt-3 border-l-2 border-signal/70 bg-signal/[0.05] px-3 py-3">
            <p className="text-[13px] leading-relaxed whitespace-pre-line text-text">
              {
                "why is this literally me 💀\n\nwhen i walk into school but then realize this is tiring so i tell myself i gotta make it to friday\n\ncr: @lonerbars5\n\n#relatable #school #fyp"
              }
            </p>
          </div>
          <ul className="mono-num mt-4 flex flex-col gap-2 text-[10.5px] tracking-[0.1em] text-dim uppercase">
            <li className="flex items-center gap-2">
              <IconArrow className="h-3.5 w-3.5 text-signal" /> hook line you can reroll
            </li>
            <li className="flex items-center gap-2">
              <IconArrow className="h-3.5 w-3.5 text-signal" /> creator's caption, cleaned
            </li>
            <li className="flex items-center gap-2">
              <IconArrow className="h-3.5 w-3.5 text-signal" /> your credit prefix + handle
            </li>
            <li className="flex items-center gap-2">
              <IconUpload className="h-3.5 w-3.5 text-acid" /> post it from this tab
            </li>
          </ul>
        </div>
      </div>
    </Reveal>
  );
}
