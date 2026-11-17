import { NextResponse } from "next/server";
import { describeProviders } from "@/lib/tiktok";
import { describeSession, probeUploader } from "@/lib/session-publish";
import { tikwmConfiguredBase } from "@/lib/providers/tikwm";
import { proxyUrl } from "@/lib/providers/net";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * GET → live health sweep of every fetch/post provider.
 * This is the answer to "why did nothing come back?".
 */
export async function GET() {
  const [checks, uploader, session] = await Promise.all([
    describeProviders().catch((err) => [
      {
        id: "providers",
        label: "provider sweep",
        ok: false,
        latencyMs: 0,
        detail: err instanceof Error ? err.message : "sweep failed",
      },
    ]),
    probeUploader(),
    describeSession().catch(() => null),
  ]);

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    checks,
    uploader,
    posting: {
      backend: session?.uploader.mode ?? "cli",
      sessionConnected: Boolean(session?.connected),
      sessionVerified: Boolean(session?.verified),
      tikwmBase: tikwmConfiguredBase(),
      cookieConfigured: Boolean(process.env.TIKTOK_COOKIE),
      egressProxy: proxyUrl(),
    },
  });
}
