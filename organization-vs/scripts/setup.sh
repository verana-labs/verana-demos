#!/usr/bin/env bash
# =============================================================================
# Organization VS — Local Setup (Verana v0.10.1+, devnet only)
# =============================================================================
#
# This script sets up the Organization VS Agent locally:
#   1. Creates organization-vs's own Corporation and grants it operator
#      authorization (verana.co.v1 / verana.de.v1)
#   2. Deploys the VS Agent via Docker + ngrok, bound to that Corporation
#   3. Assigns the agent its Participant entries: a HOLDER entry on the ECS
#      Organization schema and an ISSUER entry on the ECS Service schema
#   4. Validates the pending HOLDER onboarding request on the ECS
#      Organization credential issuer, which then delivers the credential
#   5. Creates organization-vs's own "example" Ecosystem, credential schema
#      and root participant, for issuer-*/verifier- demo services to
#      onboard against
#
# Idempotent: checks for existing resources before creating new ones.
#
# ---------------------------------------------------------------------------
# Two accounts, two roles
# ---------------------------------------------------------------------------
# MNEMONIC       — the Corporation operator. It holds the blanket
#                  OperatorAuthorization and signs every transaction here.
#                  The agent never sees it.
# AGENT_MNEMONIC — the agent's own and only account. It is the vs_operator of
#                  the Participant entries step 3 assigns, and it holds no
#                  OperatorAuthorization. The chain forbids one account from
#                  holding both, so these MUST be different accounts.
#
# Prerequisites:
#   - Docker, ngrok (authenticated), curl, jq, veranad, kubectl
#   - MNEMONIC (or ORGANIZATION_VS_MNEMONIC) and AGENT_MNEMONIC (or
#     ORGANIZATION_VS_AGENT_MNEMONIC) — two funded devnet accounts
#   - kubectl access to the cluster running verana-deploy's ecs-org-issuer
#     release (for step 4) — port-forward it before running this script:
#       kubectl port-forward -n vna-devnet-1 svc/ecs-org-issuer 3101:3000
#
# Usage:
#   source organization-vs/config.env
#   MNEMONIC="..." AGENT_MNEMONIC="..." ./organization-vs/scripts/setup.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SERVICE_DIR/.." && pwd)"

# shellcheck source=../common/common.sh
source "${REPO_ROOT}/common/common.sh"

# ---------------------------------------------------------------------------
# Configuration — override via environment or config.env
# ---------------------------------------------------------------------------

NETWORK="${NETWORK:-devnet}"
VS_AGENT_IMAGE="${VS_AGENT_IMAGE:-veranalabs/vs-agent:v2.0.0-dev.27}"
VS_AGENT_CONTAINER_NAME="${VS_AGENT_CONTAINER_NAME:-organization-vs}"
VS_AGENT_ADMIN_PORT="${VS_AGENT_ADMIN_PORT:-3000}"
VS_AGENT_PUBLIC_PORT="${VS_AGENT_PUBLIC_PORT:-3001}"
VS_AGENT_DATA_DIR="${VS_AGENT_DATA_DIR:-${SERVICE_DIR}/data}"
USER_ACC="${USER_ACC:-organization-vs-devnet-admin}"
OUTPUT_FILE="${OUTPUT_FILE:-${SERVICE_DIR}/ids.env}"
MNEMONIC="${MNEMONIC:-${ORGANIZATION_VS_MNEMONIC:-}}"
# The agent's own account — see "Two accounts, two roles" in the header.
AGENT_ACC="${AGENT_ACC:-organization-vs-devnet-agent}"
AGENT_MNEMONIC="${AGENT_MNEMONIC:-${ORGANIZATION_VS_AGENT_MNEMONIC:-}}"

# Schema
CUSTOM_SCHEMA_URL="${CUSTOM_SCHEMA_URL:-}"
CUSTOM_SCHEMA_FILE="${CUSTOM_SCHEMA_FILE:-${SERVICE_DIR}/schema.json}"
CUSTOM_SCHEMA_BASE_ID="${CUSTOM_SCHEMA_BASE_ID:-example}"

# Ecosystem
EGF_LANGUAGE="${EGF_LANGUAGE:-en}"
EGF_DOC_URL="${EGF_DOC_URL:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"
EGF_DOC_DIGEST="${EGF_DOC_DIGEST:-}"

