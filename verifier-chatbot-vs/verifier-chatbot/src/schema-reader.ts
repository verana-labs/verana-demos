import { VsAgentClient, VtjscEntry } from "./vs-agent-client";

const VPR_NETWORK_MAP: Record<string, string> = {
  "vna-testnet-1": "https://api.testnet.verana.network/verana",
  "vna-devnet-1": "https://api.testnet.verana.network/verana",
  "vna-mainnet-1": "https://api.verana.network/verana",
};

function resolveSchemaRef(ref: string): string {
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    return ref;
  }
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
}

export interface SchemaInfo {
  vtjscId: string;
  schemaId: string;
  title: string;
  attributes: SchemaAttribute[];
  credentialDefinitionId?: string;
}

export async function discoverSchema(
  client: VsAgentClient,
  customSchemaBaseId: string,
  orgClient?: VsAgentClient
): Promise<SchemaInfo> {
  // Use the org-vs agent to find the custom schema VTJSC (org owns the schema)
  const schemaSource = orgClient || client;
  const vtjscList = await schemaSource.getJsonSchemaCredentials();

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

  // Fetch the JSON schema to extract attributes for proof request
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
  const schema: Record<string, unknown> =
    typeof raw.schema === "string"
      ? (JSON.parse(raw.schema) as Record<string, unknown>)
      : raw;

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

  const attributes: SchemaAttribute[] = Object.entries(properties)
    .filter(([name]) => name !== "id")
    .map(([name, prop]) => ({
      name,
      type: prop.type || "string",
      description: prop.description || name,
    }));

  if (attributes.length === 0) {
    throw new Error(
      `Schema has no credentialSubject properties (excluding "id")`
    );
  }

  const title = (schema.title as string) || "Credential";

  // Try to extract credentialDefinitionId for AnonCreds proof requests
  const credDefId = (customVtjsc as Record<string, unknown>)
    .credentialDefinitionId as string | undefined;

  console.log(
    `Discovered schema "${title}" with ${attributes.length} attributes: ` +
      attributes.map((a) => a.name).join(", ")
  );
  if (credDefId) {
    console.log(`AnonCreds credential definition ID: ${credDefId}`);
  }

  return {
    vtjscId: customVtjsc.credential.id,
    schemaId: customVtjsc.schemaId,
    title,
    attributes,
    credentialDefinitionId: credDefId,
  };
}
