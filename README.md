# Verana Demos

Demo ecosystem with five Verifiable Services and an interactive playground, deployed via GitHub Actions to Kubernetes.

## Architecture

```
organization-vs          ← Parent organization (ECS credentials, Trust Registry, schema)
├── issuer-chatbot-vs    ← Issues credentials via DIDComm chatbot
├── issuer-web-vs        ← Issues credentials via web form + QR code
├── verifier-chatbot-vs  ← Verifies credentials via DIDComm chatbot
├── verifier-web-vs      ← Verifies credentials via web page + QR code
└── playground           ← Interactive tutorial that ties all services together
```

**organization-vs** is the parent: it obtains Organization + Service credentials from the ECS Trust Registry, creates its own Trust Registry with a custom schema, and registers an AnonCreds credential definition.

Child services obtain a **Service credential** from organization-vs, then:
- **Issuers** obtain an ISSUER permission (VP flow) for the organization-vs schema
- **Verifiers** self-create a VERIFIER permission (OPEN mode)

All services discover the **AnonCreds credential definition** by querying `/resources?resourceType=anonCredsCredDef` on the public endpoint of organization-vs.

## Services

| Service | Role | App Port |
|---------|------|----------|
| `organization-vs` | Parent org | — |
| `issuer-chatbot-vs` | Issuer (chatbot) | 4000 |
| `issuer-web-vs` | Issuer (web) | 4001 |
| `verifier-chatbot-vs` | Verifier (chatbot) | 4002 |
| `verifier-web-vs` | Verifier (web) | 4003 |
| `playground` | Interactive tutorial | 3000 |

## Directory Structure

```
<service>/
  config.env            # All configuration for this service
  deployment.yaml       # Helm chart values for K8s deployment
  ids.env               # Persisted IDs (credential def, schema, etc.)
  schema.json           # (organization-vs only) Custom credential schema
  data/                 # Claim data for credential issuance
  scripts/
    setup.sh            # Full local setup (deploy agent, get credentials, etc.)
    start.sh            # Start the application (child services only)
  docker/
    docker-compose.yml  # Local dev containers (VS Agent + app)
  <app>/                # Application source (TypeScript, child services only)
    src/
    Dockerfile
    package.json
    tsconfig.json
```

## GitHub Actions Workflows

Workflows are numbered to indicate deployment order. **Run them in order** when setting up a new ecosystem.

| # | Workflow | Steps |
|---|---------|-------|
| 1 | Deploy Organization VS | `deploy` · `get-ecs-credentials` · `create-trust-registry` · `all` |
| 2 | Deploy Issuer Chatbot VS | `deploy` · `get-credentials` · `deploy-chatbot` · `all` |
| 3 | Deploy Verifier Chatbot VS | `deploy` · `get-credentials` · `deploy-chatbot` · `all` |
| 4 | Deploy Issuer Web VS | `deploy` · `get-credentials` · `deploy-web` · `all` |
| 5 | Deploy Verifier Web VS | `deploy` · `get-credentials` · `deploy-web` · `all` |
| 6 | Deploy Playground | Build & deploy (single step) |

### Deployment

1. Create a branch: `vs/testnet-<name>` or `vs/devnet-<name>`
2. Edit each service's `config.env` and `deployment.yaml` as needed
3. Run workflows **in order** from GitHub Actions (manual dispatch)

### Ingresses

- `<did-domain>` — VS Agent public endpoint (DID document, DIDComm, resources)
- `app.<did-domain>` — Web/chatbot application (child services)
- `playground.<vsname>.demos.<network>.verana.network` — Playground

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

## Shared Code

- `common/common.sh` — Shared shell helpers (logging, network config, VS Agent API, schema discovery, credential issuance/linking, CLI account setup)

## Playground

The playground (`playground/`) is a Next.js + TailwindCSS single-page application that guides newcomers through the Verifiable Trust ecosystem. It lets users issue and present credentials in real time using the demo services above.

- **Framework:** Next.js (standalone output) + TailwindCSS
- **API proxies:** Server-side API routes forward requests to internal cluster services (issuer-chatbot, verifier-chatbot, verifier-web)
- **Issuer Web:** Opens in a new tab (the user fills a form, then scans the QR code generated on that page)
- **Deployment:** Workflow #6 builds a Docker image and deploys it to the same namespace as the other services

See [`spec-playground.md`](spec-playground.md) for the full specification.
