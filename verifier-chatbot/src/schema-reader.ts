import { VsAgentClient, VtjscEntry } from "./vs-agent-client";

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
  customSchemaBaseId: string
): Promise<SchemaInfo> {
  const vtjscList = await client.getJsonSchemaCredentials();

  // Find the custom VTJSC — the one whose id contains the custom schema base ID
  const customVtjsc = vtjscList.data.find(
    (v: VtjscEntry) =>
      v.id.includes(`/${customSchemaBaseId}/`) ||
      v.id.endsWith(`/${customSchemaBaseId}`)
  );

  if (!customVtjsc) {
    const availableIds = vtjscList.data.map((v: VtjscEntry) => v.id);
    throw new Error(
      `Custom VTJSC not found for base ID "${customSchemaBaseId}". ` +
        `Available VTJSCs: ${JSON.stringify(availableIds)}`
    );
  }

  // Fetch the JSON schema to extract attributes for proof request
  const schemaUrl = customVtjsc.credentialSubject?.jsonSchema;
  if (!schemaUrl) {
    throw new Error(
      `VTJSC ${customVtjsc.id} has no credentialSubject.jsonSchema`
    );
  }

  const schemaResponse = await fetch(schemaUrl);
  if (!schemaResponse.ok) {
    throw new Error(
      `Failed to fetch schema from ${schemaUrl}: ${schemaResponse.status}`
    );
  }
  const schema = (await schemaResponse.json()) as Record<string, unknown>;

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
    vtjscId: customVtjsc.id,
    schemaId: customVtjsc.schemaId,
    title,
    attributes,
    credentialDefinitionId: credDefId,
  };
}
