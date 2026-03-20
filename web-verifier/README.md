# Web Verifier Service

A mini website that displays a QR code containing an OOB (Out-of-Band) presentation request. The user scans the QR code with Hologram Messaging, presents a credential, and the verified attributes are displayed on the website.

## How it works

1. User opens the web verifier URL in a browser
2. The page displays a QR code encoding an OOB presentation request
3. User scans the QR code with Hologram Messaging and presents their credential
4. The VS-Agent verifies the presentation and sends a webhook to the backend
5. The frontend polls for results and displays the verified attributes

## Prerequisites

- Verifier VS-Agent running (Pattern 2 child service with Service credential from Issuer)
- Node.js 20+

## Local Usage

```bash
# Source configuration
source vs/config.env
source vs/web-verifier.env

# Install dependencies
cd web-verifier
npm install

# Run in development mode
npm run dev

# Or build and run
npm run build
npm start
```

Then open http://localhost:4001 in your browser.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VS_AGENT_ADMIN_URL` | `http://localhost:3000` | Verifier VS-Agent admin API URL |
| `VERIFIER_PORT` | `4001` | Web server port |
| `SERVICE_NAME` | `Example Verana Service` | Page header title |
| `CUSTOM_SCHEMA_BASE_ID` | `example` | Schema base ID for proof requests |
| `LOG_LEVEL` | `info` | Logging level |

## Docker

```bash
docker build -t web-verifier .
docker run -p 4001:4001 \
  -e VS_AGENT_ADMIN_URL=http://host.docker.internal:3000 \
  web-verifier
```
