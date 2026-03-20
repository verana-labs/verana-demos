export interface Config {
  vsAgentAdminUrl: string;
  chatbotPort: number;
  databaseUrl: string;
  serviceName: string;
  logLevel: string;
}

export function loadConfig(): Config {
  return {
    vsAgentAdminUrl: process.env.VS_AGENT_ADMIN_URL || "http://localhost:3000",
    chatbotPort: parseInt(process.env.CHATBOT_PORT || "4002", 10),
    databaseUrl: process.env.DATABASE_URL || "sqlite:./data/sessions.db",
    serviceName: process.env.SERVICE_NAME || "Example Verana Service",
    logLevel: process.env.LOG_LEVEL || "info",
  };
}