# Organization and Service details.
# The ORG_* values are the claims of the Organization credential, which the ECS
# Organization credential issuer signs in step 4b. The SELF_ISSUED_VTC_SERVICE_*
# container variables below cover the Service credential, which the agent
# issues to itself.
ORG_NAME="${ORG_NAME:-Verana Example Organization}"
ORG_ORGANIZATION_KIND="${ORG_ORGANIZATION_KIND:-PUBLIC}"
ORG_COUNTRY_CODE="${ORG_COUNTRY_CODE:-CH}"
ORG_REGISTRY_ID="${ORG_REGISTRY_ID:-CH-CHE-123.456.789}"
ORG_REGISTRY_URI="${ORG_REGISTRY_URI:-https://www.zefix.ch}"
ORG_ADDRESS="${ORG_ADDRESS:-Bahnhofstrasse 42, 8001 Zurich, Switzerland}"
ORG_LOGO_URI="${ORG_LOGO_URI:-https://verana.io/logo.svg}"
SERVICE_TYPE="${SERVICE_TYPE:-WEB_PORTAL}"
SERVICE_DESCRIPTION="${SERVICE_DESCRIPTION:-Organization service for the Verana demo ecosystem}"

# ---------------------------------------------------------------------------
# Ensure veranad is available
# ---------------------------------------------------------------------------

if ! command -v veranad &> /dev/null; then
  log "veranad not found — downloading..."
  VERANAD_VERSION="${VERANAD_VERSION:-v0.10.3}"
  PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
  esac
  curl -sfL "https://github.com/verana-labs/verana-node/releases/download/${VERANAD_VERSION}/veranad-${PLATFORM}-${ARCH}" \
    -o /usr/local/bin/veranad 2>/dev/null || {
    curl -sfL "https://github.com/verana-labs/verana-node/releases/download/${VERANAD_VERSION}/veranad-${PLATFORM}-${ARCH}" \
      -o "${HOME}/.local/bin/veranad"
    export PATH="${HOME}/.local/bin:$PATH"
  }
  chmod +x "$(command -v veranad || echo /usr/local/bin/veranad)"
  ok "veranad installed: $(veranad version)"
fi

set_network_vars "$NETWORK"
log "Network: $NETWORK (chain: $CHAIN_ID)"

ADMIN_API="http://localhost:${VS_AGENT_ADMIN_PORT}"

# =============================================================================
# STEP 1: Set up veranad CLI account (also the agent's own on-chain identity)
# =============================================================================

log "Step 1: Set up veranad CLI accounts"

if [ -n "$MNEMONIC" ]; then
  echo "$MNEMONIC" | veranad keys add "$USER_ACC" --recover --keyring-backend test 2>/dev/null || true
  ok "Mnemonic imported for the operator account '$USER_ACC'"
elif ! veranad keys show "$USER_ACC" --keyring-backend test > /dev/null 2>&1; then
  err "No MNEMONIC provided and account '$USER_ACC' does not exist."
  err "Export MNEMONIC (or ORGANIZATION_VS_MNEMONIC) with a funded devnet account and re-run."
  exit 1
fi
setup_veranad_account "$USER_ACC" "$FAUCET_URL"

if [ -z "$AGENT_MNEMONIC" ]; then
  err "No AGENT_MNEMONIC provided."
  err "Export AGENT_MNEMONIC (or ORGANIZATION_VS_AGENT_MNEMONIC) with a second funded devnet account."
  err "It becomes the agent's vs_operator, and it must differ from MNEMONIC."
  exit 1
fi
if [ "$AGENT_MNEMONIC" = "$MNEMONIC" ]; then
  err "AGENT_MNEMONIC equals MNEMONIC. The chain forbids one account from holding both"
  err "an OperatorAuthorization and a VSOperatorAuthorization, so they must be different."
  exit 1
fi
echo "$AGENT_MNEMONIC" | veranad keys add "$AGENT_ACC" --recover --keyring-backend test 2>/dev/null || true
AGENT_ADDR=$(veranad keys show "$AGENT_ACC" -a --keyring-backend test)
ok "Agent account (vs_operator): $AGENT_ADDR"

