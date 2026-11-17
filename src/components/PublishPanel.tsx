"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PrivacyLevel,
  PublishBackend,
  PublishJob,
  PublishMode,
  SavedPost,
  SessionStatus,
  Settings,
  TikTokAccount,
  TikTokVideo,
} from "@/lib/types";
import { formatAgo } from "@/lib/captions";
import { postToVideo } from "@/lib/mappers";
import { proxiedMedia } from "@/lib/tiktok-client";
import { Button, Chip, Field, Reveal, Spinner, Toggle, inputClass, useToast } from "./ui";
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconClose,
  IconExternal,
  IconRefresh,
  IconUpload,
  IconUser,
} from "./icons";

const SESSION_STEPS = [
  "Install the uploader once: pip install tiktok-uploader && playwright install chromium",
  "Log in to tiktok.com in your own browser and open DevTools → Application → Cookies → .tiktok.com",
  "Copy the sessionid value and paste it above (or set TIKTOK_SESSION_ID in the environment)",
  "Point TIKTOK_UPLOADER_CMD at your own tool if you use a different one — {file}, {caption} and {cookies} are substituted",
];

const PRIVACY: { id: PrivacyLevel; label: string; blurb: string }[] = [
  { id: "PUBLIC_TO_EVERYONE", label: "Public", blurb: "Everyone. Needs an audited app." },
  { id: "FOLLOWER_OF_CREATOR", label: "Followers", blurb: "Only your followers." },
  { id: "MUTUAL_FOLLOW_FRIENDS", label: "Mutuals", blurb: "Friends who follow each other." },
  { id: "SELF_ONLY", label: "Only me", blurb: "Private — allowed before the audit." },
];

export type PublishTarget =
  | { kind: "post"; id: string }
  | { kind: "video"; id: string }
  | null;

type Source =
  | { kind: "queue"; post: SavedPost }
  | { kind: "desk"; video: TikTokVideo }
  | { kind: "file"; file: File }
  | null;

function statusTone(status: string) {
  if (status === "PUBLISH_COMPLETE") return "border-acid/60 bg-acid/14 text-acid";
  if (status === "SEND_TO_USER_INBOX") return "border-signal/60 bg-signal/14 text-signal";
  if (status === "FAILED") return "border-flare/60 bg-flare/14 text-flare";
  return "border-line2 bg-white/[0.04] text-muted";
}

