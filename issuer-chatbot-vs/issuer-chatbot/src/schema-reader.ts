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

// Discover the custom schema VTJSC from the organization-vs public DID document.
export async function discoverSchema(
  client: VsAgentClient,
  customSchemaBaseId: string,
  orgPublicUrl?: string
): Promise<SchemaInfo> {
  // The admin API publishes no list of JSON Schema Credentials, so the DID
  // document of organization-vs is the only source. A local setup must expose
  // organization-vs on a URL that this process can reach.
  if (!orgPublicUrl) {
    throw new Error(
      "ORG_VS_PUBLIC_URL is not set. The chatbot reads the custom schema from the " +
        "organization-vs DID document, so it needs the public URL of that agent."
    );
  }

  // Discover from the public DID document (works through the public ingress).
  const didDocUrl = `${orgPublicUrl}/.well-known/did.json`;
  console.log(`Fetching organization-vs DID document from ${didDocUrl}`);
  const discovered = await discoverVtjscFromDidDocument(
    didDocUrl,
    customSchemaBaseId
  );
  const vtjscId = discovered.vtjscId;
  const jsonSchema = discovered.jsonSchema;
  console.log(
    `Discovered VTJSC ${vtjscId} for credential schema ${discovered.schemaId}`
  );

  const schema = jsonSchema;

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
  const existingTypes = await client.getCredentialDefinitions();
  const existing = existingTypes.find(
    (ct) => ct.relatedJsonSchemaCredentialId === vtjscId
  );
  if (existing) {
    console.log(
      `Using existing credential type: ${existing.id}`
    );
    return existing.id;
  }

  // Create a new credential type. The agent reads the name, the version and the
  // attributes from the VTJSC, so the caller sends neither of them.
  console.log(`Creating anoncreds credential type for VTJSC ${vtjscId}...`);
  const created = await client.createCredentialDefinition({
    relatedJsonSchemaCredentialId: vtjscId,
    supportRevocation: false,
  });
  console.log(
    `Created credential type: ${created.id}`
  );
  return created.id;
}
