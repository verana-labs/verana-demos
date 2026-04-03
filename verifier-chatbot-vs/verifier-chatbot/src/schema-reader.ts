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
  let schemaUrl: string;
  let credDefId: string | undefined;
  let schemaId: string | undefined;

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
    schemaId = customVtjsc.schemaId;
    credDefId = (customVtjsc as Record<string, unknown>)
      .credentialDefinitionId as string | undefined;
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
