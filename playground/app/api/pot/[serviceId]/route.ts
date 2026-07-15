import { NextResponse } from "next/server";
import {
  SERVICE_IDS,
  BASE_DOMAIN,
  RESOLVER_URL,
  fetchJson,
  serviceDid,
  type ServiceId,
} from "../../../lib/server-env";

export const dynamic = "force-dynamic";

// Proof-of-Trust summary for one demo service: trust-resolve its DID
// against the network resolver and extract the service (ECS-SERVICE) and
// operator (ECS-ORG / ECS-PERSONA) credential claims — the same picture
// verana.io shows in its Resolve-a-DID widget.

type ResolvedCredential = {
  ecsType?: string;
  result?: string;
  claims?: Record<string, unknown>;
};

type ResolveResult = {
  trustStatus?: string;
  credentials?: ResolvedCredential[];
};

function claimStr(
  cred: ResolvedCredential | undefined,
  key: string,
): string | null {
  const value = cred?.claims?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params;
  if (!SERVICE_IDS.includes(serviceId as ServiceId)) {
    return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  }

  const did = await serviceDid(`${serviceId}.${BASE_DOMAIN}`);
  if (!did) {
    return NextResponse.json(
      { error: "Service DID unavailable" },
      { status: 502 },
    );
  }

  // First-time resolutions can take a few seconds; results are cached.
  const result = await fetchJson<ResolveResult>(
    `${RESOLVER_URL}/v1/trust/resolve?did=${encodeURIComponent(did)}&detail=full`,
    30_000,
  );
  if (!result) {
    return NextResponse.json(
      { error: "Trust resolution unavailable" },
      { status: 502 },
    );
  }

  const service = result.credentials?.find((c) => c.ecsType === "ECS-SERVICE");
  const org = result.credentials?.find(
    (c) => c.ecsType === "ECS-ORG" || c.ecsType === "ECS-PERSONA",
  );

  return NextResponse.json({
    did,
    trustStatus: result.trustStatus ?? "UNTRUSTED",
    service: service
      ? {
          name: claimStr(service, "name"),
          type: claimStr(service, "type"),
          description: claimStr(service, "description"),
        }
      : null,
    org: org
      ? {
          name: claimStr(org, "name"),
          countryCode: claimStr(org, "countryCode"),
          registryId: claimStr(org, "registryId"),
          address: claimStr(org, "address"),
        }
      : null,
  });
}
