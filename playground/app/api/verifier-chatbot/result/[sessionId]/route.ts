import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const url = process.env.VERIFIER_CHATBOT_URL;
  if (!url) {
    return NextResponse.json(
      { error: "VERIFIER_CHATBOT_URL not configured" },
      { status: 500 },
    );
  }

  const res = await fetch(`${url}/api/result/${sessionId}`);
  if (!res.ok) {
    return NextResponse.json(
      { error: `Upstream ${res.status}` },
      { status: res.status },
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
