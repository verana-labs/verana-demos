import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Creates a playground verification session on the verifier-chatbot app: the
// public DID of its agent plus a session id the page can poll for the verified
// attributes (see /api/verifier-chatbot/result/[sessionId]). The v2 API mints
// no connection invitation, so a wallet dials that DID.
export async function POST() {
  const url = process.env.VERIFIER_CHATBOT_URL;
  if (!url) {
    return NextResponse.json(
      { error: "VERIFIER_CHATBOT_URL not configured" },
      { status: 500 },
    );
  }

  const res = await fetch(`${url}/api/invitation`, { method: "POST" });
  if (!res.ok) {
    return NextResponse.json(
      { error: `Upstream ${res.status}` },
      { status: res.status },
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
