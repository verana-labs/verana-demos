# VS Demo — Deploy a Verifiable Service and Create a Trust Registry

This guide walks you through deploying a **Verifiable Service (VS) Agent** on the Verana network, obtaining ecosystem credentials, and creating your own Trust Registry.

## Overview

The demo is split into two parts:

1. **Part 1** (`01-deploy-vs.sh`) — Deploy a VS Agent, obtain an Organization credential from the ECS Trust Registry, and self-issue a Service credential.
2. **Part 2** (`02-create-trust-registry.sh`) — Create a Trust Registry for a custom credential schema, with optional AnonCreds support.

Both parts support **devnet** and **testnet** (identical ECS configuration).

## Prerequisites

- **Docker** with `linux/amd64` platform support
- **ngrok** — authenticated ([ngrok.com](https://ngrok.com))
- **veranad** — Verana blockchain CLI ([verana-blockchain](https://github.com/verana-labs/verana-blockchain))
- **curl**, **jq**

## Quick Start (Local)

### 1. Clone and configure

```bash
git clone https://github.com/verana-labs/verana-demos.git
cd verana-demos

# Copy the example config and edit it with your values
cp config/example-vs.env my-vs.env
# Edit my-vs.env — fill in organization, service, and schema details
```

### 2. Run Part 1 — Deploy VS and obtain ECS credentials

```bash
source my-vs.env
chmod +x scripts/vs-demo/*.sh
./scripts/vs-demo/01-deploy-vs.sh
```

This will:

- Pull and start a VS Agent container with an ngrok tunnel
- Clean up self-generated example items
- Set up a veranad CLI account (prompts for faucet funding if needed)
- Obtain an Organization credential from the ECS Trust Registry
- Self-create an ISSUER permission for the Service schema (OPEN mode)
- Self-issue a Service credential
- Link both credentials as Verifiable Presentations in the DID Document

Output: `vs-demo-ids.env` with all resource IDs.

### 3. Run Part 2 — Create a Trust Registry

```bash
source my-vs.env
./scripts/vs-demo/02-create-trust-registry.sh
```

This will:

- Create a Trust Registry on-chain for the VS Agent's DID
- Register a custom credential schema (default: `example.json`) with ECOSYSTEM issuer mode and OPEN verifier mode
- Create a root permission and obtain an ISSUER permission via the VP validation flow
- Create a VTJSC for the custom schema
- (Optional) Create an AnonCreds credential definition linked to the VTJSC

Output: Resource IDs appended to `vs-demo-ids.env`.

## Configuration Reference

### Network Variables

Set `NETWORK=devnet` or `NETWORK=testnet` (default: `testnet`). Network-specific variables (chain ID, RPC, fees, ECS TR URL) are set automatically.

### Part 1 Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ORG_NAME` | Yes | Organization name |
| `ORG_COUNTRY` | Yes | ISO country code |
| `ORG_LOGO_URL` | Yes | URL of the org logo (will be base64-encoded) |
| `ORG_REGISTRY_ID` | Yes | Business registry ID |
| `ORG_ADDRESS` | Yes | Physical address |
| `SERVICE_NAME` | Yes | Service name |
| `SERVICE_TYPE` | Yes | Service type (e.g., `CredentialIssuer`) |
| `SERVICE_DESCRIPTION` | Yes | Service description |
| `SERVICE_LOGO_URL` | Yes | URL of the service logo |
| `SERVICE_TERMS` | Yes | Terms and conditions URL |
| `SERVICE_PRIVACY` | Yes | Privacy policy URL |
| `CS_SERVICE_ID` | Yes | ECS Service schema ID (or provide `ECS_IDS_FILE`) |
| `ECS_IDS_FILE` | No | Path to ECS IDs env file |
| `VS_AGENT_IMAGE` | No | Docker image (default: `veranalabs/vs-agent:latest`) |
| `USER_ACC` | No | veranad account name (default: `vs-demo-admin`) |

### Part 2 Variables

| Variable | Required | Description |
| --- | --- | --- |
| `CUSTOM_SCHEMA_URL` | No | JSON schema URL (default: `example.json`) |
| `CUSTOM_SCHEMA_BASE_ID` | No | VTJSC base ID (default: `example`) |
| `EGF_DOC_URL` | Yes | Ecosystem Governance Framework URL |
| `EGF_DOC_DIGEST` | Yes | SHA-384 SRI digest of the EGF document |
| `ENABLE_ANONCREDS` | No | `true` to create AnonCreds cred def (default: `false`) |
| `ANONCREDS_NAME` | No | AnonCreds cred def name |
| `ANONCREDS_VERSION` | No | AnonCreds cred def version |

See `config/example-vs.env` for the complete list with defaults.

## CI/CD Usage (GitHub Actions)

Fork this repository and use the `deploy-vs-demo.yml` workflow:

1. **Add secrets** to your fork:
   - `OVH_KUBECONFIG` — kubeconfig for the target K8s cluster (plain text)
   - `VS_DEMO_MNEMONIC` — BIP-39 mnemonic for the veranad account

2. **Trigger the workflow** from the Actions tab with your desired inputs (environment, schema URL, organization details, etc.).

The workflow deploys a VS Agent via Helm chart and runs both scripts against it.

## Architecture

```text
┌─────────────────────┐         ┌─────────────────────────┐
│   Your VS Agent     │         │   ECS Trust Registry    │
│   (Docker + ngrok)  │◄───────►│   (on-chain + VS Agent) │
│                     │  issue  │                         │
│  • did:webvh DID    │  org    │  • Org schema (ECOSYSTEM)│
│  • Org VP (linked)  │  cred   │  • Service schema (OPEN) │
│  • Service VP       │         │                         │
│  • Custom VTJSC     │         └─────────────────────────┘
│  • (AnonCreds)      │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│   Verana Blockchain  │
│   (VPR)             │
│                     │
│  • Trust Registry   │
│  • Custom Schema    │
│  • Root Permission  │
│  • Issuer Permission│
└─────────────────────┘
```

## Cleanup

```bash
# Stop the VS Agent
docker rm -f vs-demo

# Kill ngrok
pkill -f "ngrok http 3001"

# Remove data
rm -rf vs-agent-demo-data vs-demo-ids.env
```