# =============================================================================
# STEP 2: Create Corporation (skipped if CORPORATION_ID already set)
# =============================================================================

log "Step 2: Corporation"

if [ -n "${CORPORATION_ID:-}" ]; then
  ok "Using existing CORPORATION_ID=$CORPORATION_ID"
  resolve_corporation "$CORPORATION_ID"
  ensure_operator_authorization "$CORPORATION" "$USER_ACC_ADDR" "$OA_MSGS_ECOSYSTEM"
else
  create_corporation "did:example:organization-vs-${CHAIN_ID}" "$EGF_DOC_URL"
  ok "Corporation created: CORPORATION_ID=$CORPORATION_ID — add this to organization-vs/config.env to skip next time"
fi

# =============================================================================
# STEP 3: Deploy VS Agent, bound to the Corporation
# =============================================================================

log "Step 3: Deploy VS Agent"

docker rm -f "$VS_AGENT_CONTAINER_NAME" 2>/dev/null || true
rm -rf "${VS_AGENT_DATA_DIR}/data/wallet"

log "Pulling VS Agent image..."
if ! docker pull --platform linux/amd64 "$VS_AGENT_IMAGE" 2>&1 | tail -1; then
  if docker image inspect "$VS_AGENT_IMAGE" > /dev/null 2>&1; then
    warn "Pull failed — using locally cached image: $VS_AGENT_IMAGE"
  else
    err "Pull failed and no local image found for: $VS_AGENT_IMAGE"
    exit 1
  fi
fi

log "Starting ngrok tunnel on port ${VS_AGENT_PUBLIC_PORT}..."
pkill -f "ngrok http ${VS_AGENT_PUBLIC_PORT}" 2>/dev/null || true
sleep 1
ngrok http "$VS_AGENT_PUBLIC_PORT" --log=stdout > /tmp/ngrok-org-vs.log 2>&1 &
NGROK_PID=$!
sleep 5

