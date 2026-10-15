export interface Config {
  vsAgentAdminUrl: string;
  orgVsPublicUrl: string;
  orgVsLocalPublicUrl: string;
  issuerVsPublicUrl: string;
  verifierPort: number;
  serviceName: string;
  customSchemaBaseId: string;
  logLevel: string;
}

export function loadConfig(): Config {
  // A local setup has no public ingress for organization-vs. The demo scripts read
  // its DID document on localhost at ORG_VS_PUBLIC_PORT, so this application agrees
  // with them. An unset port gives an empty URL, and the schema discovery then
  // reports which variable the operator must set.
  const orgVsPublicPort = process.env.ORG_VS_PUBLIC_PORT;

  return {
    vsAgentAdminUrl: process.env.VS_AGENT_ADMIN_URL || "http://localhost:3000",
    orgVsPublicUrl: process.env.ORG_VS_PUBLIC_URL || "",
    orgVsLocalPublicUrl: orgVsPublicPort
      ? `http://localhost:${orgVsPublicPort}`
      : "",
    issuerVsPublicUrl: process.env.ISSUER_VS_PUBLIC_URL || "http://localhost:3005",
    verifierPort: parseInt(process.env.VERIFIER_PORT || "4003", 10),
    serviceName: process.env.SERVICE_NAME || "Example Verana Service",
    customSchemaBaseId: process.env.CUSTOM_SCHEMA_BASE_ID || "example",
    logLevel: process.env.LOG_LEVEL || "info",
  };
}
