import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Creates a single-use connection invitation on the agent of the issuer
// chatbot, with no credential offer in it: the chatbot starts the conversation
// once the wallet connects. The QR code carries the short URL of the
// invitation. A wallet that holds a connection to the agent already reuses it.
export async function POST() {
  const url = process.env.ISSUER_CHATBOT_VS_ADMIN_URL;
  if (!url) {
    return NextResponse.json(
      { error: "ISSUER_CHATBOT_VS_ADMIN_URL not configured" },
      { status: 500 },
    );
  }

  const res = await fetch(`${url}/v2/didcomm/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: `Upstream ${res.status}` },
      { status: res.status },
    );
  }

  const data = (await res.json()) as { shortUrl?: string };
  if (!data.shortUrl) {
    return NextResponse.json(
      { error: "The agent returned no invitation URL" },
      { status: 502 },
    );
  }

  return NextResponse.json({ invitationUrl: data.shortUrl });
}
