export interface Config {
  vsAgentAdminUrl: string;
  orgVsAdminUrl: string;
  issuerPort: number;
  serviceName: string;
  customSchemaBaseId: string;
  enableAnoncreds: boolean;
  logLevel: string;
}

export function loadConfig(): Config {
  return {
    vsAgentAdminUrl: process.env.VS_AGENT_ADMIN_URL || "http://localhost:3000",
    orgVsAdminUrl: process.env.ORG_VS_ADMIN_URL || process.env.VS_AGENT_ADMIN_URL || "http://localhost:3000",
    issuerPort: parseInt(process.env.ISSUER_WEB_PORT || process.env.PORT || "4001", 10),
    serviceName: process.env.SERVICE_NAME || "Example Issuer Web App",
    customSchemaBaseId: process.env.CUSTOM_SCHEMA_BASE_ID || "example",
    enableAnoncreds: process.env.ENABLE_ANONCREDS !== "false",
    logLevel: process.env.LOG_LEVEL || "info",
  };
}
