export interface Config {
  vsAgentAdminUrl: string;
  orgVsAdminUrl: string;
  orgVsPublicUrl: string;
  issuerVsPublicUrl: string;
  verifierPort: number;
  serviceName: string;
  customSchemaBaseId: string;
  logLevel: string;
}

export function loadConfig(): Config {
  return {
    vsAgentAdminUrl: process.env.VS_AGENT_ADMIN_URL || "http://localhost:3000",
    orgVsAdminUrl: process.env.ORG_VS_ADMIN_URL || process.env.VS_AGENT_ADMIN_URL || "http://localhost:3000",
    orgVsPublicUrl: process.env.ORG_VS_PUBLIC_URL || "",
    issuerVsPublicUrl: process.env.ISSUER_VS_PUBLIC_URL || "http://localhost:3005",
    verifierPort: parseInt(process.env.VERIFIER_PORT || "4001", 10),
    serviceName: process.env.SERVICE_NAME || "Example Verana Service",
    customSchemaBaseId: process.env.CUSTOM_SCHEMA_BASE_ID || "example",
    logLevel: process.env.LOG_LEVEL || "info",
  };
}