NGROK_URL=$(curl -sf http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url // empty')
if [ -z "$NGROK_URL" ]; then
  err "Failed to get ngrok URL. Is ngrok installed and authenticated?"
  exit 1
fi
NGROK_DOMAIN=$(echo "$NGROK_URL" | sed 's|https://||')
ok "ngrok tunnel: $NGROK_URL (domain: $NGROK_DOMAIN)"

log "Starting VS Agent container..."
mkdir -p "$VS_AGENT_DATA_DIR"
docker run --platform linux/amd64 -d \
  -p "${VS_AGENT_PUBLIC_PORT}:3001" \
  -p "${VS_AGENT_ADMIN_PORT}:3000" \
  -v "${VS_AGENT_DATA_DIR}:/root/.afj" \
  -e "AGENT_PUBLIC_DID=did:webvh:${NGROK_DOMAIN}" \
  -e "AGENT_LABEL=${ORG_NAME}" \
  -e "ENABLE_PUBLIC_API_SWAGGER=true" \
  -e "VERANA_RPC_ENDPOINT_URL=${NODE_RPC}" \
  -e "VERANA_INDEXER_BASE_URL=${INDEXER_URL}" \
  -e "VERANA_CHAIN_ID=${CHAIN_ID}" \
  -e "VERANA_ACCOUNT_MNEMONIC=${AGENT_MNEMONIC}" \
  -e "VERANA_CORPORATION_ID=${CORPORATION_ID}" \
  -e "AGENT_MODE=standalone" \
  -e "TRUSTED_ECS_ECOSYSTEM_DIDS=${ECS_ECOSYSTEM_DID}" \
  -e "SELF_ISSUED_VTC_ORG_ORGANIZATIONKIND=${ORG_ORGANIZATION_KIND}" \
  -e "SELF_ISSUED_VTC_ORG_COUNTRYCODE=${ORG_COUNTRY_CODE}" \
  -e "SELF_ISSUED_VTC_ORG_REGISTRYID=${ORG_REGISTRY_ID}" \
  -e "SELF_ISSUED_VTC_ORG_REGISTRYURI=${ORG_REGISTRY_URI}" \
  -e "SELF_ISSUED_VTC_ORG_ADDRESS=${ORG_ADDRESS}" \
  -e "SELF_ISSUED_VTC_SERVICE_TYPE=${SERVICE_TYPE}" \
  -e "SELF_ISSUED_VTC_SERVICE_DESCRIPTION=${SERVICE_DESCRIPTION}" \
  --name "$VS_AGENT_CONTAINER_NAME" \
  "$VS_AGENT_IMAGE"

ok "VS Agent container started: $VS_AGENT_CONTAINER_NAME"

log "Waiting for VS Agent to initialize (up to 180s)..."
if wait_for_agent "$ADMIN_API" 90; then
  ok "VS Agent is ready"
else
  err "VS Agent did not start within timeout"
  docker logs "$VS_AGENT_CONTAINER_NAME" 2>&1 | tail -20
  exit 1
fi

AGENT_DID=$(curl -sf "${ADMIN_API}/v1/agent" | jq -r '.publicDid')
if [ -z "$AGENT_DID" ] || [ "$AGENT_DID" = "null" ]; then
  err "Could not retrieve agent DID"
  exit 1
fi
ok "Agent DID: $AGENT_DID"

# =============================================================================
# STEP 4a: Assign the agent its ECS Participant entries
# =============================================================================
# The agent holds no OperatorAuthorization, so it cannot create these itself.
# The Corporation operator creates them here, each naming the agent account as
# its vs_operator with the narrowest msg types its role permits.

log "Step 4a: Assign the ECS Participant entries"

ECS_ORG_SCHEMA_ID=$(find_ecs_schema_id "$ECS_ECOSYSTEM_DID" "OrganizationCredential") || {
  err "Could not find the ECS Organization schema of $ECS_ECOSYSTEM_DID"
  exit 1
}
ECS_SERVICE_SCHEMA_ID=$(find_ecs_schema_id "$ECS_ECOSYSTEM_DID" "ServiceCredential") || {
  err "Could not find the ECS Service schema of $ECS_ECOSYSTEM_DID"
  exit 1
}
ok "ECS schema IDs: organization=$ECS_ORG_SCHEMA_ID service=$ECS_SERVICE_SCHEMA_ID"

# The Organization credential comes from the service the ECS Ecosystem
# corporation assigned the ISSUER entry to, not from the ecosystem agent.
ECS_ORG_ISSUER_DID=$(fetch_did_from_log "$ECS_ORG_ISSUER_PUBLIC_URL") || {
  err "Could not read the DID of the ECS Organization credential issuer at $ECS_ORG_ISSUER_PUBLIC_URL"
  exit 1
}
ECS_ORG_ISSUER_PARTICIPANT_ID=$(find_active_participant \
  "$ECS_ORG_SCHEMA_ID" "$PP_IDX_ROLE_ISSUER" "$ECS_ORG_ISSUER_DID") || {
  err "$ECS_ORG_ISSUER_DID holds no active ISSUER entry on the ECS Organization schema."
  err "Run verana-deploy scripts/ecs-ecosystem/devnet-setup.sh phase 3 first."
  exit 1
}
ok "ECS Organization issuer: $ECS_ORG_ISSUER_DID (participant $ECS_ORG_ISSUER_PARTICIPANT_ID)"

# --- The Service ISSUER entry ------------------------------------------------
# The Service schema is OPEN, so this needs no validation. The agent uses it
# twice: to anchor its own self-issued Service credential, and to deliver
# Service credentials to the delegated issuer-*/verifier- services. The
# delivery path matches on vs_operator, so this entry must name AGENT_ADDR.
EXISTING_SERVICE=$(find_participant_with_vs_operator \
  "$ECS_SERVICE_SCHEMA_ID" "$PP_ROLE_ISSUER" "$AGENT_DID")
EXISTING_SERVICE_ID=$(echo "${EXISTING_SERVICE:-}" | cut -f1)
EXISTING_SERVICE_VS_OP=$(echo "${EXISTING_SERVICE:-}" | cut -f2)

if [ -n "$EXISTING_SERVICE_ID" ] && [ "$EXISTING_SERVICE_VS_OP" = "$AGENT_ADDR" ]; then
  ok "Service ISSUER participant $EXISTING_SERVICE_ID already names $AGENT_ADDR"
else
  if [ -n "$EXISTING_SERVICE_ID" ]; then
    warn "Service ISSUER participant $EXISTING_SERVICE_ID names '$EXISTING_SERVICE_VS_OP' — revoking it"
    veranad tx pp revoke-participant "$EXISTING_SERVICE_ID" --corporation "$CORPORATION" \
      --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
      --fees "$FEES" --gas auto --node "$NODE_RPC" --output json -y > /dev/null 2>&1 || true
    sleep 6
  fi
  ECS_SERVICE_ROOT_ID=$(find_root_participant "$ECS_SERVICE_SCHEMA_ID") || {
    err "Could not find the ECOSYSTEM root of the ECS Service schema"
    exit 1
  }
  self_create_participant "$CORPORATION" "$PP_ROLE_ISSUER" "$ECS_SERVICE_ROOT_ID" "$AGENT_DID" \
    "$AGENT_ADDR" "$VSOA_ISSUER" > /dev/null
fi

# --- The Organization HOLDER entry -------------------------------------------
# Its validator is the ISSUER entry above, so validating it is part of a
# credential exchange. The agent reacts to this transaction and sends the
# onboarding request by itself; step 4b then completes it.
EXISTING_HOLDER=$(find_participant_with_vs_operator \
  "$ECS_ORG_SCHEMA_ID" "$PP_ROLE_HOLDER" "$AGENT_DID")
EXISTING_HOLDER_ID=$(echo "${EXISTING_HOLDER:-}" | cut -f1)
EXISTING_HOLDER_VS_OP=$(echo "${EXISTING_HOLDER:-}" | cut -f2)

if [ -n "$EXISTING_HOLDER_ID" ] && [ "$EXISTING_HOLDER_VS_OP" = "$AGENT_ADDR" ]; then
  ok "Organization HOLDER participant $EXISTING_HOLDER_ID already names $AGENT_ADDR"
else
  if [ -n "$EXISTING_HOLDER_ID" ]; then
    warn "Organization HOLDER participant $EXISTING_HOLDER_ID names '$EXISTING_HOLDER_VS_OP' — revoking it"
    veranad tx pp revoke-participant "$EXISTING_HOLDER_ID" --corporation "$CORPORATION" \
      --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
      --fees "$FEES" --gas auto --node "$NODE_RPC" --output json -y > /dev/null 2>&1 || true
    sleep 6
  fi
  # HOLDER is the one role whose vs_operator may send TriggerResolver, and that
  # is the only message this participant needs from the agent.
  start_participant_op "$CORPORATION" "$PP_ROLE_HOLDER" "$ECS_ORG_ISSUER_PARTICIPANT_ID" "$AGENT_DID" \
    "$AGENT_ADDR" "$VSOA_HOLDER" > /dev/null
fi

# =============================================================================
# STEP 4b: Complete the onboarding process on the Organization credential issuer
# =============================================================================

log "Step 4b: Validate the ECS onboarding on the Organization credential issuer"

if has_completed_flow "$ECS_ORG_ISSUER_ADMIN_API" "$AGENT_DID"; then
  ok "Already validated — skipping"
else
  log "Waiting for the agent to send the onboarding request (up to 60s)..."
  sleep 20

  log "Computing logo digest for $ORG_LOGO_URI..."
  ORG_LOGO_DIGEST_SRI=$(sri_digest_sha384 "$ORG_LOGO_URI") || {
    err "Could not fetch/hash $ORG_LOGO_URI"
    exit 1
  }

  # The Organization credential's required subject fields (ECS OrganizationCredential
  # schema): id, name, logoUri, logoDigestSri, registryId, address, countryCode.
  # The issuer refuses claims that do not satisfy the schema.
  ORG_CLAIMS=$(jq -c -n \
    --arg name "$ORG_NAME" \
    --arg logoUri "$ORG_LOGO_URI" \
    --arg logoDigestSri "$ORG_LOGO_DIGEST_SRI" \
    --arg registryId "$ORG_REGISTRY_ID" \
    --arg registryUri "$ORG_REGISTRY_URI" \
    --arg address "$ORG_ADDRESS" \
    --arg organizationKind "$ORG_ORGANIZATION_KIND" \
    --arg countryCode "$ORG_COUNTRY_CODE" \
    '{name: $name, logoUri: $logoUri, logoDigestSri: $logoDigestSri, registryId: $registryId,
      registryUri: $registryUri, address: $address, organizationKind: $organizationKind,
      countryCode: $countryCode}')

  if ! validate_pending_flow "$ECS_ORG_ISSUER_ADMIN_API" "$AGENT_DID" "" "$ORG_CLAIMS"; then
    err "Could not validate on the Organization credential issuer ($ECS_ORG_ISSUER_ADMIN_API)."
    err "Is it port-forwarded? kubectl port-forward -n vna-devnet-1 svc/ecs-org-issuer 3101:3000"
    exit 1
  fi
fi

log "Waiting for the Organization and Service credentials to appear (up to 30s)..."
sleep 20
ok "Check: ${NGROK_URL}/.well-known/did.json"

# =============================================================================
# STEP 5: Create the "example" Ecosystem, schema and root participant
# =============================================================================

log "Step 5: Create 'example' Ecosystem"

if find_ecosystem_for_corporation "$CORPORATION_ID" > /dev/null 2>&1; then
  ECOSYSTEM_ID=$(find_ecosystem_for_corporation "$CORPORATION_ID")
  ok "Ecosystem already exists: id=$ECOSYSTEM_ID — skipping creation"
else
  create_ecosystem "$CORPORATION" "$AGENT_DID" "$EGF_DOC_URL" "$EGF_DOC_DIGEST"
fi

if [ -n "$CUSTOM_SCHEMA_URL" ]; then
  SCHEMA_JSON=$(download_schema "$CUSTOM_SCHEMA_URL")
else
  SCHEMA_JSON=$(jq -c '.' "$CUSTOM_SCHEMA_FILE")
fi

CUSTOM_SCHEMA_ID=$(create_credential_schema "$CORPORATION" "$ECOSYSTEM_ID" "$SCHEMA_JSON" \
  "$ONBOARDING_MODE_ECOSYSTEM" "$ONBOARDING_MODE_OPEN" "$HOLDER_MODE_ISSUER_OP")

ROOT_PARTICIPANT_ID=$(create_root_participant "$CORPORATION" "$CUSTOM_SCHEMA_ID" "$AGENT_DID")

# =============================================================================
# STEP 6: AnonCreds credential definition — SKIPPED
# =============================================================================
# organization-vs does not create a credential definition. Each issuer
# (issuer-chatbot-vs, issuer-web-vs) creates its own, pointing to the VTJSC
# auto-published by this service.

log "Step 6: AnonCreds credential definition — skipped (issuers create their own)"

# =============================================================================
# Save IDs
# =============================================================================

log "Saving resource IDs to ${OUTPUT_FILE}"

cat > "$OUTPUT_FILE" <<EOF
# Organization VS — Resource IDs
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Network: ${NETWORK}

AGENT_DID=${AGENT_DID}
NGROK_URL=${NGROK_URL}
VS_AGENT_CONTAINER_NAME=${VS_AGENT_CONTAINER_NAME}
VS_AGENT_ADMIN_PORT=${VS_AGENT_ADMIN_PORT}
VS_AGENT_PUBLIC_PORT=${VS_AGENT_PUBLIC_PORT}
USER_ACC=${USER_ACC}
CORPORATION_ID=${CORPORATION_ID}
ECOSYSTEM_ID=${ECOSYSTEM_ID}
CUSTOM_SCHEMA_ID=${CUSTOM_SCHEMA_ID}
ROOT_PARTICIPANT_ID=${ROOT_PARTICIPANT_ID}
EOF

ok "IDs saved to ${OUTPUT_FILE}"

# =============================================================================
# Summary
# =============================================================================

log "Organization VS setup complete!"
echo ""
echo "  Agent DID          : $AGENT_DID"
echo "  Public URL         : $NGROK_URL"
echo "  DID Document       : ${NGROK_URL}/.well-known/did.json"
echo "  Admin API          : $ADMIN_API"
echo "  Corporation ID     : $CORPORATION_ID"
echo "  Ecosystem ID       : $ECOSYSTEM_ID"
echo "  Schema ID          : $CUSTOM_SCHEMA_ID"
echo "  Root Participant ID: $ROOT_PARTICIPANT_ID"
echo ""
echo "  To stop:"
echo "    docker stop $VS_AGENT_CONTAINER_NAME"
echo "    kill $NGROK_PID  # ngrok"
echo ""
