# Issuer Chatbot Service

A conversational chatbot (via Hologram Messaging) that connects to the Issuer VS-Agent and issues credentials based on the custom schema.

## How it works

1. A user connects via Hologram Messaging
2. The chatbot reads the schema attributes from the VS-Agent
3. It prompts the user for each attribute one by one
4. Once all attributes are collected, it issues an AnonCreds credential via the VS-Agent
5. The credential is delivered to the user's wallet

## Prerequisites

- Issuer VS-Agent running and configured (with ECS credentials and Trust Registry)
- `ENABLE_ANONCREDS=true` in `vs/config.env`
- Node.js 20+

## Local Usage

```bash
# Source configuration
source vs/config.env
source vs/issuer-chatbot.env

# Install dependencies
cd issuer-chatbot
npm install

# Run in development mode
npm run dev

# Or build and run
npm run build
npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VS_AGENT_ADMIN_URL` | `http://localhost:3000` | Issuer VS-Agent admin API URL |
| `CHATBOT_PORT` | `4000` | Webhook server port |
| `DATABASE_URL` | `sqlite:./data/sessions.db` | Session persistence |
| `SERVICE_NAME` | `Example Verana Service` | Contextual menu title |
| `ENABLE_ANONCREDS` | `true` | Use AnonCreds format |
| `CUSTOM_SCHEMA_BASE_ID` | `example` | Schema base ID to discover |
| `LOG_LEVEL` | `info` | Logging level |

## Docker

```bash
docker build -t issuer-chatbot .
docker run -p 4000:4000 \
  -e VS_AGENT_ADMIN_URL=http://host.docker.internal:3000 \
  issuer-chatbot
```
