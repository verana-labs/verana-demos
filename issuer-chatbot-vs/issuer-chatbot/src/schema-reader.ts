import { VsAgentClient } from "./vs-agent-client";

const VPR_NETWORK_MAP: Record<string, string> = {
  "vna-testnet-1": "https://api.testnet.verana.network/verana",
  "vna-devnet-1": "https://api.testnet.verana.network/verana",
  "vna-mainnet-1": "https://api.verana.network/verana",
};

function resolveSchemaRef(ref: string): string {
  // If already an HTTP(S) URL, return as-is
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    return ref;
  }
  // VPR URI: vpr:verana:{chain-id}/{path}
  const match = ref.match(/^vpr:verana:([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Cannot resolve schema ref: ${ref}`);
  }
  const [, chainId, path] = match;
  const baseUrl =
    VPR_NETWORK_MAP[chainId] ||
    process.env.VERANA_API_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      `Unknown chain ID "${chainId}" in VPR ref. Set VERANA_API_BASE_URL env var.`
    );
  }
  return `${baseUrl}/${path}`;
}

export interface SchemaAttribute {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface SchemaInfo {
  vtjscId: string;
  schemaId: string;
  title: string;
  attributes: SchemaAttribute[];
  credentialDefinitionId: string;
}

// Discover the custom schema VTJSC from the organization-vs public DID document.
// Falls back to the admin API when no public URL is configured (fully local setup).
export async function discoverSchema(
  client: VsAgentClient,
  customSchemaBaseId: string,
  orgPublicUrl?: string,
  orgClient?: VsAgentClient
): Promise<SchemaInfo> {
  let vtjscId: string;
  let schemaUrl: string;

  if (orgPublicUrl) {
    // Discover from public DID document (works through the public ingress)
    const didDocUrl = `${orgPublicUrl}/.well-known/did.json`;
    console.log(`Fetching organization-vs DID document from ${didDocUrl}`);
    const didDocRes = await fetch(didDocUrl);
    if (!didDocRes.ok) {
      throw new Error(
        `Failed to fetch DID document from ${didDocUrl}: ${didDocRes.status}`
      );
    }
    const didDoc = (await didDocRes.json()) as {
      service?: { id: string; type: string; serviceEndpoint: string }[];
    };

    // Find the LinkedVerifiablePresentation for the custom schema
    const vpSuffix = `schemas-${customSchemaBaseId}-jsc-vp`;
    const vpService = didDoc.service?.find(
      (s) =>
        s.type === "LinkedVerifiablePresentation" && s.id.includes(vpSuffix)
    );
    if (!vpService) {
      const availableIds = (didDoc.service || [])
        .filter((s) => s.type === "LinkedVerifiablePresentation")
        .map((s) => s.id);
      throw new Error(
        `Custom schema VP not found for "${customSchemaBaseId}" in DID document. ` +
          `Available VPs: ${JSON.stringify(availableIds)}`
      );
    }

    // Fetch the VP and extract the VTJSC credential
    console.log(`Fetching custom schema VP from ${vpService.serviceEndpoint}`);
    const vpRes = await fetch(vpService.serviceEndpoint);
    if (!vpRes.ok) {
      throw new Error(
        `Failed to fetch VP from ${vpService.serviceEndpoint}: ${vpRes.status}`
      );
    }
    const vp = (await vpRes.json()) as {
      verifiableCredential?: {
        id?: string;
        credentialSubject?: {
          jsonSchema?: { $ref: string } | string;
        };
      }[];
    };
    const vtjsc = vp.verifiableCredential?.[0];
    if (!vtjsc?.id) {
      throw new Error(`VP at ${vpService.serviceEndpoint} has no VTJSC`);
    }

    vtjscId = vtjsc.id;
    const rawRef = vtjsc.credentialSubject?.jsonSchema;
    const ref =
      typeof rawRef === "object" && rawRef !== null
        ? (rawRef as { $ref: string }).$ref
        : (rawRef as string | undefined);
    if (!ref) {
      throw new Error(`VTJSC ${vtjscId} has no credentialSubject.jsonSchema`);
    }
    schemaUrl = ref;
  } else {
    // Fallback: use org admin API (fully local setup)
    const schemaSource = orgClient || client;
    const vtjscList = await schemaSource.getJsonSchemaCredentials();

    const suffix = `schemas-${customSchemaBaseId}-jsc.json`;
    const customVtjsc = vtjscList.data.find((v) =>
      v.credential.id.endsWith(suffix)
    );
    if (!customVtjsc) {
      const availableIds = vtjscList.data.map((v) => v.credential.id);
      throw new Error(
        `Custom VTJSC not found for base ID "${customSchemaBaseId}". ` +
          `Available VTJSCs: ${JSON.stringify(availableIds)}`
      );
    }

    vtjscId = customVtjsc.credential.id;
    const rawRef = customVtjsc.credential.credentialSubject?.jsonSchema;
    const ref =
      typeof rawRef === "object" && rawRef !== null
        ? (rawRef as { $ref: string }).$ref
        : (rawRef as string | undefined);
    if (!ref) {
      throw new Error(`VTJSC ${vtjscId} has no credentialSubject.jsonSchema`);
    }
    schemaUrl = ref;
  }

  // Resolve and fetch the JSON schema
  const resolvedUrl = resolveSchemaRef(schemaUrl);
  console.log(`Fetching schema from ${resolvedUrl} (ref: ${schemaUrl})`);
  const schemaResponse = await fetch(resolvedUrl);
  if (!schemaResponse.ok) {
    throw new Error(
      `Failed to fetch schema from ${resolvedUrl}: ${schemaResponse.status}`
    );
  }
  const raw = (await schemaResponse.json()) as Record<string, unknown>;
  // The Verana API wraps the schema as { schema: "{...}" }
  const schema: Record<string, unknown> =
    typeof raw.schema === "string"
      ? (JSON.parse(raw.schema) as Record<string, unknown>)
      : raw;

  // Extract credentialSubject properties
  const csProps = (
    schema.properties as Record<string, unknown> | undefined
  )?.credentialSubject as Record<string, unknown> | undefined;

  if (!csProps) {
    throw new Error(`Schema has no properties.credentialSubject`);
  }

  const properties = (csProps.properties || {}) as Record<
    string,
    { type?: string; description?: string }
  >;
  const required = ((csProps.required || []) as string[]).filter(
    (r) => r !== "id"
  );

  const attributes: SchemaAttribute[] = Object.entries(properties)
    .filter(([name]) => name !== "id")
    .map(([name, prop]) => ({
      name,
      type: prop.type || "string",
      description: prop.description || name,
      required: required.includes(name),
    }));

  if (attributes.length === 0) {
    throw new Error(
      `Schema has no credentialSubject properties (excluding "id")`
    );
  }

  const title = (schema.title as string) || "Credential";

  console.log(
    `Discovered schema "${title}" with ${attributes.length} attributes: ` +
      attributes.map((a) => a.name).join(", ")
  );

  // Ensure a local AnonCreds credential type exists on the issuer agent
  const credentialDefinitionId = await ensureCredentialType(client, vtjscId);

  return {
    vtjscId,
    schemaId: vtjscId.replace(/-jsc\.json$/, ""),
    title,
    attributes,
    credentialDefinitionId,
  };
}

async function ensureCredentialType(
  client: VsAgentClient,
  vtjscId: string
): Promise<string> {
  // Check if a credential type already exists for this VTJSC
  const existingTypes = await client.getCredentialTypes();
  const existing = existingTypes.find(
    (ct) => ct.relatedJsonSchemaCredentialId === vtjscId
  );
  if (existing) {
    console.log(
      `Using existing credential type: ${existing.id}`
    );
    return existing.id;
  }

  // Create a new credential type
  console.log(`Creating anoncreds credential type for VTJSC ${vtjscId}...`);
  const created = await client.createCredentialType({
    name: vtjscId.replace(/[^a-zA-Z0-9-]/g, "-"),
    version: "1.0",
    relatedJsonSchemaCredentialId: vtjscId,
    supportRevocation: false,
  });
  console.log(
    `Created credential type: ${created.id}`
  );
  return created.id;
}
