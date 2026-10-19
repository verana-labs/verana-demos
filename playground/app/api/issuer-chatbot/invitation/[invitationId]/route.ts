import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Reports whether a wallet accepted an invitation of the issuer chatbot, so the
// page can say "connected" as soon as the user scans the QR code. The agent
// sets the invitation record to `accepted` on a new connection and on the
// reuse of a connection that the wallet held already.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ invitationId: string }> },
) {
  const { invitationId } = await params;
  const url = process.env.ISSUER_CHATBOT_VS_ADMIN_URL;
  if (!url) {
    return NextResponse.json(
      { error: "ISSUER_CHATBOT_VS_ADMIN_URL not configured" },
      { status: 500 },
    );
  }

  const res = await fetch(
    `${url}/v2/didcomm/invitations/${encodeURIComponent(invitationId)}`,
  );
  if (!res.ok) {
    return NextResponse.json(
      { error: `Upstream ${res.status}` },
      { status: res.status },
    );
  }

  const record = (await res.json()) as { state?: string };
  return NextResponse.json({
    status: record.state === "accepted" ? "connected" : "pending",
  });
}
