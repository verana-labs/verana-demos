import { VsAgentClient, VtjscEntry } from "./vs-agent-client";

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

export async function discoverSchema(
  client: VsAgentClient,
  customSchemaBaseId: string
): Promise<SchemaInfo> {
  const vtjscList = await client.getJsonSchemaCredentials();

  // Find the custom VTJSC — credential ID ends with schemas-{baseId}-jsc.json
  // (not the ECS org/service VTJSCs which end in -service-jsc.json / -org-jsc.json)
  const suffix = `schemas-${customSchemaBaseId}-jsc.json`;
  const customVtjsc = vtjscList.data.find(
    (v: VtjscEntry) => v.credential.id.endsWith(suffix)
  );

  if (!customVtjsc) {
    const availableIds = vtjscList.data.map((v: VtjscEntry) => v.credential.id);
    throw new Error(
      `Custom VTJSC not found for base ID "${customSchemaBaseId}". ` +
        `Available VTJSCs: ${JSON.stringify(availableIds)}`
    );
  }

  // Fetch the JSON schema to extract attributes
  const rawJsonSchema = customVtjsc.credential.credentialSubject?.jsonSchema;
  const schemaUrl =
    typeof rawJsonSchema === "object" && rawJsonSchema !== null
      ? (rawJsonSchema as { $ref: string }).$ref
      : (rawJsonSchema as string | undefined);
  if (!schemaUrl) {
    throw new Error(
      `VTJSC ${customVtjsc.credential.id} has no credentialSubject.jsonSchema`
    );
  }

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

  // Ensure an anoncreds credential type (definition) exists
  const credentialDefinitionId = await ensureCredentialType(
    client,
    customVtjsc.credential.id,
    attributes.map((a) => a.name)
  );

  return {
    vtjscId: customVtjsc.credential.id,
    schemaId: customVtjsc.schemaId,
    title,
    attributes,
    credentialDefinitionId,
  };
}

async function ensureCredentialType(
  client: VsAgentClient,
  vtjscId: string,
  attributeNames: string[]
): Promise<string> {
  // Check if a credential type already exists for this VTJSC
  const existingTypes = await client.getCredentialTypes();
  const existing = existingTypes.find(
    (ct) => ct.relatedJsonSchemaCredentialId === vtjscId
  );
  if (existing) {
    console.log(
      `Using existing credential type: ${existing.credentialDefinitionId}`
    );
    return existing.credentialDefinitionId;
  }

  // Create a new credential type
  console.log(`Creating anoncreds credential type for VTJSC ${vtjscId}...`);
  const created = await client.createCredentialType({
    name: vtjscId.replace(/[^a-zA-Z0-9-]/g, "-"),
    version: "1.0",
    attributes: attributeNames,
    relatedJsonSchemaCredentialId: vtjscId,
    supportRevocation: false,
  });
  console.log(
    `Created credential type: ${created.credentialDefinitionId}`
  );
  return created.credentialDefinitionId;
}
