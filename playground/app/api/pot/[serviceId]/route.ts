import { NextResponse } from "next/server";
import {
  SERVICE_IDS,
  BASE_DOMAIN,
  resolveTrust,
  serviceDid,
  type EcsCredential,
  type ServiceId,
} from "../../../lib/server-env";

export const dynamic = "force-dynamic";

// Proof-of-Trust summary for one demo service. The indexer resolves the DID
// (v4 Verifiable Trust) and returns the ECS credentials the service presents.
// The route extracts the Service claims and the Organization (or Persona)
// claims of the operator, plus the active Participant roles of the service.
// This is the same picture verana.io shows in its Resolve-a-DID widget.

function claimStr(cred: EcsCredential | undefined, key: string): string | null {
  const value = cred?.credentialSubject?.[key];
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

  const result = await resolveTrust(did);
  if (!result) {
    return NextResponse.json(
      { error: "Trust resolution unavailable" },
      { status: 502 },
    );
  }

  const credentials = result.ecsCredentials ?? [];
  const service = credentials.find((c) => c.ecsSchema === "ServiceCredential");
  const org =
    credentials.find((c) => c.ecsSchema === "OrganizationCredential") ??
    credentials.find((c) => c.ecsSchema === "PersonaCredential");

  // The HOLDER entry only anchors the Service credential itself, so the card
  // shows the roles the service plays for other participants.
  const roles = (result.participations ?? [])
    .filter((p) => p.role !== "HOLDER")
    .map((p) => ({
      id: p.id,
      role: p.role,
      credentialSchemaId: p.credentialSchemaId,
    }));

  return NextResponse.json({
    did,
    trusted: result.trusted,
    evaluatedAtTime: result.evaluatedAtTime,
    expiresAtTime: result.expiresAtTime,
    corporationId: result.corporationId,
    service: service
      ? {
          name: claimStr(service, "name"),
          type: claimStr(service, "type"),
          description: claimStr(service, "description"),
        }
      : null,
    org: org
      ? {
          kind: org.ecsSchema === "PersonaCredential" ? "persona" : "organization",
          name: claimStr(org, "name"),
          countryCode: claimStr(org, "countryCode"),
          registryId: claimStr(org, "registryId"),
          address: claimStr(org, "address"),
        }
      : null,
    roles,
  });
}
