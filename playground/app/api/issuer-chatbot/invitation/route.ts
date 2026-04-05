import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.ISSUER_CHATBOT_VS_ADMIN_URL;
  if (!url) {
    return NextResponse.json(
      { error: "ISSUER_CHATBOT_VS_ADMIN_URL not configured" },
      { status: 500 },
    );
  }

  const res = await fetch(`${url}/v1/invitation`);
  if (!res.ok) {
    return NextResponse.json(
      { error: `Upstream ${res.status}` },
      { status: res.status },
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
