export interface Config {
  vsAgentAdminUrl: string;
  verifierPort: number;
  serviceName: string;
  customSchemaBaseId: string;
  logLevel: string;
}

export function loadConfig(): Config {
  return {
    vsAgentAdminUrl: process.env.VS_AGENT_ADMIN_URL || "http://localhost:3000",
    verifierPort: parseInt(process.env.VERIFIER_PORT || "4001", 10),
    serviceName: process.env.SERVICE_NAME || "Example Verana Service",
    customSchemaBaseId: process.env.CUSTOM_SCHEMA_BASE_ID || "example",
    logLevel: process.env.LOG_LEVEL || "info",
  };
}
