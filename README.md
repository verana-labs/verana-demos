# Verana Demos — Deploy a Verifiable Service and Create a Trust Registry

Deploy a **Verifiable Service (VS) Agent** on the Verana network, obtain ecosystem credentials, create your own Trust Registry, and run demo services for credential issuance and verification.

## Overview

The demo includes:

1. **Issuer VS-Agent** — Deploy a VS Agent, obtain ECS credentials, create a Trust Registry with a custom schema.
2. **Issuer Chatbot** — DIDComm chatbot that collects attributes and issues AnonCreds credentials via the Issuer VS-Agent.
3. **Web Verifier** — Website with QR code for OOB presentation requests; displays verified credential attributes.
4. **Verifier Chatbot** — DIDComm chatbot that requests and verifies credential presentations via a Verifier VS-Agent.

All services support **devnet** and **testnet**.

## Repository Structure

```text
vs/
├── deployment.yaml        # Helm chart values for VS-Agent
├── config.env             # Shared configuration (org, service, TR, AnonCreds)
├── schema.json            # JSON schema for the Trust Registry
├── issuer-chatbot.env     # Issuer Chatbot configuration
├── web-verifier.env       # Web Verifier configuration
└── verifier-chatbot.env   # Verifier Chatbot configuration
issuer-chatbot/            # Issuer Chatbot Service (TypeScript)
web-verifier/              # Web Verifier Service (TypeScript + inline frontend)
verifier-chatbot/          # Verifier Chatbot Service (TypeScript)
scripts/
├── vs-demo/
│   ├── common.sh                    # Shared helpers
│   ├── 01-deploy-vs.sh              # Deploy VS Agent (local)
│   ├── 02-get-ecs-credentials.sh    # Obtain ECS credentials (local)
│   └── 03-create-trust-registry.sh  # Create Trust Registry (local)
├── issuer-chatbot/start.sh          # Start Issuer Chatbot locally
├── web-verifier/start.sh            # Start Web Verifier locally
└── verifier-chatbot/start.sh        # Start Verifier Chatbot locally
docker-compose.yml         # Local orchestration of all services
```

## Local Usage (Docker + ngrok)

### Local prerequisites

