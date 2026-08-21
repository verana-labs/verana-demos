import { VsAgentClient, VtjscEntry } from "./vs-agent-client";
import {
  discoverVtjscFromDidDocument,
  resolveSchemaRef,
} from "@verana-demos/vt-schema";

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
// Falls back to the admin API when no public URL is configured (fully local setup).
export async function discoverSchema(
  client: VsAgentClient,
  customSchemaBaseId: string,
  orgPublicUrl?: string,
  orgClient?: VsAgentClient,
  issuerPublicUrl?: string
): Promise<SchemaInfo> {
  let vtjscId: string;
  let jsonSchema: Record<string, unknown>;
  let credDefId: string | undefined;
  let schemaId: string | undefined;

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
    const candidates = vtjscList.data.filter((v: VtjscEntry) =>
      /schemas-\d+-jsc\.json$/.test(v.credential.id)
    );
    if (candidates.length === 0) {
      const availableIds = vtjscList.data.map((v: VtjscEntry) => v.credential.id);
      throw new Error(
        `No custom VTJSC found for base ID "${customSchemaBaseId}". ` +
          `Available VTJSCs: ${JSON.stringify(availableIds)}`
      );
    }

    let picked: { entry: VtjscEntry; schema: Record<string, unknown> } | undefined;
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
        picked = { entry: candidate, schema: resolved.jsonSchema };
        break;
      }
    }
    if (!picked) {
      throw new Error(
        `None of the ${candidates.length} custom VTJSCs names "${customSchemaBaseId}"`
      );
    }
    vtjscId = picked.entry.credential.id;
    jsonSchema = picked.schema;
    schemaId = picked.entry.schemaId;
    credDefId = (picked.entry as Record<string, unknown>)
      .credentialDefinitionId as string | undefined;
  }

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
    schemaId: schemaId || vtjscId.replace(/-jsc\.json$/, ""),
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
