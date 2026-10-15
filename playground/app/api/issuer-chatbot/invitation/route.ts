import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// The v2 API mints no connection invitation: a wallet dials the public DID of
// the agent. The page therefore shows that DID, and the QR code carries it.
export async function GET() {
  const url = process.env.ISSUER_CHATBOT_VS_ADMIN_URL;
  if (!url) {
    return NextResponse.json(
      { error: "ISSUER_CHATBOT_VS_ADMIN_URL not configured" },
      { status: 500 },
    );
  }

  const res = await fetch(`${url}/v2/agent/info`);
  if (!res.ok) {
    return NextResponse.json(
      { error: `Upstream ${res.status}` },
      { status: res.status },
    );
  }

  const data = await res.json();
  if (!data.did) {
    return NextResponse.json(
      { error: "The agent has no public DID yet" },
      { status: 502 },
    );
  }

  return NextResponse.json({ did: data.did as string });
}
