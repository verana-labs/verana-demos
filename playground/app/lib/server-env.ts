// Server-side configuration and helpers shared by the API routes that read
// live data from the demo services and the Verana network.

export const SERVICE_IDS = [
  "organization-vs",
  "issuer-chatbot-vs",
  "issuer-web-vs",
  "verifier-chatbot-vs",
  "verifier-web-vs",
] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];

// The demos run on devnet only: the v4 chain modules that they need are not on
// testnet yet. The deploy workflow overrides both values.
export const BASE_DOMAIN =
  process.env.DEMOS_BASE_DOMAIN || "example.demos.devnet.verana.network";
export const NETWORK = process.env.VERANA_NETWORK || "devnet";
export const INDEXER_URL =
  process.env.INDEXER_URL || `https://idx.${NETWORK}.verana.network`;
export const FRONTEND_URL =
  process.env.VERANA_FRONTEND_URL || `https://app.${NETWORK}.verana.network`;

export async function fetchJson<T>(
  url: string,
  timeoutMs = 8_000,
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type DidDoc = { id?: string; alsoKnownAs?: string[] };

/** Canonical DID of a service: the did:webvh alias when present. */
export async function serviceDid(host: string): Promise<string | null> {
  const doc = await fetchJson<DidDoc>(`https://${host}/.well-known/did.json`);
  if (!doc) return null;
  return (
    doc.alsoKnownAs?.find((d) => d.startsWith("did:webvh:")) ?? doc.id ?? null
  );
}

// ---------------------------------------------------------------------------
// Trust resolution (indexer v4)
// ---------------------------------------------------------------------------
//
// The v4 indexer answers trust resolution at POST /v4/verifiable-trust/resolve.
// The earlier standalone resolver (resolver.<network>.verana.network,
// GET /v1/trust/resolve) no longer exists. The answer is the last evaluation
// the chain resolver stored, so it comes back at once. A trusted answer
// carries the expiry of the credential in `expiresAtTime`.

export type EcsSchema =
  | "ServiceCredential"
  | "OrganizationCredential"
  | "PersonaCredential"
  | "UserAgentCredential"
  | "BadgeCredential";

export type EcsCredential = {
  ecsSchema: EcsSchema;
  ecsSchemaVersion: string;
  credentialSchemaId: number;
  issuerParticipantId: number;
  ecosystemId: number;
  participantId: number;
  id: string;
  validFrom: string | null;
  validUntil: string | null;
  credentialSubject: Record<string, unknown>;
};

export type Participation = {
  id: number;
  role: string;
  credentialSchemaId: number;
  ecosystemId: number;
  state: string;
  validatorParticipantId: number | null;
};

export type TrustResolution = {
  did: string;
  trusted: boolean;
  evaluatedAtTime: string;
  evaluatedAtBlock: number;
  expiresAtTime: string | null;
  corporationId: number;
  ecsCredentials?: EcsCredential[];
  participations?: Participation[];
};

/**
 * Resolve the trust status of a DID, with its ECS credential claims and its
 * active Participant entries. `participations: true` selects ACTIVE entries.
 */
export async function resolveTrust(
  did: string,
  timeoutMs = 15_000,
): Promise<TrustResolution | null> {
  try {
    const res = await fetch(`${INDEXER_URL}/v4/verifiable-trust/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ did, ecsCredentials: true, participations: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as TrustResolution;
  } catch {
    return null;
  }
}