- **Docker** with `linux/amd64` platform support
- **ngrok** — authenticated ([ngrok.com](https://ngrok.com))
- **veranad** — Verana blockchain CLI
- **Node.js 20+** and **npm** (for chatbot and web verifier services)
- **curl**, **jq**

### Quick start — VS Agent only

```bash
git clone https://github.com/verana-labs/verana-demos.git
cd verana-demos

# Edit vs/config.env with your values
source vs/config.env
chmod +x scripts/vs-demo/*.sh

# Step 1: Deploy VS Agent (Docker + ngrok)
./scripts/vs-demo/01-deploy-vs.sh

# Step 2: Obtain Organization + Service credentials from ECS TR
./scripts/vs-demo/02-get-ecs-credentials.sh

# Step 3: Create Trust Registry with custom schema
./scripts/vs-demo/03-create-trust-registry.sh
```

### Quick start — All services (Docker Compose)

```bash
export NGROK_DOMAIN=your-domain.ngrok-free.app
export SERVICE_NAME="My Verana Service"
docker compose up --build
```

This starts all five services: Issuer VS-Agent, Issuer Chatbot, Verifier VS-Agent, Web Verifier, and Verifier Chatbot.

### Running individual services locally

Each service has its own start script. Source the config files first, then run:

```bash
source vs/config.env

# Issuer Chatbot (port 4000)
source vs/issuer-chatbot.env
./scripts/issuer-chatbot/start.sh

# Web Verifier (port 4001)
source vs/web-verifier.env
./scripts/web-verifier/start.sh

# Verifier Chatbot (port 4002)
source vs/verifier-chatbot.env
./scripts/verifier-chatbot/start.sh
```

See each service's `README.md` for details.

## CI/CD Usage (GitHub Actions)

### Prerequisites

1. **Fork** the repository to your own GitHub account or organization.

2. Add these **secrets** to the forked repository:
   - `OVH_KUBECONFIG` — kubeconfig for the target K8s cluster (plain text)
   - `VS_DEMO_MNEMONIC` — BIP-39 mnemonic for the veranad account

### Deploy a new service

1. **Create a branch** from `main` named `vs/<network>-<service-name>`:

   ```bash
   # Deploy to testnet
   git checkout -b vs/testnet-my-issuer

   # Deploy to devnet
   git checkout -b vs/devnet-my-issuer
   ```

   The **network** (`testnet` or `devnet`) is derived from the branch name.

2. **Customize** the files in `vs/`:
   - `deployment.yaml` — Set `name`, ingress host, etc. (`__NETWORK__` placeholders are resolved automatically).
   - `config.env` — Set org details, service details, schema base ID, EGF URL, etc.
   - `schema.json` — Replace with your custom credential schema.

3. **Push** the branch and **run the workflow** from the Actions tab:
   - Select your `vs/testnet-my-issuer` branch
   - Choose a step: `deploy`, `get-ecs-credentials`, `create-trust-registry`, or `all`

The workflow:

- Extracts the network and service name from the branch (`vs/testnet-my-issuer` → testnet + my-issuer)
- Resolves `__NETWORK__` placeholders in `vs/deployment.yaml`
- Reads all configuration from `vs/config.env`
- Deploys the VS Agent via Helm using `vs/deployment.yaml`
- Accesses the admin API via `kubectl port-forward` (same pattern as verana-deploy)
- Registers the schema from `vs/schema.json` on-chain

### Workflows

| Workflow | File | Description |
| --- | --- | --- |
| Deploy VS Demo | `deploy-vs-demo.yml` | Deploy Issuer VS-Agent, get ECS credentials, create Trust Registry |
| Deploy Issuer Chatbot | `deploy-issuer-chatbot.yml` | Build + deploy Issuer Chatbot, configure VS-Agent events URL |
| Deploy Web Verifier | `deploy-web-verifier.yml` | Build + deploy Web Verifier with embedded Verifier VS-Agent |
| Deploy Verifier Chatbot | `deploy-verifier-chatbot.yml` | Build + deploy Verifier Chatbot with embedded Verifier VS-Agent |

## Configuration Reference

All configuration lives in `vs/config.env`. See that file for the complete list with defaults and documentation.

### Key variables

| Variable | Default | Description |
| --- | --- | --- |
| `NETWORK` | *(from branch)* | Derived from branch name (`vs/testnet-*` or `vs/devnet-*`) |
| `ORG_NAME` | `Verana Example Organization` | Organization name |
| `ORG_COUNTRY` | `CH` | ISO country code |
| `ORG_LOGO_URL` | `https://verana.io/logo.svg` | Org logo (downloaded + base64 at runtime) |
| `SERVICE_NAME` | `Example Verana Service` | Service name |
| `SERVICE_TYPE` | `IssuerService` | Service type |
| `CUSTOM_SCHEMA_BASE_ID` | `example` | VTJSC base ID |
| `EGF_DOC_URL` | governance-docs EGF | EGF URL (digest auto-calculated) |
| `ENABLE_ANONCREDS` | `true` | Enable dual W3C + AnonCreds issuance |

## Architecture

```text
                              ┌─────────────────────────┐
                              │   ECS Trust Registry    │
                              │   (on-chain + VS Agent) │
                              └────────────┬────────────┘
                                           │ issue org + svc creds
                 ┌─────────────────────────┼─────────────────────────┐
                 ▼                         │                         ▼
┌──────────────────────────┐               │        ┌──────────────────────────┐
│  Issuer VS-Agent         │               │        │  Verifier VS-Agent       │
│  (Organization)          │               │        │  (Child Service)         │
│                          │               │        │                          │
│  • did:webvh DID         │  issue svc    │        │  • did:webvh DID         │
│  • Org VP, Service VP    │  credential   │        │  • Service VP (linked)   │
│  • Custom VTJSC          │◄──────────────┘        │  • Proof verification    │
│  • AnonCreds cred def    │                        └────────┬─────┬──────────┘
└────────────┬─────────────┘                                 │     │
             │ webhooks                          webhooks     │     │ webhooks
             ▼                                               ▼     ▼
┌──────────────────────────┐        ┌────────────────┐  ┌──────────────────────┐
│  Issuer Chatbot          │        │  Web Verifier  │  │  Verifier Chatbot    │
│  (port 4000)             │        │  (port 4001)   │  │  (port 4002)         │
│                          │        │                │  │                      │
│  • Collect attributes    │        │  • QR code     │  │  • Request proof     │
│  • Issue AnonCreds cred  │        │  • OOB invite  │  │  • Display attributes│
│  • DIDComm messaging     │        │  • Poll result │  │  • DIDComm messaging │
└──────────────────────────┘        └────────────────┘  └──────────────────────┘
```

## Services

| Service | Port | Description |
| --- | --- | --- |
| Issuer VS-Agent | 3000 (admin), 3001 (DIDComm) | Organization VS-Agent — issues credentials |
| Issuer Chatbot | 4000 | DIDComm chatbot — collects attributes, issues AnonCreds credentials |
| Verifier VS-Agent | 3000 (admin), 3001 (DIDComm) | Child VS-Agent — verifies presentations |
| Web Verifier | 4001 | Web UI with QR code for OOB proof requests |
| Verifier Chatbot | 4002 | DIDComm chatbot — requests and verifies credential presentations |

## Cleanup

### Docker Compose

```bash
docker compose down -v
```

### K8s

```bash
helm uninstall <release-name> -n <namespace>
```

### Local (Docker + ngrok)

```bash
docker rm -f vs-demo
pkill -f "ngrok http 3001"
rm -rf vs-agent-demo-data vs-demo-ids.env
```
