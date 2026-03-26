# Verifier Chatbot Service

A conversational chatbot (via Hologram Messaging) that connects to a Verifier VS-Agent and requests credential presentations from users.

## How it works

1. A user connects via Hologram Messaging
2. The chatbot sends a proof request for the credential matching the custom schema
3. The user presents their credential from their wallet
4. The VS-Agent verifies the proof and sends the result to the chatbot
5. The chatbot displays the verified attributes back to the user

## Prerequisites

- Verifier VS-Agent running (Pattern 2 child service with Service credential from Issuer)
- Node.js 20+

## Local Usage

```bash
# Source configuration
source vs/config.env
source vs/verifier-chatbot.env

# Install dependencies
cd verifier-chatbot
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
| `VS_AGENT_ADMIN_URL` | `http://localhost:3000` | Verifier VS-Agent admin API URL |
| `CHATBOT_PORT` | `4002` | Webhook server port |
| `DATABASE_URL` | `sqlite:./data/sessions.db` | Session persistence |
| `SERVICE_NAME` | `Example Verana Service` | Contextual menu title |
| `CUSTOM_SCHEMA_BASE_ID` | `example` | Schema base ID for proof requests |
| `LOG_LEVEL` | `info` | Logging level |

## Docker

```bash
docker build -t verifier-chatbot .
docker run -p 4002:4002 \
  -e VS_AGENT_ADMIN_URL=http://host.docker.internal:3000 \
  verifier-chatbot
```
