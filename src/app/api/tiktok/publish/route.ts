import { NextResponse } from "next/server";
import { desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/init";
import { posts, publishJobs } from "@/db/schema";
import { postToVideo, toPublishJob } from "@/lib/mappers";
import {
  fetchPublishStatus,
  getAccessToken,
  publishVideo,
  resolveClipBytes,
  PublishError,
  TITLE_LIMIT,
  REQUIRED_SCOPES,
} from "@/lib/publish";
import {
  describeSession,
  getSession,
  probeUploader,
  uploadWithSession,
  uploaderConfig,
  SessionPublishError,
} from "@/lib/session-publish";
import { makeVideo } from "@/lib/video-factory";
import type {
  PrivacyLevel,
  PublishBackend,
  PublishMode,
  TikTokVideo,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Cookie uploads only know these three audiences. */
function visibilityFromPrivacy(level: PrivacyLevel): "everyone" | "friends" | "only_you" {
  if (level === "SELF_ONLY") return "only_you";
  if (level === "MUTUAL_FOLLOW_FRIENDS") return "friends";
  return "everyone";
}

/** GET → publish history for this desk. */
export async function GET(request: Request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 20) || 20);
    const rows = await db
      .select()
      .from(publishJobs)
      .orderBy(desc(publishJobs.createdAt))
      .limit(limit);
    return NextResponse.json({ jobs: rows.map(toPublishJob) });
  } catch (err) {
    return NextResponse.json(
      { jobs: [], error: err instanceof Error ? err.message : "db error" },
      { status: 200 },
    );
  }
}

