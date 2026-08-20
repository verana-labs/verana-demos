# Verana Demos

Demo ecosystem with five Verifiable Services and an interactive playground, deployed via GitHub Actions to Kubernetes. Targets **Verana v0.10.1+** (the `co` / `ec` / `cs` / `pp` chain modules) and **VS Agent v4**, on devnet.

## Architecture

```
ecs-ecosystem            ← Shared ECS authority (verana-deploy, not this repo)
└── organization-vs      ← Parent organization (ECS credentials, own Ecosystem + schema)
    ├── issuer-chatbot-vs    ← Issues credentials via DIDComm chatbot
    ├── issuer-web-vs        ← Issues credentials via web form + QR code
    ├── verifier-chatbot-vs  ← Verifies credentials via DIDComm chatbot
    ├── verifier-web-vs      ← Verifies credentials via web page + QR code
    └── playground           ← Interactive tutorial that ties all services together
```

**Every service owns a Corporation.** `organization-vs` splits that across two accounts: the Corporation operator (`USER_ACC`) holds the blanket `OperatorAuthorization` and signs the setup transactions, and the agent has its own account (`AGENT_ACC`), the `vs_operator` of its Participant entries. The chain forbids one account from holding both, so they must be different accounts.

> The four child services still run on a single account and grant their participants no `vs_operator`. That works while their agents send no transactions of their own, but they must be split the same way before they can send `TriggerResolver` or `CreateOrUpdateParticipantSession`. Only `organization-vs` has been proven end-to-end on v4 so far.

**The agent reacts to chain events.** Scripts no longer drive credential issuance through the admin API. They create the on-chain objects and the Participant entries; the agent notices, publishes its VTJSCs, self-issues what it may, and answers the onboarding processes.

**organization-vs** plays two roles:

- a participant of the shared **ecs-ecosystem**, from which it obtains its own Organization and Service credentials. Its Organization credential comes from `ecs-org-issuer`, a third-party issuer — an Ecosystem agent cannot issue its own Ecosystem's credentials, because the chain grants the ECOSYSTEM role no `VSOperatorAuthorization`.
- the controller of its own **"example"** Ecosystem and credential schema, which the child services onboard against.

**Child services** run in `AGENT_MODE=delegated` against organization-vs, so `EcsBootstrapService` obtains their Service credential over DIDComm with no script action. They then:

- **Issuers** submit `StartParticipantOP(ISSUER)` against the "example" root. The DIDComm handshake runs by itself; organization-vs must then validate the pending request through its admin API.
- **Verifiers** self-create a VERIFIER participant (OPEN mode) — one transaction, no handshake, no validation.

All services discover the **AnonCreds credential definition** by querying `/resources?resourceType=anonCredsCredDef` on the public endpoint of the issuer.

## Services

| Service | Role | Agent mode | App Port |
|---------|------|-----------|----------|
| `organization-vs` | Parent org, Ecosystem controller | `standalone` | — |
| `issuer-chatbot-vs` | Issuer (chatbot) | `delegated` | 4000 |
| `issuer-web-vs` | Issuer (web) | `delegated` | 4001 |
| `verifier-chatbot-vs` | Verifier (chatbot) | `delegated` | 4002 |
| `verifier-web-vs` | Verifier (web) | `delegated` | 4003 |
| `playground` | Interactive tutorial | — | 3000 |

## Directory Structure

```
<service>/
  config.env            # All configuration for this service
  deployment.yaml       # Helm chart values for K8s deployment
  schema.json           # (organization-vs only) Custom credential schema
  scripts/
    setup.sh            # Full local setup (corporation, agent, participants)
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
| 1 | Deploy Organization VS | `bootstrap-corporation` · `deploy` · `validate-ecs-onboarding` · `create-example-ecosystem` · `all` |
| 2 | Deploy Issuer Chatbot VS | `bootstrap-corporation` · `deploy` · `onboard-issuer` · `deploy-chatbot` · `all` |
| 3 | Deploy Verifier Chatbot VS | `bootstrap-corporation` · `deploy` · `onboard-verifier` · `deploy-chatbot` · `all` |
| 4 | Deploy Issuer Web VS | `bootstrap-corporation` · `deploy` · `onboard-issuer` · `deploy-web` · `all` |
| 5 | Deploy Verifier Web VS | `bootstrap-corporation` · `deploy` · `onboard-verifier` · `deploy-web` · `all` |
| 6 | Deploy Playground | Build & deploy (single step) |

`bootstrap-corporation` and `deploy` are two steps because the agent needs `VERANA_CORPORATION_ID` at boot, but the Corporation only exists once the first step has run. The step prints the new id; put it in `config.env` before you deploy.

### Deployment

1. Create a branch: `vs/devnet-<name>`
2. Edit each service's `config.env` and `deployment.yaml` as needed
3. Run workflows **in order** from GitHub Actions (manual dispatch)

### Ingresses

- `<did-domain>` — VS Agent public endpoint (DID document, DIDComm, resources)
- `app.<did-domain>` — Web/chatbot application (child services)
- `playground.<vsname>.demos.<network>.verana.network` — Playground

## Local Development

### 1. Start organization-vs

The ECS Organization credential arrives from `ecs-org-issuer`, which runs in the `verana-deploy` cluster. Port-forward its admin API before you run the script, so step 4 can validate the pending onboarding request:

```bash
kubectl port-forward -n vna-devnet-1 svc/ecs-org-issuer 3101:3000
source organization-vs/config.env
MNEMONIC="..." AGENT_MNEMONIC="..." ./organization-vs/scripts/setup.sh
```

### 2. Start a child service (e.g., issuer-chatbot-vs)

```bash
source issuer-chatbot-vs/config.env
MNEMONIC="..." ./issuer-chatbot-vs/scripts/setup.sh
./issuer-chatbot-vs/scripts/start.sh
```

> **Note:** Only one ngrok tunnel can run at a time on the free plan. For local development with multiple services, deploy organization-vs to K8s first, then point child services to its public URL via `ORG_VS_PUBLIC_URL` and `ORG_VS_ADMIN_URL`.

### Checking a service

The indexer answers whether a service is trusted and lists the ECS credentials it holds:

```bash
curl -s -X POST https://idx.devnet.verana.network/v4/verifiable-trust/resolve \
  -H 'Content-Type: application/json' \
  -d '{"did":"<agent did>","ecsCredentials":true}' | jq
```

## Shared Code

- `common/common.sh` — Shared shell helpers: logging, network config, funding, transaction submission, group proposals, Corporation creation, Ecosystem / credential schema / root participant creation, `StartParticipantOP` and `SelfCreateParticipant`, participant and schema discovery, and the onboarding-flow validation calls (`validate_pending_flow`).

## Playground

The playground (`playground/`) is a Next.js + TailwindCSS single-page application that guides newcomers through the Verifiable Trust ecosystem. It lets users issue and present credentials in real time using the demo services above.

- **Framework:** Next.js (standalone output) + TailwindCSS
- **API proxies:** Server-side API routes forward requests to internal cluster services (issuer-chatbot, verifier-chatbot, verifier-web)
- **Issuer Web:** Opens in a new tab (the user fills a form, then scans the QR code generated on that page)
- **Deployment:** Workflow #6 builds a Docker image and deploys it to the same namespace as the other services

## Related

- [verana-deploy](https://github.com/verana-labs/verana-deploy) — the shared `ecs-ecosystem` and `ecs-org-issuer` deployments these demos depend on
- [vs-agent](https://github.com/verana-labs/vs-agent) — the agent every service runs
