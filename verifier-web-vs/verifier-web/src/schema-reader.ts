import { discoverVtjscFromDidDocument } from "@verana-demos/vt-schema";

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

// Discover the custom schema VTJSC from the organization-vs DID document.
export async function discoverSchema(
  customSchemaBaseId: string,
  orgPublicUrl?: string,
  orgLocalPublicUrl?: string,
  issuerPublicUrl?: string
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

  console.log(
    `Discovered schema "${title}" with ${attributes.length} attributes: ` +
      attributes.map((a) => a.name).join(", ")
  );

  // Discover the issuer's AnonCreds credential definition at boot time.
  // Due to a vs-agent bug, verifiers must use the issuer's specific
  // credential definition ID (not a jsonSchemaCredentialID).
  const credentialDefinitionId = await discoverIssuerCredDef(issuerPublicUrl);

  return {
    vtjscId,
    schemaId: vtjscId.replace(/-jsc\.json$/, ""),
    title,
    attributes,
    credentialDefinitionId,
  };
}

async function discoverIssuerCredDef(
  issuerPublicUrl?: string
): Promise<string | undefined> {
  if (!issuerPublicUrl) {
    console.warn(
      "ISSUER_VS_PUBLIC_URL not set — cannot discover issuer credential definition"
    );
    return undefined;
  }

  const url = `${issuerPublicUrl}/resources?resourceType=anonCredsCredDef`;
  console.log(`Discovering issuer credential definition from ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch credential definitions from issuer at ${url}: ${res.status}`
    );
  }
  const resources = (await res.json()) as { id?: string }[];
  if (!resources.length || !resources[0].id) {
    throw new Error(
      `No AnonCreds credential definition found on issuer at ${issuerPublicUrl}. ` +
        `Make sure the issuer has created its credential definition.`
    );
  }
  const credDefId = resources[0].id;
  console.log(`Discovered issuer credential definition: ${credDefId}`);
  return credDefId;
}