/** POST → publish a queued clip, a desk clip, or a file uploaded from disk. */
export async function POST(request: Request) {
  await ensureSchema();

  let caption = "";
  let privacyLevel: PrivacyLevel = "SELF_ONLY";
  let mode: PublishMode = "DIRECT_POST";
  let disableComment = false;
  let disableDuet = false;
  let disableStitch = false;
  let coverTimestampMs = 1000;
  let postId: string | null = null;
  let videoPayload: TikTokVideo | null = null;
  let fileName: string | null = null;
  let bytes: Buffer | null = null;
  let backendRequested: PublishBackend = "auto";

  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (file instanceof File) {
        bytes = Buffer.from(await file.arrayBuffer());
        fileName = file.name || "upload.mp4";
      }
      caption = String(form.get("caption") ?? "");
      privacyLevel = String(form.get("privacyLevel") ?? "SELF_ONLY") as PrivacyLevel;
      mode = String(form.get("mode") ?? "DIRECT_POST") as PublishMode;
      disableComment = form.get("disableComment") === "true";
      disableDuet = form.get("disableDuet") === "true";
      disableStitch = form.get("disableStitch") === "true";
      coverTimestampMs = Number(form.get("coverTimestampMs") ?? 1000) || 0;
      postId = form.get("postId") ? String(form.get("postId")) : null;
      const requested = String(form.get("backend") ?? "auto") as PublishBackend;
      if (requested === "session" || requested === "api") backendRequested = requested;
    } else {
      const body = await request.json();
      caption = String(body.caption ?? "");
      privacyLevel = (body.privacyLevel ?? "SELF_ONLY") as PrivacyLevel;
      mode = (body.mode ?? "DIRECT_POST") as PublishMode;
      disableComment = Boolean(body.disableComment);
      disableDuet = Boolean(body.disableDuet);
      disableStitch = Boolean(body.disableStitch);
      coverTimestampMs = Number(body.coverTimestampMs ?? 1000) || 0;
      postId = body.postId ? String(body.postId) : null;
      if (body.video?.id) videoPayload = makeVideo(body.video);
      if (body.backend === "session" || body.backend === "api") backendRequested = body.backend;
    }
  } catch {
    return NextResponse.json({ error: "Could not read the request body" }, { status: 400 });
  }

  /* ── which backend is going to do this? ───────────────────────── */
  const auth = await getAccessToken();
  const uploader = uploaderConfig();
  const session = await getSession();
  const sessionReady =
    uploader.mode !== "off" && Boolean(session.sessionId || uploader.cookieFile);
  const apiReady = Boolean(auth.token);

  let backend: "session" | "api";
  if (backendRequested === "session") {
    if (!sessionReady) {
      return NextResponse.json(
        {
          error:
            uploader.mode === "off"
              ? "Session uploads are disabled (TIKTOK_UPLOAD_MODE=off)"
              : "No TikTok session stored",
          code: "no_session",
          hint: "Paste your TikTok sessionid on the Publish tab, or set TIKTOK_SESSION_ID.",
        },
        { status: 412 },
      );
    }
    backend = "session";
  } else if (backendRequested === "api") {
    if (!apiReady) {
      return NextResponse.json(
        {
          error: "No Content Posting API token",
          code: "not_connected",
          hint: "Connect with OAuth or paste a TIKTOK_ACCESS_TOKEN, or post through your session instead.",
          scopes: REQUIRED_SCOPES,
        },
        { status: 412 },
      );
    }
    backend = "api";
  } else if (sessionReady) {
    backend = "session";
  } else if (apiReady) {
    backend = "api";
  } else {
    return NextResponse.json(
      {
        error: "No TikTok account connected",
        code: "not_connected",
        hint:
          "Easiest: install tiktok-uploader and paste your sessionid on the Publish tab (no developer account needed).",
        scopes: REQUIRED_SCOPES,
      },
      { status: 412 },
    );
  }

  /* resolve what we are posting */
  let sourceUsername = "";
  let tiktokId = "";
  try {
    if (!bytes) {
      let video: TikTokVideo | null = videoPayload;
      if (!video && postId) {
        const [row] = await db
          .select()
          .from(posts)
          .where(or(eq(posts.id, postId), eq(posts.tiktokId, postId)))
          .limit(1);
        if (!row) throw new PublishError("That clip is no longer in the queue", "not_found");
        video = postToVideo({
          ...row,
          postedAt: row.postedAt ? new Date(row.postedAt).toISOString() : null,
          savedAt: new Date(row.savedAt).toISOString(),
        } as any);
        if (!caption) caption = row.caption;
      }
      if (!video) throw new PublishError("Nothing to post — pick a clip or a file", "no_source");
      const resolved = await resolveClipBytes(video);
      bytes = resolved.bytes;
      fileName = resolved.fileName;
      sourceUsername = video.authorUsername;
      tiktokId = video.id;
      if (!caption) caption = video.caption;
    } else {
      sourceUsername = "local upload";
      fileName = fileName ?? "upload.mp4";
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof PublishError ? err.message : "Could not prepare the video",
        code: err instanceof PublishError ? err.code : "prepare_failed",
        hint: err instanceof PublishError ? err.hint : undefined,
      },
      { status: 422 },
    );
  }

  if (!caption.trim() && mode === "DIRECT_POST") {
    return NextResponse.json(
      { error: "A caption is required for a direct post", code: "empty_caption" },
      { status: 400 },
    );
  }
  caption = caption.slice(0, TITLE_LIMIT);

  /* create the job row, then hand it to the chosen backend */
  const [job] = await db
    .insert(publishJobs)
    .values({
      postId: postId && /^[0-9a-f-]{36}$/i.test(postId) ? postId : null,
      tiktokId,
      sourceUsername,
      caption,
      mode,
      privacyLevel,
      fileName,
      videoSize: bytes.byteLength,
      provider: backend,
      status: "UPLOADING",
    })
    .returning();

  /* ── cookie-session uploader (no developer account) ───────────── */
  if (backend === "session") {
    try {
      const result = await uploadWithSession({
        bytes,
        fileName: fileName ?? "clip.mp4",
        caption,
        visibility: visibilityFromPrivacy(privacyLevel),
        disableComment,
        disableDuet,
        disableStitch,
      });

      await db
        .update(publishJobs)
        .set({
          status: result.status,
          failReason: result.ok ? null : result.message,
          provider: result.provider,
          uploadedBytes: bytes.byteLength,
          updatedAt: new Date(),
        })
        .where(eq(publishJobs.id, job.id));

      if (result.ok && job.postId) {
        await db
          .update(posts)
          .set({ status: "posted", updatedAt: new Date() })
          .where(eq(posts.id, job.postId));
      }

      const [updated] = await db
        .select()
        .from(publishJobs)
        .where(eq(publishJobs.id, job.id))
        .limit(1);

      return NextResponse.json(
        {
          job: toPublishJob(updated),
          published: result.ok,
          draft: false,
          provider: "session",
          message: result.ok
            ? result.message
            : `Your uploader reported a failure: ${result.message}`,
          detail: result.detail,
        },
        { status: result.ok ? 200 : 502 },
      );
    } catch (err) {
      const message =
        err instanceof SessionPublishError
          ? err.message
          : err instanceof Error
            ? err.message
            : "session upload failed";
      await db
        .update(publishJobs)
        .set({ status: "FAILED", failReason: message, updatedAt: new Date() })
        .where(eq(publishJobs.id, job.id));
      return NextResponse.json(
        {
          error: message,
          code: err instanceof SessionPublishError ? err.code : "session_upload_failed",
          hint: err instanceof SessionPublishError ? err.hint : undefined,
          job: toPublishJob({ ...job, status: "FAILED", failReason: message }),
        },
        { status: 502 },
      );
    }
  }

  /* ── official Content Posting API ─────────────────────────────── */
  try {
    const { publishId } = await publishVideo({
      token: auth.token,
      caption,
      privacyLevel,
      mode,
      bytes,
      disableComment,
      disableDuet,
      disableStitch,
      coverTimestampMs,
    });

    await db
      .update(publishJobs)
      .set({ publishId, provider: "api", status: "PROCESSING_UPLOAD", updatedAt: new Date() })
      .where(eq(publishJobs.id, job.id));

    // Poll briefly; long jobs keep going and the UI can re-check.
    let latest: {
      status: string;
      failReason: string | null;
      publicPostIds: string;
      uploadedBytes: number | null;
    } = {
      status: "PROCESSING_UPLOAD",
      failReason: null,
      publicPostIds: "",
      uploadedBytes: bytes.byteLength,
    };
    // Keep the request inside a serverless window; the UI re-checks later.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sleep(3000);
      try {
        latest = await fetchPublishStatus(auth.token, publishId);
      } catch {
        break;
      }
      if (
        latest.status === "PUBLISH_COMPLETE" ||
        latest.status === "FAILED" ||
        latest.status === "SEND_TO_USER_INBOX"
      ) {
        break;
      }
    }

    await db
      .update(publishJobs)
      .set({
        status: latest.status,
        failReason: latest.failReason,
        publicPostIds: latest.publicPostIds,
        uploadedBytes: latest.uploadedBytes ?? bytes.byteLength,
        updatedAt: new Date(),
      })
      .where(eq(publishJobs.id, job.id));

    if (latest.status === "PUBLISH_COMPLETE" && job.postId) {
      await db
        .update(posts)
        .set({ status: "posted", updatedAt: new Date() })
        .where(eq(posts.id, job.postId));
    }

    const [updated] = await db
      .select()
      .from(publishJobs)
      .where(eq(publishJobs.id, job.id))
      .limit(1);

    return NextResponse.json({
      job: toPublishJob(updated),
      published: latest.status === "PUBLISH_COMPLETE",
      draft: latest.status === "SEND_TO_USER_INBOX",
      provider: "api",
      message:
        latest.status === "PUBLISH_COMPLETE"
          ? "Posted to TikTok."
          : latest.status === "SEND_TO_USER_INBOX"
            ? "Sent to your TikTok inbox as a draft — finish it in the app."
            : latest.status === "FAILED"
              ? `TikTok rejected the post: ${latest.failReason ?? "unknown reason"}`
              : "Upload finished, TikTok is still processing.",
    });
  } catch (err) {
    const message =
      err instanceof PublishError ? err.message : err instanceof Error ? err.message : "publish failed";
    const code = err instanceof PublishError ? err.code : "publish_failed";
    await db
      .update(publishJobs)
      .set({ status: "FAILED", failReason: message, updatedAt: new Date() })
      .where(eq(publishJobs.id, job.id));
    return NextResponse.json(
      {
        error: message,
        code,
        hint: err instanceof PublishError ? err.hint : undefined,
        job: toPublishJob({ ...job, status: "FAILED", failReason: message }),
      },
      { status: 502 },
    );
  }
}
