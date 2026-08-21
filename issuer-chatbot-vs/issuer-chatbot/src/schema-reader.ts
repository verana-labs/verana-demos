import { VsAgentClient } from "./vs-agent-client";
import {
  discoverVtjscFromDidDocument,
  resolveSchemaRef,
} from "@verana-demos/vt-schema";

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
  let jsonSchema: Record<string, unknown>;

  if (orgPublicUrl) {
    // Discover from the public DID document (works through the public ingress).
    const didDocUrl = `${orgPublicUrl}/.well-known/did.json`;
    console.log(`Fetching organization-vs DID document from ${didDocUrl}`);
    const discovered = await discoverVtjscFromDidDocument(
      didDocUrl,
      customSchemaBaseId
    );
    vtjscId = discovered.vtjscId;
    jsonSchema = discovered.jsonSchema;
    console.log(
      `Discovered VTJSC ${vtjscId} for credential schema ${discovered.schemaId}`
    );
  } else {
    // Fallback: the org admin API (a fully local setup with no public ingress).
    const schemaSource = orgClient || client;
    const vtjscList = await schemaSource.getJsonSchemaCredentials();

    // v4 names a VTJSC after the numeric credential schema id, so the base id of the schema file
    // no longer appears in it. With one custom VTJSC that is the one; otherwise match the title.
    const candidates = vtjscList.data.filter((v) =>
      /schemas-\d+-jsc\.json$/.test(v.credential.id)
    );
    if (candidates.length === 0) {
      const availableIds = vtjscList.data.map((v) => v.credential.id);
      throw new Error(
        `No custom VTJSC found for base ID "${customSchemaBaseId}". ` +
          `Available VTJSCs: ${JSON.stringify(availableIds)}`
      );
    }

    let picked: { id: string; schema: Record<string, unknown> } | undefined;
    for (const candidate of candidates) {
      const rawRef = candidate.credential.credentialSubject?.jsonSchema;
      const ref =
        typeof rawRef === "object" && rawRef !== null
          ? (rawRef as { $ref: string }).$ref
          : (rawRef as string | undefined);
      if (!ref) continue;
      const resolved = await resolveSchemaRef(ref);
      const title = String(resolved.jsonSchema.title ?? "").toLowerCase();
      if (
        candidates.length === 1 ||
        title.replace(/\s+/g, "-").includes(customSchemaBaseId.toLowerCase())
      ) {
        picked = { id: candidate.credential.id, schema: resolved.jsonSchema };
        break;
      }
    }
    if (!picked) {
      throw new Error(
        `None of the ${candidates.length} custom VTJSCs names "${customSchemaBaseId}"`
      );
    }
    vtjscId = picked.id;
    jsonSchema = picked.schema;
  }

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
  const credentialDefinitionId = await ensureCredentialType(client, vtjscId, title);

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
  vtjscId: string,
  name: string
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
    name,
    version: "1.0",
    relatedJsonSchemaCredentialId: vtjscId,
    supportRevocation: false,
  });
  console.log(
    `Created credential type: ${created.id}`
  );
  return created.id;
}
