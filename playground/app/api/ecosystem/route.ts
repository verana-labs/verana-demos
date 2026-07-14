import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Live picture of the demo ecosystem, assembled server-side from public
// sources: each service's DID document (for the canonical did:webvh DID)
// and the network indexer (trust registry, credential schema, permission
// tree). Everything is best-effort — a missing upstream just yields nulls
// and the page renders without the live extras.

const SERVICE_IDS = [
  "organization-vs",
  "issuer-chatbot-vs",
  "issuer-web-vs",
  "verifier-chatbot-vs",
  "verifier-web-vs",
] as const;

const BASE_DOMAIN =
  process.env.DEMOS_BASE_DOMAIN || "main.demos.testnet.verana.network";
const NETWORK = process.env.VERANA_NETWORK || "testnet";
const INDEXER_URL =
  process.env.INDEXER_URL || `https://idx.${NETWORK}.verana.network`;
const FRONTEND_URL =
  process.env.VERANA_FRONTEND_URL || `https://app.${NETWORK}.verana.network`;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type DidDoc = { id?: string; alsoKnownAs?: string[] };

/** Canonical DID of a service: the did:webvh alias when present. */
async function serviceDid(host: string): Promise<string | null> {
  const doc = await fetchJson<DidDoc>(`https://${host}/.well-known/did.json`);
  if (!doc) return null;
  return (
    doc.alsoKnownAs?.find((d) => d.startsWith("did:webvh:")) ?? doc.id ?? null
  );
}

type TrustRegistryEntry = { id: number; did: string };
type SchemaEntry = { id: number; tr_id: number; json_schema: string };
type PermissionEntry = {
  id: number;
  type: string;
  did: string | null;
  validator_perm_id: number | null;
  revoked: string | null;
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

  // 2. Find the trust registry the organization controls (lowest id wins,
  //    matching the deploy workflow's duplicate-archiving convention)
  const orgDid = services["organization-vs"].did;
  let trustRegistry: { id: number; url: string } | null = null;
  if (orgDid) {
    const trList = await fetchJson<{ trust_registries?: TrustRegistryEntry[] }>(
      `${INDEXER_URL}/verana/tr/v1/list?only_active=true&response_max_size=1024`,
    );
    const tr = (trList?.trust_registries ?? [])
      .filter((t) => t.did === orgDid)
      .sort((a, b) => a.id - b.id)[0];
    if (tr) {
      trustRegistry = { id: tr.id, url: `${FRONTEND_URL}/tr/${tr.id}` };
    }
  }

  // 3. The credential schema published under that trust registry
  let schema: {
    id: number;
    url: string;
    jsonUrl: string;
    json: string | null;
  } | null = null;
  if (trustRegistry) {
    const csList = await fetchJson<{ schemas?: SchemaEntry[] }>(
      `${INDEXER_URL}/verana/cs/v1/list?tr_id=${trustRegistry.id}`,
    );
    const cs = (csList?.schemas ?? []).sort((a, b) => a.id - b.id)[0];
    if (cs) {
      let json: string | null = null;
      try {
        json = JSON.stringify(JSON.parse(cs.json_schema), null, 2);
      } catch {
        json = cs.json_schema ?? null;
      }
      schema = {
        id: cs.id,
        url: `${FRONTEND_URL}/tr/cs/${cs.id}`,
        jsonUrl: `${INDEXER_URL}/verana/cs/v1/js/${cs.id}`,
        json,
      };
    }
  }

  // 4. The schema's permission tree (ecosystem root, issuers, verifiers)
  let permissions: {
    id: number;
    type: string;
    did: string | null;
    validatorPermId: number | null;
  }[] = [];
  if (schema) {
    const permList = await fetchJson<{ permissions?: PermissionEntry[] }>(
      `${INDEXER_URL}/verana/perm/v1/list?schema_id=${schema.id}`,
    );
    permissions = (permList?.permissions ?? [])
      .filter((p) => !p.revoked)
      .map((p) => ({
        id: p.id,
        type: p.type,
        did: p.did,
        validatorPermId: p.validator_perm_id,
      }))
      .sort((a, b) => a.id - b.id);
  }

  return NextResponse.json({
    network: NETWORK,
    services,
    trustRegistry,
    schema,
    participantsUrl: schema ? `${FRONTEND_URL}/participants/${schema.id}` : null,
    permissions,
  });
}
