import { VsAgentClient } from "./vs-agent-client";
import { discoverVtjscFromDidDocument } from "@verana-demos/vt-schema";

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

// Discover the custom schema VTJSC from the organization-vs DID document.
export async function discoverSchema(
  client: VsAgentClient,
  customSchemaBaseId: string,
  orgPublicUrl?: string,
  orgLocalPublicUrl?: string
): Promise<SchemaInfo> {
  // The agent of organization-vs publishes each VTJSC as a
  // LinkedVerifiablePresentation service of its DID document. A local setup reads
  // that same document from another host, so one discovery path serves both setups.
  const orgBaseUrl = orgPublicUrl || orgLocalPublicUrl;
  if (!orgBaseUrl) {
    throw new Error(
      "Cannot discover the schema: no public URL for organization-vs. " +
        "Set ORG_VS_PUBLIC_URL, or set ORG_VS_PUBLIC_PORT for a local setup."
    );
  }

  const didDocUrl = `${orgBaseUrl}/.well-known/did.json`;
  console.log(`Fetching organization-vs DID document from ${didDocUrl}`);
  const discovered = await discoverVtjscFromDidDocument(
    didDocUrl,
    customSchemaBaseId
  );
  const vtjscId = discovered.vtjscId;
  const schema = discovered.jsonSchema;
  console.log(
    `Discovered VTJSC ${vtjscId} for credential schema ${discovered.schemaId}`
  );

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
  let cursor: string | undefined;
  do {
    const page = await client.listCredentialDefinitions(cursor);
    const existing = page.items.find(
      (definition) => definition.relatedJsonSchemaCredentialId === vtjscId
    );
    if (existing) {
      console.log(`Using existing credential type: ${existing.id}`);
      return existing.id;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  // Create a new credential type. The agent reads the name, the version and the
  // attributes from the VTJSC, so the caller sends neither of them.
  console.log(`Creating anoncreds credential type for VTJSC ${vtjscId}...`);
  const created = await client.createCredentialDefinition({
    relatedJsonSchemaCredentialId: vtjscId,
    supportRevocation: false,
  });
  console.log(`Created credential type: ${created.id}`);
  return created.id;
}
