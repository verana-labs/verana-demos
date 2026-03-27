export interface Config {
  vsAgentAdminUrl: string;
  orgVsAdminUrl: string;
  orgVsPublicUrl: string;
  chatbotPort: number;
  databaseUrl: string;
  serviceName: string;
  enableAnoncreds: boolean;
  logLevel: string;
}

export function loadConfig(): Config {
  return {
    vsAgentAdminUrl: process.env.VS_AGENT_ADMIN_URL || "http://localhost:3000",
    orgVsAdminUrl: process.env.ORG_VS_ADMIN_URL || process.env.VS_AGENT_ADMIN_URL || "http://localhost:3000",
    orgVsPublicUrl: process.env.ORG_VS_PUBLIC_URL || "",
    chatbotPort: parseInt(process.env.CHATBOT_PORT || "4000", 10),
    databaseUrl: process.env.DATABASE_URL || "sqlite:./data/sessions.db",
    serviceName: process.env.SERVICE_NAME || "Example Verana Service",
    enableAnoncreds: process.env.ENABLE_ANONCREDS !== "false",
    logLevel: process.env.LOG_LEVEL || "info",
  };
}