export function PublishPanel({
  posts,
  deskVideos,
  settings,
  target,
  onClearTarget,
  onPublished,
  flash,
}: {
  posts: SavedPost[];
  deskVideos: TikTokVideo[];
  settings: Settings;
  target: PublishTarget;
  onClearTarget: () => void;
  onPublished: () => void;
  flash: { kind: string; text: string } | null;
}) {
  const toast = useToast();
  const [account, setAccount] = useState<TikTokAccount | null>(null);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [source, setSource] = useState<Source>(null);
  const [caption, setCaption] = useState("");
  const [privacyLevel, setPrivacyLevel] = useState<PrivacyLevel>("SELF_ONLY");
  const [mode, setMode] = useState<PublishMode>("DIRECT_POST");
  const [disableComment, setDisableComment] = useState(false);
  const [disableDuet, setDisableDuet] = useState(false);
  const [disableStitch, setDisableStitch] = useState(false);
  const [coverMs, setCoverMs] = useState(1000);
  const [manualToken, setManualToken] = useState("");
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [sessionInput, setSessionInput] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [showSessionHelp, setShowSessionHelp] = useState(false);
  const [backend, setBackend] = useState<PublishBackend>("auto");
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; detail?: string } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── load account + jobs ─────────────────────────────────────── */
  const loadAccount = useCallback(async () => {
    setLoadingAccount(true);
    try {
      const res = await fetch("/api/tiktok/account", { cache: "no-store" });
      const data = await res.json();
      if (data.account) {
        setAccount(data.account);
        if (Array.isArray(data.account.privacyLevels) && data.account.privacyLevels.length) {
          setPrivacyLevel((current) =>
            data.account.privacyLevels.includes(current)
              ? current
              : (data.account.privacyLevels[0] as PrivacyLevel),
          );
        }
      }
    } catch {
      setAccount(null);
    } finally {
      setLoadingAccount(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch("/api/tiktok/session", { cache: "no-store" });
      const data = await res.json();
      if (data.session) setSession(data.session);
    } catch {
      /* the session path is optional */
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/tiktok/publish", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadAccount();
    void loadJobs();
    void loadSession();
  }, [loadAccount, loadJobs, loadSession]);

  const saveSessionId = async () => {
    if (!sessionInput.trim()) return;
    setSavingSession(true);
    try {
      const res = await fetch("/api/tiktok/session", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "session rejected");
      setSessionInput("");
      setSession(data.session ?? null);
      toast(
        data.session?.verified ? "TikTok session linked" : "Session saved",
        "ok",
        data.message ?? undefined,
      );
      await loadSession();
    } catch (err) {
      toast("Could not store the session", "warn", err instanceof Error ? err.message : undefined);
    } finally {
      setSavingSession(false);
    }
  };

  const forgetSession = async () => {
    try {
      await fetch("/api/tiktok/session", { method: "DELETE" });
      setSession(null);
      await loadSession();
      toast("TikTok session removed", "info");
    } catch {
      toast("Could not clear the session", "warn");
    }
  };

  /* keep unfinished jobs ticking */
  useEffect(() => {
    const pending = jobs.filter(
      (job) =>
        job.publishId &&
        !["PUBLISH_COMPLETE", "FAILED", "SEND_TO_USER_INBOX"].includes(job.status),
    );
    if (!pending.length) {
      if (pollTimer.current) clearInterval(pollTimer.current);
      return;
    }
    if (pollTimer.current) return;
    pollTimer.current = setInterval(async () => {
      const stillPending = jobs.filter(
        (job) =>
          job.publishId &&
          !["PUBLISH_COMPLETE", "FAILED", "SEND_TO_USER_INBOX"].includes(job.status),
      );
      if (!stillPending.length && pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
        return;
      }
      for (const job of stillPending.slice(0, 3)) {
        try {
          const res = await fetch("/api/tiktok/publish/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: job.id }),
          });
          const data = await res.json();
          if (data.job) {
            setJobs((prev) => prev.map((item) => (item.id === data.job.id ? data.job : item)));
            if (data.job.status === "PUBLISH_COMPLETE") {
              toast("Posted to TikTok", "ok", `@${job.authorUsername || "your account"}`);
              onPublished();
            } else if (data.job.status === "FAILED") {
              toast("TikTok rejected the post", "warn", data.job.failReason ?? undefined);
            }
          }
        } catch {
          /* keep polling */
        }
      }
    }, 6000);
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [jobs, toast, onPublished]);

  /* ── pick a source from the queue / desk / target ─────────────── */
  const applySource = useCallback(
    (next: Source) => {
      setSource(next);
      setResult(null);
      if (next?.kind === "queue") setCaption(next.post.caption || next.post.originalCaption);
      else if (next?.kind === "desk") setCaption(next.video.caption);
      else if (next?.kind === "file") setCaption((current) => current);
    },
    [],
  );

  useEffect(() => {
    if (!target) return;
    if (target.kind === "post") {
      const post = posts.find((item) => item.id === target.id || item.tiktokId === target.id);
      if (post) applySource({ kind: "queue", post });
    } else {
      const video = deskVideos.find((item) => item.id === target.id);
      if (video) applySource({ kind: "desk", video });
    }
    onClearTarget();
  }, [target, posts, deskVideos, applySource, onClearTarget]);

  const sourceLabel = useMemo(() => {
    if (!source) return null;
    if (source.kind === "queue")
      return `queue · @${source.post.authorUsername} · ${source.post.tiktokId}`;
    if (source.kind === "desk")
      return `desk · @${source.video.authorUsername} · ${source.video.id}`;
    return `file · ${source.file.name} · ${(source.file.size / 1_048_576).toFixed(1)} MB`;
  }, [source]);

  const previewVideo = useMemo(() => {
    if (source?.kind === "queue") return proxiedMedia(source.post.hdPlayUrl ?? source.post.playUrl);
    if (source?.kind === "desk")
      return proxiedMedia(source.video.hdPlayUrl ?? source.video.playUrl ?? source.video.ttPlayUrl);
    if (source?.kind === "file") return URL.createObjectURL(source.file);
    return "";
  }, [source]);

  useEffect(
    () => () => {
      if (source?.kind === "file") URL.revokeObjectURL(previewVideo);
    },
    [source, previewVideo],
  );

  /* ── actions ─────────────────────────────────────────────────── */
  const connect = async () => {
    try {
      const res = await fetch("/api/tiktok/auth", { cache: "no-store" });
      const data = await res.json();
      if (data.authorizeUrl) {
        window.location.href = data.authorizeUrl;
        return;
      }
      setShowTokenForm(true);
      toast("OAuth app not configured", "warn", data.error ?? "Paste a token instead");
    } catch {
      toast("Could not build the authorize link", "warn");
    }
  };

  const pasteToken = async () => {
    if (!manualToken.trim()) return;
    try {
      const res = await fetch("/api/tiktok/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: manualToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "token rejected");
      setManualToken("");
      setShowTokenForm(false);
      toast("Token stored", "ok", "You can post now");
      await loadAccount();
    } catch (err) {
      toast("Token not accepted", "warn", err instanceof Error ? err.message : undefined);
    }
  };

  const disconnect = async () => {
    try {
      await fetch("/api/tiktok/account", { method: "DELETE" });
      setAccount(null);
      await loadAccount();
      toast("TikTok account disconnected", "info");
    } catch {
      toast("Disconnect failed", "warn");
    }
  };

  const publish = async () => {
    if (!source) {
      toast("Pick a clip or a file first", "warn");
      return;
    }
    if (mode === "DIRECT_POST" && !caption.trim()) {
      toast("A caption is required for a direct post", "warn");
      return;
    }
    setPublishing(true);
    setResult(null);
    try {
      let res: Response;
      if (source.kind === "file") {
        const form = new FormData();
        form.set("file", source.file);
        form.set("caption", caption);
        form.set("privacyLevel", privacyLevel);
        form.set("mode", mode);
        form.set("disableComment", String(disableComment));
        form.set("disableDuet", String(disableDuet));
        form.set("disableStitch", String(disableStitch));
        form.set("coverTimestampMs", String(coverMs));
        form.set("backend", backend);
        res = await fetch("/api/tiktok/publish", { method: "POST", body: form });
      } else {
        res = await fetch("/api/tiktok/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            postId: source.kind === "queue" ? source.post.id : undefined,
            video: source.kind === "desk" ? source.video : undefined,
            caption,
            privacyLevel,
            mode,
            disableComment,
            disableDuet,
            disableStitch,
            coverTimestampMs: coverMs,
            backend,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          `${data.error ?? "publish failed"}${data.hint ? ` — ${data.hint}` : ""}`,
        );
      }
      setResult({
        ok: data.published || data.draft,
        text: data.message ?? (data.published ? "Posted to TikTok." : "Upload sent."),
        detail: data.job?.publishId ? `publish_id ${data.job.publishId}` : undefined,
      });
      if (data.published) {
        toast("Posted to TikTok", "ok", caption.slice(0, 60));
        onPublished();
      } else if (data.draft) {
        toast("Draft sent to your TikTok inbox", "ok", "Finish it in the app");
      } else {
        toast("Sent to TikTok", "info", "Still processing — the job list tracks it");
      }
      await loadJobs();
    } catch (err) {
      const message = err instanceof Error ? err.message : "publish failed";
      setResult({ ok: false, text: message });
      toast("Publish failed", "warn", message.slice(0, 140));
    } finally {
      setPublishing(false);
    }
  };

  const apiConnected = Boolean(account?.connected);
  const sessionConnected = Boolean(session?.connected);
  const connected = apiConnected || sessionConnected;
  const uploaderOff = session?.uploader.mode === "off";
  const effectiveBackend: "session" | "api" =
    backend === "auto" ? (sessionConnected ? "session" : "api") : backend;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Reveal className="border-b border-line pb-3">
          <p className="mono-num text-[10px] tracking-[0.24em] text-dim uppercase">
            publish desk
          </p>
          <h2 className="font-display text-[26px] leading-none font-bold tracking-[0.04em] text-text uppercase">
            Post it to TikTok
          </h2>
          <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">
            Send a queued clip, a search result, or a file from your disk straight to your TikTok —
            through your logged-in session (no developer account) or the official Content Posting
            API, with caption, credit line, privacy level and all.
          </p>
        </Reveal>

        {flash ? (
          <div
            className={`flex items-start gap-2 border px-3 py-2.5 ${
              flash.kind === "connected"
                ? "border-acid/50 bg-acid/10 text-acid"
                : "border-flare/45 bg-flare/[0.08] text-flare"
            }`}
          >
            {flash.kind === "connected" ? (
              <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <p className="text-[12px] leading-snug">{flash.text}</p>
          </div>
        ) : null}

        {/* account */}
        <section className="border border-line bg-panel/60 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`flex h-10 w-10 items-center justify-center border ${
                connected ? "border-acid/50 bg-acid/12 text-acid" : "border-line2 text-dim"
              }`}
            >
              <IconUser className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[13px] font-bold tracking-[0.1em] text-text uppercase">
                {loadingAccount && !session
                  ? "Checking account…"
                  : apiConnected
                    ? (account?.displayName ?? account?.username ?? "TikTok account connected")
                    : sessionConnected
                      ? `@${session?.username ?? "your account"} · session`
                      : "No TikTok account connected"}
              </p>
              <p className="mono-num mt-0.5 text-[10.5px] tracking-[0.1em] text-dim uppercase">
                {apiConnected
                  ? `api · ${account?.source === "env" ? "env token" : "oauth"} · scopes ${
                      account?.scopes?.length ? account.scopes.join(", ") : "assumed"
                    }${account?.expiresAt ? ` · expires ${formatAgo(account.expiresAt)}` : ""}`
                  : sessionConnected
                    ? `session cookie · ${session?.verified ? "verified" : "unverified"} · ${
                        session?.uploader.mode === "off" ? "uploads disabled" : session?.uploader.mode
                      }`
                    : (account?.note ?? "Link a session cookie below — no developer account needed")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                onClick={() => {
                  void loadAccount();
                  void loadSession();
                }}
                title="Re-check connection"
              >
                <IconRefresh className={`h-3.5 w-3.5 ${loadingAccount ? "animate-spin" : ""}`} />
              </Button>
              {apiConnected ? (
                <Button size="sm" variant="danger" onClick={disconnect}>
                  Disconnect
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={connect}>
                  <IconExternal className="h-3.5 w-3.5" />
                  Connect TikTok
                </Button>
              )}
            </div>
          </div>

          {apiConnected && account?.privacyLevels?.length ? (
            <div className="mono-num mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3 text-[10px] tracking-[0.12em] text-dim uppercase">
              <span>allowed privacy levels:</span>
              {account.privacyLevels.map((level) => (
                <span key={level} className="border border-line2 px-1.5 py-0.5 text-acid">
                  {level.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          ) : null}

          {/* session (no developer account) card */}
          <div className="mt-3 border border-line bg-pit/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="mono-num text-[10px] tracking-[0.2em] text-signal uppercase">
                no developer account? link your session
              </p>
              <span
                className={`mono-num border px-1.5 py-0.5 text-[9.5px] tracking-[0.12em] uppercase ${
                  sessionConnected
                    ? "border-acid/50 bg-acid/10 text-acid"
                    : "border-line2 text-dim"
                }`}
              >
                {sessionConnected
                  ? session?.verified
                    ? "session verified"
                    : "session saved"
                  : "no session"}
              </span>
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-muted">
              TikTok&apos;s official API needs a developer app plus an app review. Instead the desk
              can drive the MIT-licensed{" "}
              <a
                className="text-signal underline decoration-dotted"
                href="https://github.com/wkaisertexas/tiktok-uploader"
                target="_blank"
                rel="noreferrer"
              >
                tiktok-uploader
              </a>{" "}
              with the <code className="mono-num text-signal">sessionid</code> cookie from your own
              logged-in browser. No app, no client key, no redirect URI.
            </p>

            {sessionConnected ? (
              <div className="mt-2.5 space-y-1.5">
                <p className="mono-num text-[10.5px] text-dim">
                  session {session?.maskedSessionId ?? "from cookie file"}
                  {session?.username ? ` · @${session.username}` : ""}
                  {session?.source === "env" ? " · from env" : ""}
                </p>
                <p className="text-[11px] leading-snug text-muted">
                  {session?.uploader.detail}
                  {uploaderOff ? " Uploads are switched off right now." : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => setShowSessionHelp((value) => !value)}>
                    {showSessionHelp ? "Hide setup" : "Setup / replace"}
                  </Button>
                  {session?.source === "db" ? (
                    <Button size="sm" variant="danger" onClick={forgetSession}>
                      Forget session
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!sessionConnected || showSessionHelp ? (
              <div className="mt-2.5 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <input
                    className={`${inputClass} mono-num min-w-0 flex-1 text-[11.5px]`}
                    value={sessionInput}
                    placeholder="paste sessionid…"
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => setSessionInput(event.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={saveSessionId}
                    disabled={!sessionInput.trim() || savingSession}
                  >
                    {savingSession ? <Spinner className="h-3.5 w-3.5" /> : null}
                    Save session
                  </Button>
                </div>
                <details className="text-[11px] text-muted">
                  <summary className="mono-num cursor-pointer text-[10px] tracking-[0.14em] text-dim uppercase">
                    how to get the cookie
                  </summary>
                  <ol className="mt-1.5 list-decimal space-y-1 pl-4 leading-snug">
                    {(session?.instructions ?? SESSION_STEPS).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </details>
                {!apiConnected ? (
                  <div className="border-t border-line pt-2">
                    <p className="text-[11px] leading-snug text-dim">
                      Prefer the official route?{" "}
                      <button
                        type="button"
                        className="text-signal underline underline-offset-2"
                        onClick={connect}
                      >
                        Connect with OAuth
                      </button>{" "}
                      once you have a developer app, or{" "}
                      <button
                        type="button"
                        className="text-signal underline underline-offset-2"
                        onClick={() => setShowTokenForm((value) => !value)}
                      >
                        paste an access token
                      </button>
                      .
                    </p>
                    {showTokenForm ? (
                      <div className="mt-2 flex gap-1.5">
                        <input
                          className={`${inputClass} mono-num text-[11.5px]`}
                          value={manualToken}
                          placeholder="act.xxxxxxxxxxxxxxxx"
                          spellCheck={false}
                          onChange={(event) => setManualToken(event.target.value)}
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={pasteToken}
                          disabled={!manualToken.trim()}
                        >
                          Store
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        {/* composer */}
        <section className="border border-line bg-panel/60 p-4">
          <h3 className="font-display text-[13px] font-bold tracking-[0.14em] text-text uppercase">
            Composer
          </h3>

          <div className="mt-3 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="relative aspect-[9/14] overflow-hidden border border-line bg-ink">
              {previewVideo ? (
                <video
                  src={previewVideo}
                  controls
                  playsInline
                  muted
                  className="h-full w-full bg-ink object-contain"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                  <IconUpload className="h-6 w-6 text-line2" />
                  <p className="text-[11.5px] leading-snug text-dim">
                    Pick a clip from the queue, a search result, or drop a file.
                  </p>
                </div>
              )}
            </div>

            <div className="min-w-0 space-y-3">
              <div>
                <p className="mono-num text-[9.5px] tracking-[0.2em] text-dim uppercase">
                  posting
                </p>
                <p className="mt-1 truncate text-[12px] text-signal">
                  {sourceLabel ?? "nothing selected"}
                </p>
              </div>

              <Field label="Caption" hint={`${caption.length} / 2200`}>
                <textarea
                  className={`${inputClass} h-32 resize-y text-[12.5px] leading-relaxed`}
                  value={caption}
                  placeholder="your caption with cr: @creator credit and hashtags"
                  onChange={(event) => setCaption(event.target.value.slice(0, 2200))}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Post mode">
                  <div className="flex flex-wrap gap-1.5">
                    <Chip active={mode === "DIRECT_POST"} onClick={() => setMode("DIRECT_POST")}>
                      direct post
                    </Chip>
                    <Chip active={mode === "MEDIA_UPLOAD"} onClick={() => setMode("MEDIA_UPLOAD")}>
                      draft to inbox
                    </Chip>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-dim">
                    {mode === "DIRECT_POST"
                      ? "Publishes straight to your profile with the caption above."
                      : effectiveBackend === "session"
                        ? "Drafts need the official API — a session upload posts straight to your profile."
                        : "Drops the video in your TikTok inbox so you finish it in the app."}
                  </p>
                </Field>
                <Field label="Privacy">
                  <div className="flex flex-wrap gap-1.5">
                    {PRIVACY.map((level) => {
                      const allowed =
                        !account?.privacyLevels?.length ||
                        account.privacyLevels.includes(level.id);
                      return (
                        <Chip
                          key={level.id}
                          active={privacyLevel === level.id}
                          tone={allowed ? "signal" : "neutral"}
                          title={allowed ? level.blurb : `${level.blurb} — not offered to your account`}
                          onClick={() => setPrivacyLevel(level.id)}
                        >
                          {level.label}
                          {allowed ? "" : " •"}
                        </Chip>
                      );
                    })}
                  </div>
                </Field>
              </div>

              {apiConnected && sessionConnected ? (
                <Field label="Post via" hint="session needs no developer app">
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["auto", "auto"],
                        ["session", "session"],
                        ["api", "api"],
                      ] as [PublishBackend, string][]
                    ).map(([value, label]) => (
                      <Chip
                        key={value}
                        active={backend === value}
                        onClick={() => setBackend(value)}
                      >
                        {label}
                      </Chip>
                    ))}
                  </div>
                </Field>
              ) : null}

              <Field label="Cover frame" hint={`${(coverMs / 1000).toFixed(1)}s into the clip`}>
                <input
                  type="range"
                  min={0}
                  max={10000}
                  step={250}
                  value={coverMs}
                  onChange={(event) => setCoverMs(Number(event.target.value))}
                  className="w-full"
                  disabled={mode !== "DIRECT_POST"}
                />
              </Field>

              <div className="grid gap-x-4 sm:grid-cols-3">
                <Toggle
                  checked={disableComment}
                  onChange={setDisableComment}
                  label="Disable comments"
                />
                <Toggle checked={disableDuet} onChange={setDisableDuet} label="Disable duet" />
                <Toggle
                  checked={disableStitch}
                  onChange={setDisableStitch}
                  label="Disable stitch"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <Button variant="primary" size="lg" onClick={publish} disabled={publishing || !source}>
                  {publishing ? <Spinner className="h-4 w-4" /> : <IconUpload className="h-4 w-4" />}
                  {publishing ? "Uploading…" : mode === "DIRECT_POST" ? "Post to TikTok" : "Send draft"}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      applySource({ kind: "file", file });
                      toast(`Loaded ${file.name}`, "info", `${(file.size / 1_048_576).toFixed(1)} MB`);
                    }
                    event.target.value = "";
                  }}
                />
                <Button size="md" onClick={() => fileInput.current?.click()}>
                  Upload a file instead
                </Button>
                {source ? (
                  <Button size="md" variant="ghost" onClick={() => applySource(null)}>
                    <IconClose className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                ) : null}
              </div>

              {result ? (
                <div
                  className={`flex items-start gap-2 border px-3 py-2 ${
                    result.ok
                      ? "border-acid/50 bg-acid/10 text-acid"
                      : "border-flare/45 bg-flare/[0.08] text-flare"
                  }`}
                >
                  {result.ok ? (
                    <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <p className="text-[11.5px] leading-snug">
                    {result.text}
                    {result.detail ? (
                      <span className="mono-num block text-[10px] opacity-80">{result.detail}</span>
                    ) : null}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* jobs */}
        <section className="border border-line bg-panel/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-[13px] font-bold tracking-[0.14em] text-text uppercase">
              Publish log
            </h3>
            <Button size="sm" onClick={loadJobs}>
              <IconRefresh className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
          {jobs.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-[11.5px] text-dim">
              <IconClock className="h-3.5 w-3.5" />
              Nothing posted from this desk yet.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-line bg-pit/50 px-3 py-2"
                >
                  <span
                    className={`mono-num border px-1.5 py-0.5 text-[9.5px] tracking-[0.14em] uppercase ${statusTone(job.status)}`}
                  >
                    {job.status.replace(/_/g, " ")}
                  </span>
                  <span className="mono-num text-[10.5px] text-dim">
                    {job.mode === "DIRECT_POST" ? "direct" : "draft"} ·{" "}
                    {job.privacyLevel.replace(/_/g, " ").toLowerCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
                    {job.caption || "(no caption)"}
                  </span>
                  <span className="mono-num text-[10px] text-dim">
                    {job.videoSize ? `${(job.videoSize / 1_048_576).toFixed(1)} MB` : ""} ·{" "}
                    {formatAgo(job.createdAt)}
                  </span>
                  {job.failReason ? (
                    <span className="w-full text-[11px] text-flare">{job.failReason}</span>
                  ) : null}
                  {job.publicPostIds ? (
                    <a
                      href={`https://www.tiktok.com/@${settings.handle || "me"}/video/${job.publicPostIds.split(",")[0]}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-display flex items-center gap-1 text-[10.5px] tracking-[0.12em] text-signal uppercase"
                    >
                      <IconExternal className="h-3 w-3" />
                      view post
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* source picker rail */}
      <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-[132px] xl:self-start">
        <div className="border border-line bg-panel/50 p-3.5">
          <p className="mono-num text-[9.5px] tracking-[0.22em] text-dim uppercase">
            from the queue · {posts.length}
          </p>
          <div className="scroll-thin mt-2 flex max-h-[34vh] flex-col gap-1.5 overflow-y-auto pr-1">
            {posts.length === 0 ? (
              <p className="text-[11.5px] text-dim">Queue is empty — save clips on the desk.</p>
            ) : (
              posts.map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => applySource({ kind: "queue", post })}
                  className={`group flex items-center gap-2.5 border px-2 py-1.5 text-left transition-colors ${
                    source?.kind === "queue" && source.post.id === post.id
                      ? "border-signal/60 bg-signal/[0.07]"
                      : "border-line bg-pit/40 hover:border-line2"
                  }`}
                >
                  <span className="relative h-11 w-8 shrink-0 overflow-hidden border border-line bg-ink">
                    {post.coverUrl ? (
                      <img
                        src={proxiedMedia(post.coverUrl)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-semibold text-text">
                      @{post.authorUsername}
                    </span>
                    <span className="block truncate text-[10.5px] text-dim">
                      {post.caption.replace(/\s+/g, " ").slice(0, 46)}
                    </span>
                  </span>
                  <span
                    className={`mono-num shrink-0 text-[9px] tracking-[0.12em] uppercase ${
                      post.status === "posted" ? "text-acid" : "text-dim"
                    }`}
                  >
                    {post.status}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="border border-line bg-panel/50 p-3.5">
          <p className="mono-num text-[9.5px] tracking-[0.22em] text-dim uppercase">
            from this search · {deskVideos.length}
          </p>
          <div className="scroll-thin mt-2 flex max-h-[30vh] flex-col gap-1.5 overflow-y-auto pr-1">
            {deskVideos.length === 0 ? (
              <p className="text-[11.5px] text-dim">
                Nothing fetched yet — run a search on the desk tab.
              </p>
            ) : (
              deskVideos.map((video) => (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => applySource({ kind: "desk", video })}
                  className={`group flex items-center gap-2.5 border px-2 py-1.5 text-left transition-colors ${
                    source?.kind === "desk" && source.video.id === video.id
                      ? "border-signal/60 bg-signal/[0.07]"
                      : "border-line bg-pit/40 hover:border-line2"
                  }`}
                >
                  <span className="relative h-11 w-8 shrink-0 overflow-hidden border border-line bg-ink">
                    {video.coverUrl ? (
                      <img
                        src={proxiedMedia(video.coverUrl)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-semibold text-text">
                      @{video.authorUsername}
                    </span>
                    <span className="block truncate text-[10.5px] text-dim">
                      {video.caption.replace(/\s+/g, " ").slice(0, 46) || "(no caption)"}
                    </span>
                  </span>
                  {video.matchedTag ? (
                    <span className="mono-num shrink-0 text-[9px] text-signal">
                      #{video.matchedTag}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="border border-line bg-panel/40 p-3.5">
          <p className="mono-num text-[9.5px] tracking-[0.22em] text-dim uppercase">
            before you post
          </p>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-snug text-muted">
            <li>· Credit the creator — your {settings.creditPrefix || "cr:"} line does that.</li>
            <li>· Unaudited TikTok apps can only post as “Only me” until the audit passes.</li>
            <li>· Direct posts are capped at 2200 characters; the desk trims for you.</li>
            <li>· Drafts land in your TikTok inbox for a final check in the app.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

export { postToVideo };
