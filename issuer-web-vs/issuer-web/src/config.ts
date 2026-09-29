export interface Config {
  vsAgentAdminUrl: string;
  orgVsPublicUrl: string;
  orgVsLocalPublicUrl: string;
  issuerPort: number;
  serviceName: string;
  customSchemaBaseId: string;
  enableAnoncreds: boolean;
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
    issuerPort: parseInt(process.env.ISSUER_WEB_PORT || process.env.PORT || "4001", 10),
    serviceName: process.env.SERVICE_NAME || "Example Issuer Web App",
    customSchemaBaseId: process.env.CUSTOM_SCHEMA_BASE_ID || "example",
    enableAnoncreds: process.env.ENABLE_ANONCREDS !== "false",
    logLevel: process.env.LOG_LEVEL || "info",
  };
}
