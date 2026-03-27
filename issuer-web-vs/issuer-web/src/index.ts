import express from "express";
import { loadConfig } from "./config";
import { VsAgentClient } from "./vs-agent-client";
import { discoverSchema } from "./schema-reader";
import { SessionStore } from "./session-store";
import { createRoutes } from "./routes";

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`Issuer Web starting...`);
  console.log(`  VS-Agent URL : ${config.vsAgentAdminUrl}`);
  console.log(`  Issuer port  : ${config.issuerPort}`);
  console.log(`  Service name : ${config.serviceName}`);
  console.log(`  Schema base  : ${config.customSchemaBaseId}`);
  console.log(`  AnonCreds    : ${config.enableAnoncreds}`);

  // Wait for VS-Agent to be ready
  const client = new VsAgentClient(config);
  const agent = await client.waitForReady();
  console.log(`VS-Agent ready — DID: ${agent.publicDid}`);

  // Discover schema from organization-vs (schema owner)
  const orgPublicUrl = config.orgVsPublicUrl || undefined;
  const orgClient = orgPublicUrl
    ? undefined
    : new VsAgentClient({ ...config, vsAgentAdminUrl: config.orgVsAdminUrl });
  const schema = await discoverSchema(
    client,
    config.customSchemaBaseId,
    orgPublicUrl,
    orgClient
  );

  // Initialize in-memory session store
  const store = new SessionStore();

  // Start Express server
  const app = express();
  app.use(express.json());
  app.use("/", createRoutes(client, schema, store, config));

  app.listen(config.issuerPort, () => {
    console.log(`Issuer Web listening on port ${config.issuerPort}`);
    console.log(`  Open http://localhost:${config.issuerPort} in your browser`);
    console.log(`Webhook endpoint:`);
    console.log(
      `  POST http://localhost:${config.issuerPort}/webhooks/message-received`
    );
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("Shutting down...");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
