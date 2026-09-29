import { NextResponse } from "next/server";
import {
  SERVICE_IDS,
  BASE_DOMAIN,
  NETWORK,
  INDEXER_URL,
  FRONTEND_URL,
  fetchJson,
  serviceDid,
} from "../../lib/server-env";

export const dynamic = "force-dynamic";

// Live picture of the demo ecosystem, assembled server-side from public
// sources: each service's DID document (for the canonical did:webvh DID)
// and the network indexer (ecosystem, credential schema, participant
// tree). Everything is best-effort — a missing upstream just yields nulls
// and the page renders without the live extras.
//
// The v4 chain modules replace the earlier model: an Ecosystem holds the
// credential schemas, and a Participant entry replaces a permission. The
// indexer answers these under /v4.

type EcosystemEntry = { id: number; did: string; archived: string | null };
type SchemaEntry = { id: number; ecosystem_id: number; json_schema: string };
type ParticipantEntry = {
  id: number;
  role: string;
  did: string | null;
  validator_participant_id: number | null;
  revoked: string | null;
  slashed: string | null;
};

export async function GET() {
  // 1. Resolve each service's DID from its public DID document
  const dids = await Promise.all(
    SERVICE_IDS.map((id) => serviceDid(`${id}.${BASE_DOMAIN}`)),
  );
  const services = Object.fromEntries(
    SERVICE_IDS.map((id, i) => [
      id,
      { did: dids[i], agentUrl: `https://${id}.${BASE_DOMAIN}/` },
    ]),
  );

  // 2. Find the Ecosystem the organization controls (lowest id wins, which
  //    matches the archiving convention of the deploy workflow)
  const orgDid = services["organization-vs"].did;
  let ecosystem: { id: number; url: string } | null = null;
  if (orgDid) {
    const ecoList = await fetchJson<{ ecosystems?: EcosystemEntry[] }>(
      `${INDEXER_URL}/v4/ecosystem/list?response_max_size=1024`,
    );
    const eco = (ecoList?.ecosystems ?? [])
      .filter((e) => e.did === orgDid && !e.archived)
      .sort((a, b) => a.id - b.id)[0];
    if (eco) {
      ecosystem = { id: eco.id, url: `${FRONTEND_URL}/ecosystems/${eco.id}` };
    }
  }

  // 3. The credential schema published under that Ecosystem
  let schema: {
    id: number;
    url: string;
    jsonUrl: string;
    json: string | null;
  } | null = null;
  if (ecosystem) {
    const ecosystemId = ecosystem.id;
    const csList = await fetchJson<{ schemas?: SchemaEntry[] }>(
      `${INDEXER_URL}/v4/credential-schema/list?response_max_size=1024`,
    );
    const cs = (csList?.schemas ?? [])
      .filter((s) => s.ecosystem_id === ecosystemId)
      .sort((a, b) => a.id - b.id)[0];
    if (cs) {
      let json: string | null = null;
      try {
        json = JSON.stringify(JSON.parse(cs.json_schema), null, 2);
      } catch {
        json = cs.json_schema ?? null;
      }
      schema = {
        id: cs.id,
        url: `${FRONTEND_URL}/credential-schemas/${cs.id}`,
        jsonUrl: `${INDEXER_URL}/v4/credential-schema/get/${cs.id}`,
        json,
      };
    }
  }

  // 4. The participant tree of that schema (ecosystem root, issuers, verifiers)
  let participants: {
    id: number;
    role: string;
    did: string | null;
    validatorParticipantId: number | null;
  }[] = [];
  if (schema) {
    const ppList = await fetchJson<{ participants?: ParticipantEntry[] }>(
      `${INDEXER_URL}/v4/participant/list?schema_id=${schema.id}&participant_state=ACTIVE&response_max_size=1024`,
    );
    participants = (ppList?.participants ?? [])
      .filter((p) => !p.revoked && !p.slashed)
      .map((p) => ({
        id: p.id,
        role: p.role,
        did: p.did,
        validatorParticipantId: p.validator_participant_id,
      }))
      .sort((a, b) => a.id - b.id);
  }

  return NextResponse.json({
    network: NETWORK,
    services,
    ecosystem,
    schema,
    participantsUrl: schema ? `${FRONTEND_URL}/participants/${schema.id}` : null,
    participants,
  });
}
