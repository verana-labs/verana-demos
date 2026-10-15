/**
 * Verifiable Trust schema discovery, shared by the demo applications.
 *
 * Verana v4 changed two things that every application depends on:
 *
 *  - An Ecosystem controller publishes one VTJSC for each of its credential schemas, as a
 *    `LinkedVerifiablePresentation` service named `#vpr-schemas-<schemaId>-vtjsc-vp`. The name
 *    carries the numeric schema id of the chain, not the base id of the schema file, and the
 *    infix is `vtjsc`, not `jsc`.
 *  - A VTJSC points at its JSON Schema with `vpr:verana:<chain-id>:cs:<schemaId>`. The earlier
 *    form was a path, `vpr:verana:<chain-id>/cs/v1/js/<schemaId>`.
 *
 * The reference resolves against the indexer of the same chain. Never map one chain to the API
 * of another: every chain numbers its schemas separately, so the answer would be a different
 * credential that still looks valid.
 */

export interface VtjscService {
  id: string
  type: string
  serviceEndpoint: string
}

export interface DiscoveredVtjsc {
  /** Id of the JSON Schema Credential, for example https://host/vt/schemas-22-jsc.json */
  vtjscId: string
  /** Numeric credential schema id on the chain */
  schemaId: number
  /** The JSON Schema itself */
  jsonSchema: Record<string, unknown>
}

const VTJSC_SERVICE_PATTERN = /vpr-schemas-(\d+)-vtjsc-vp$/
const DEFAULT_INDEXER_BY_CHAIN: Record<string, string> = {
  'vna-devnet-1': 'https://idx.devnet.verana.network',
  'vna-testnet-1': 'https://idx.testnet.verana.network',
  'vna-mainnet-1': 'https://idx.verana.network',
}

async function fetchJson<T>(url: string, what: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${what} from ${url}: ${response.status}`)
  }
  return (await response.json()) as T
}

/**
 * Resolve a VPR credential schema reference to its JSON Schema.
 *
 * Accepts `vpr:verana:<chain-id>:cs:<schemaId>` and a plain HTTP(S) URL. The indexer answers with
 * the schema as a string inside `schema.json_schema`.
 */
export async function resolveSchemaRef(
  ref: string,
  indexerBaseUrl?: string,
): Promise<{ schemaId: number; jsonSchema: Record<string, unknown> }> {
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    const raw = await fetchJson<Record<string, unknown>>(ref, 'JSON Schema')
    return { schemaId: 0, jsonSchema: unwrapSchema(raw) }
  }

  const match = ref.match(/^vpr:verana:([^:]+):cs:(\d+)$/)
  if (!match) {
    throw new Error(
      `Cannot resolve schema ref "${ref}". Expected vpr:verana:<chain-id>:cs:<schemaId> or an HTTP URL.`,
    )
  }
  const [, chainId, schemaId] = match

  const baseUrl =
    indexerBaseUrl ?? process.env.VERANA_INDEXER_BASE_URL ?? DEFAULT_INDEXER_BY_CHAIN[chainId]
  if (!baseUrl) {
    throw new Error(
      `No indexer for chain "${chainId}". Set VERANA_INDEXER_BASE_URL. Do not point one chain at the indexer of another: schema ids are per chain.`,
    )
  }

  const url = `${baseUrl.replace(/\/$/, '')}/v4/credential-schema/get/${schemaId}`
  const answer = await fetchJson<{ schema?: { json_schema?: unknown } }>(url, 'credential schema')
  const jsonSchema = answer.schema?.json_schema
  if (!jsonSchema) throw new Error(`Credential schema ${schemaId} at ${url} carries no json_schema`)

  return { schemaId: Number(schemaId), jsonSchema: unwrapSchema(jsonSchema) }
}

function unwrapSchema(raw: unknown): Record<string, unknown> {
  // The indexer answers with the schema as a string; a direct URL answers with the object.
  if (typeof raw === 'string') return JSON.parse(raw) as Record<string, unknown>
  const record = raw as Record<string, unknown>
  if (typeof record.schema === 'string') return JSON.parse(record.schema) as Record<string, unknown>
  return record
}

/**
 * Find the VTJSC of a custom credential schema in the DID Document of its Ecosystem controller.
 *
 * With one VTJSC the answer is that one. With more than one, the schema whose `$id` or `title`
 * names `expectedBaseId` wins, so a second custom schema stays unambiguous.
 */
export async function discoverVtjscFromDidDocument(
  didDocumentUrl: string,
  expectedBaseId: string,
  indexerBaseUrl?: string,
): Promise<DiscoveredVtjsc> {
  const didDoc = await fetchJson<{ service?: VtjscService[] }>(didDocumentUrl, 'DID document')
  const services = (didDoc.service ?? []).filter(
    service => service.type === 'LinkedVerifiablePresentation' && VTJSC_SERVICE_PATTERN.test(service.id),
  )

  if (services.length === 0) {
    const available = (didDoc.service ?? []).map(service => service.id)
    throw new Error(
      `No VTJSC service in ${didDocumentUrl}. Expected an id that ends with vpr-schemas-<schemaId>-vtjsc-vp. Available: ${JSON.stringify(available)}`,
    )
  }

  const candidates: DiscoveredVtjsc[] = []
  for (const service of services) {
    const vp = await fetchJson<{
      verifiableCredential?: { id?: string; credentialSubject?: { jsonSchema?: { $ref?: string } | string } }[]
    }>(service.serviceEndpoint, 'VTJSC presentation')

    const vtjsc = vp.verifiableCredential?.[0]
    if (!vtjsc?.id) continue

    const rawRef = vtjsc.credentialSubject?.jsonSchema
    const ref = typeof rawRef === 'object' && rawRef !== null ? rawRef.$ref : rawRef
    if (!ref) continue

    const { schemaId, jsonSchema } = await resolveSchemaRef(ref, indexerBaseUrl)
    candidates.push({ vtjscId: vtjsc.id, schemaId, jsonSchema })
  }

  if (candidates.length === 0) {
    throw new Error(`No VTJSC in ${didDocumentUrl} carries a resolvable credentialSubject.jsonSchema`)
  }
  if (candidates.length === 1) return candidates[0]

  const named = candidates.find(candidate => namesBaseId(candidate.jsonSchema, expectedBaseId))
  if (named) return named

  throw new Error(
    `${candidates.length} VTJSCs in ${didDocumentUrl}, and none names "${expectedBaseId}". Schemas: ${JSON.stringify(
      candidates.map(candidate => ({ schemaId: candidate.schemaId, title: candidate.jsonSchema.title })),
    )}`,
  )
}

function namesBaseId(jsonSchema: Record<string, unknown>, baseId: string): boolean {
  const id = String(jsonSchema.$id ?? '')
  const title = String(jsonSchema.title ?? '')
  const needle = baseId.toLowerCase()
  return id.toLowerCase().includes(needle) || title.toLowerCase().replace(/\s+/g, '-').includes(needle)
}
