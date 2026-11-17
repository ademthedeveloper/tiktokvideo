import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/init";
import { posts, publishJobs } from "@/db/schema";
import { toPublishJob } from "@/lib/mappers";
import { fetchPublishStatus, getAccessToken, PublishError } from "@/lib/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Re-check a publish job against TikTok and persist the result. */
export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = await request.json();
    const jobId = String(body.jobId ?? "");
    const auth = await getAccessToken();
    if (!auth.token) {
      return NextResponse.json({ error: "No TikTok account connected" }, { status: 412 });
    }

    const [job] = await db
      .select()
      .from(publishJobs)
      .where(eq(publishJobs.id, jobId))
      .limit(1);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (!job.publishId) {
      return NextResponse.json({ job: toPublishJob(job), status: job.status });
    }

    const latest = await fetchPublishStatus(auth.token, job.publishId);
    await db
      .update(publishJobs)
      .set({
        status: latest.status,
        failReason: latest.failReason,
        publicPostIds: latest.publicPostIds || job.publicPostIds,
        uploadedBytes: latest.uploadedBytes ?? job.uploadedBytes,
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
    return NextResponse.json({ job: toPublishJob(updated), status: latest.status });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof PublishError ? err.message : err instanceof Error ? err.message : "status check failed",
        hint: err instanceof PublishError ? err.hint : undefined,
      },
      { status: 502 },
    );
  }
}
