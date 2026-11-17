import { NextResponse } from "next/server";
import {
  describeAccount,
  disconnectAccount,
  storeManualToken,
  PublishError,
} from "@/lib/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const account = await describeAccount(request);
    return NextResponse.json({ account });
  } catch (err) {
    const message = err instanceof Error ? err.message : "account lookup failed";
    return NextResponse.json(
      {
        account: {
          connected: false,
          openId: null,
          username: null,
          displayName: null,
          avatarUrl: null,
          scopes: [],
          expiresAt: null,
          source: "none",
          clientKeyConfigured: false,
          clientSecretConfigured: false,
          canDirectPost: false,
          canDraftUpload: false,
          privacyLevels: ["SELF_ONLY"],
          maxVideoSizeMb: null,
          note: message,
        },
      },
      { status: 200 },
    );
  }
}

/** PUT → paste a user access token from the TikTok developer console. */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    await storeManualToken(String(body.accessToken ?? ""), String(body.scope ?? ""));
    const account = await describeAccount(request);
    return NextResponse.json({ account, connected: true });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof PublishError ? err.message : "could not store token",
        hint: err instanceof PublishError ? err.hint : undefined,
      },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  try {
    await disconnectAccount();
    return NextResponse.json({ disconnected: true });
  } catch (err) {
    const detail = err instanceof PublishError ? err.hint : undefined;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "disconnect failed", hint: detail },
      { status: 500 },
    );
  }
}
