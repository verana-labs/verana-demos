# Verana Demos — Deploy a Verifiable Service and Create a Trust Registry

Deploy a **Verifiable Service (VS) Agent** on the Verana network, obtain ecosystem credentials, and create your own Trust Registry.

## Overview

The demo is split into three steps:

1. **Step 1 — Deploy VS Agent** — Start a VS Agent locally (Docker + ngrok) or via Helm (CI/CD).
2. **Step 2 — Get ECS Credentials** — Obtain an Organization credential from the ECS Trust Registry and self-issue a Service credential.
3. **Step 3 — Create Trust Registry** — Create a Trust Registry with a custom credential schema, with optional AnonCreds support.

All steps support **devnet** and **testnet** (identical ECS configuration).

## Repository Structure

```text
vs/
├── deployment.yaml   # Helm chart values (same format as verana-deploy)
├── config.env        # All configuration (org, service, TR, AnonCreds)
└── schema.json       # JSON schema for the Trust Registry
scripts/vs-demo/
├── common.sh                    # Shared helpers
├── 01-deploy-vs.sh              # Step 1: Deploy VS Agent (local)
├── 02-get-ecs-credentials.sh    # Step 2: Obtain ECS credentials (local)
└── 03-create-trust-registry.sh  # Step 3: Create Trust Registry (local)
```

## Local Usage (Docker + ngrok)

### Local prerequisites

- **Docker** with `linux/amd64` platform support
- **ngrok** — authenticated ([ngrok.com](https://ngrok.com))
- **veranad** — Verana blockchain CLI
- **curl**, **jq**

### Quick start

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

### Workflow steps

| Step | Description |
| --- | --- |
| `deploy` | Install/upgrade VS Agent via Helm only |
| `get-ecs-credentials` | Obtain Organization + Service credentials from ECS TR |
| `create-trust-registry` | Create Trust Registry, schema, permissions, VTJSC, optional AnonCreds |
| `all` | Run all steps in sequence |

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
| `ENABLE_ANONCREDS` | `false` | Enable dual W3C + AnonCreds issuance |

## Architecture

```text
┌─────────────────────┐         ┌─────────────────────────┐
│   Your VS Agent     │         │   ECS Trust Registry    │
│   (K8s / Docker)    │◄───────►│   (on-chain + VS Agent) │
│                     │  issue  │                         │
│  • did:webvh DID    │  org    │ • Org schema (ECOSYSTEM)│
│  • Org VP (linked)  │  cred   │ • Service schema (OPEN) │
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
