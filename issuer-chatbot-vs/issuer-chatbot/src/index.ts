import express from "express";
import { loadConfig } from "./config";
import { VsAgentClient } from "./vs-agent-client";
import { discoverSchema } from "./schema-reader";
import { SessionStore } from "./session-store";
import { Chatbot } from "./chatbot";
import { createWebhookRouter } from "./webhooks";

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`Issuer Chatbot starting...`);
  console.log(`  VS-Agent URL : ${config.vsAgentAdminUrl}`);
  console.log(`  Chatbot port : ${config.chatbotPort}`);
  console.log(`  Service name : ${config.serviceName}`);
  console.log(`  AnonCreds    : ${config.enableAnoncreds}`);
  console.log(`  Database     : ${config.databaseUrl}`);

  // Wait for VS-Agent to be ready
  const client = new VsAgentClient(config);
  const agent = await client.waitForReady();
  console.log(`VS-Agent ready — DID: ${agent.publicDid}`);

  // Discover schema from organization-vs (schema owner)
  const orgConfig = { ...config, vsAgentAdminUrl: config.orgVsAdminUrl };
  const orgClient = new VsAgentClient(orgConfig);
  const customSchemaBaseId = process.env.CUSTOM_SCHEMA_BASE_ID || "example";
  const schema = await discoverSchema(client, customSchemaBaseId, orgClient);

  // Initialize session store
  const store = new SessionStore(config.databaseUrl);

  // Create chatbot
  const chatbot = new Chatbot(client, store, schema, config);

  // Start Express server with webhook routes
  const app = express();
  app.use(express.json());
  app.use("/", createWebhookRouter(chatbot));

  app.listen(config.chatbotPort, () => {
    console.log(`Issuer Chatbot listening on port ${config.chatbotPort}`);
    console.log(`Webhook endpoints:`);
    console.log(
      `  POST http://localhost:${config.chatbotPort}/connection-state-updated`
    );
    console.log(
      `  POST http://localhost:${config.chatbotPort}/message-received`
    );
    console.log(
      `  GET  http://localhost:${config.chatbotPort}/health`
    );
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("Shutting down...");
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
