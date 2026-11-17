import { NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/init";
import { captionLogs, posts } from "@/db/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    await ensureSchema();
    const { id } = await ctx.params;
    const body = await request.json();

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.caption === "string") set.caption = body.caption.slice(0, 4200);
    if (typeof body.captionStyle === "string") set.captionStyle = body.captionStyle;
    if (typeof body.status === "string") set.status = body.status;
    if (typeof body.note === "string") set.note = body.note.slice(0, 600);

    const [row] = await db
      .update(posts)
      .set(set)
      .where(or(eq(posts.id, id), eq(posts.tiktokId, id)))
      .returning();

    if (!row) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

    if (typeof body.caption === "string" || typeof body.captionStyle === "string") {
      await db.insert(captionLogs).values({
        tiktokId: row.tiktokId,
        authorUsername: row.authorUsername,
        style: row.captionStyle,
        body: row.caption,
        chosen: true,
      });
    }

    return NextResponse.json({ post: row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    await ensureSchema();
    const { id } = await ctx.params;
    const [row] = await db
      .delete(posts)
      .where(or(eq(posts.id, id), eq(posts.tiktokId, id)))
      .returning();
    if (!row) return NextResponse.json({ error: "Clip not found" }, { status: 404 });
    await db.delete(captionLogs).where(eq(captionLogs.tiktokId, row.tiktokId));
    return NextResponse.json({ deleted: row.tiktokId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await ensureSchema();
    const { id } = await ctx.params;
    const [row] = await db
      .select()
      .from(posts)
      .where(or(eq(posts.id, id), eq(posts.tiktokId, id)))
      .limit(1);
    if (!row) return NextResponse.json({ error: "Clip not found" }, { status: 404 });
    const history = await db
      .select()
      .from(captionLogs)
      .where(eq(captionLogs.tiktokId, row.tiktokId))
      .limit(12);
    return NextResponse.json({ post: row, history });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "lookup failed" },
      { status: 500 },
    );
  }
}
