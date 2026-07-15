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

export const BASE_DOMAIN =
  process.env.DEMOS_BASE_DOMAIN || "main.demos.testnet.verana.network";
export const NETWORK = process.env.VERANA_NETWORK || "testnet";
export const INDEXER_URL =
  process.env.INDEXER_URL || `https://idx.${NETWORK}.verana.network`;
export const FRONTEND_URL =
  process.env.VERANA_FRONTEND_URL || `https://app.${NETWORK}.verana.network`;
export const RESOLVER_URL =
  process.env.RESOLVER_URL || `https://resolver.${NETWORK}.verana.network`;

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
