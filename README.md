# Verana Demos — Reorganized Structure

This directory contains five demo services following **Pattern 2** (separate organization + child services).

## Architecture

```
organization-vs (parent)
├── issuer-chatbot-vs (child — issuer)
├── issuer-web-vs    (child — issuer)
├── verifier-chatbot-vs (child — verifier)
└── verifier-web-vs     (child — verifier)
```

The **organization-vs** service is the parent: it obtains Organization + Service credentials from the ECS Trust Registry, creates its own Trust Registry with a custom schema, and creates an AnonCreds credential definition.

Child services obtain a **Service credential** from organization-vs, then:
- **Issuers** obtain an ISSUER permission (VP flow) for the organization-vs schema
- **Verifiers** self-create a VERIFIER permission (OPEN mode)

All services discover the **AnonCreds credential definition** by querying `/resources?resourceType=anonCredsCredDef` on the PUBLIC endpoint of organization-vs.

## Services

| Service | Role | Port (admin) | Port (public) | App Port |
|---------|------|-------------|---------------|----------|
| `organization-vs` | Parent org | 3000 | 3001 | — |
| `issuer-chatbot-vs` | Issuer (chatbot) | 3002 | 3003 | 4000 |
| `issuer-web-vs` | Issuer (web) | 3004 | 3005 | 4001 |
| `verifier-chatbot-vs` | Verifier (chatbot) | 3006 | 3007 | 4002 |
| `verifier-web-vs` | Verifier (web) | 3008 | 3009 | 4003 |

## Directory Structure (per service)

```
<service>/
  config.env          # All configuration for this service
  deployment.yaml     # Helm chart values for K8s deployment
  schema.json         # (organization-vs only) Custom credential schema
  scripts/
    setup.sh          # Full local setup (deploy agent, get credentials, etc.)
    start.sh          # Start the application (child services only)
  docker/
    docker-compose.yml  # Local dev containers (vs-agent + app)
  <app>/              # Application source code (child services only)
```

## Local Development

### 1. Start organization-vs

```bash
source organization-vs/config.env
./organization-vs/scripts/setup.sh
```

### 2. Start a child service (e.g., issuer-chatbot-vs)

```bash
source issuer-chatbot-vs/config.env
./issuer-chatbot-vs/scripts/setup.sh
./issuer-chatbot-vs/scripts/start.sh
```

> **Note:** Only one ngrok tunnel can run at a time on the free plan. For local development with multiple services, deploy organization-vs to K8s first, then point child services to its public URL via `ORG_VS_PUBLIC_URL` and `ORG_VS_ADMIN_URL`.

## K8s Deployment (via GitHub Actions)

1. Create a branch: `vs/testnet-<name>` or `vs/devnet-<name>`
2. Edit the service's `config.env` and `deployment.yaml`
3. Run the workflow from GitHub Actions (manual dispatch)

### Ingresses

- `/` — VS Agent public endpoint (DID document, DIDComm, resources)
- `app.<did-domain>` — Web application (for web services)

## Shared Code

- `common/common.sh` — Shared helper functions (logging, network config, transaction helpers, VS Agent API helpers, schema helpers, credential issuance/linking, CLI account setup)
