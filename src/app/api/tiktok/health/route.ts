import { NextResponse } from "next/server";
import { pingUpstream } from "@/lib/tiktok";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await pingUpstream();
  return NextResponse.json(status);
}
