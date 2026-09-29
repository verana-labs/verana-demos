import { VsAgentClient } from "./vs-agent-client";
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

// Discover the custom schema VTJSC from the organization-vs public DID document.
export async function discoverSchema(
  client: VsAgentClient,
  customSchemaBaseId: string,
  orgPublicUrl?: string,
  issuerPublicUrl?: string
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
