#!/usr/bin/env bash
# =============================================================================
# Verifier Chatbot VS — Local Setup (Verana v0.10.1+, devnet only)
# =============================================================================
#
# This script sets up the Verifier Chatbot VS Agent locally (child service):
#   1. Creates verifier-chatbot-vs's own Corporation and grants it operator
#      authorization for MsgSelfCreateParticipant
#   2. Deploys the VS Agent via Docker + ngrok, bound to that Corporation,
#      in AGENT_MODE=delegated against organization-vs
#   3. Waits for EcsBootstrapService's delegated flow to obtain the Service
#      credential from organization-vs automatically (no script action)
#   4. Discovers organization-vs's "example" schema + root participant, and
#      self-creates a VERIFIER participant (OPEN mode — one-shot tx, no
#      DIDComm handshake, no validation needed)
#   5. Discovers the AnonCreds credential definition from issuer-chatbot-vs
#
# Requires organization-vs to be running and reachable (public URL + admin API).
#
# Prerequisites:
#   - Docker, ngrok (authenticated), curl, jq, veranad
#   - MNEMONIC (or VERIFIER_CHATBOT_VS_MNEMONIC) env var — a funded devnet account
#
# Usage:
#   source verifier-chatbot-vs/config.env
#   MNEMONIC="..." ./verifier-chatbot-vs/scripts/setup.sh
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
VS_AGENT_IMAGE="${VS_AGENT_IMAGE:-veranalabs/vs-agent:latest}"
VS_AGENT_CONTAINER_NAME="${VS_AGENT_CONTAINER_NAME:-verifier-chatbot-vs}"
VS_AGENT_ADMIN_PORT="${VS_AGENT_ADMIN_PORT:-3006}"
VS_AGENT_PUBLIC_PORT="${VS_AGENT_PUBLIC_PORT:-3007}"
VS_AGENT_DATA_DIR="${VS_AGENT_DATA_DIR:-${SERVICE_DIR}/data}"
CHATBOT_PORT="${CHATBOT_PORT:-4002}"
SERVICE_NAME="${SERVICE_NAME:-Example Verifier Chatbot}"
USER_ACC="${USER_ACC:-verifier-chatbot-vs-devnet-admin}"
OUTPUT_FILE="${OUTPUT_FILE:-${SERVICE_DIR}/ids.env}"
MNEMONIC="${MNEMONIC:-${VERIFIER_CHATBOT_VS_MNEMONIC:-}}"

ORG_VS_ADMIN_URL="${ORG_VS_ADMIN_URL:-http://localhost:3000}"
ORG_VS_PUBLIC_URL="${ORG_VS_PUBLIC_URL:-}"

SERVICE_TYPE="${SERVICE_TYPE:-MESSAGING_APP}"
SERVICE_DESCRIPTION="${SERVICE_DESCRIPTION:-Chatbot credential verifier for the Verana demo ecosystem}"

ISSUER_VS_PUBLIC_URL="${ISSUER_VS_PUBLIC_URL:-http://localhost:3003}"

# ---------------------------------------------------------------------------
# Ensure veranad is available
# ---------------------------------------------------------------------------

if ! command -v veranad &> /dev/null; then
  log "veranad not found — downloading..."
  VERANAD_VERSION="${VERANAD_VERSION:-v0.10.2-dev.2}"
  PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
  esac
  mkdir -p "${HOME}/.local/bin"
  curl -sfL "https://github.com/verana-labs/verana-node/releases/download/${VERANAD_VERSION}/veranad-${PLATFORM}-${ARCH}" \
    -o "${HOME}/.local/bin/veranad"
  chmod +x "${HOME}/.local/bin/veranad"
  export PATH="${HOME}/.local/bin:$PATH"
  ok "veranad installed: $(veranad version)"
fi

set_network_vars "$NETWORK"
log "Network: $NETWORK (chain: $CHAIN_ID)"

ADMIN_API="http://localhost:${VS_AGENT_ADMIN_PORT}"

if ! curl -sf "${ORG_VS_ADMIN_URL}/api" > /dev/null 2>&1; then
  err "Organization VS admin API not reachable at ${ORG_VS_ADMIN_URL}"
  err "Make sure organization-vs is running and ORG_VS_ADMIN_URL is set correctly."
  exit 1
fi
ok "Organization VS admin API reachable: $ORG_VS_ADMIN_URL"

ORG_PUBLIC_API="${ORG_VS_PUBLIC_URL:-http://localhost:${ORG_VS_PUBLIC_PORT:-3001}}"
ORG_DID=$(curl -sf "${ORG_PUBLIC_API}/.well-known/did.json" | jq -r '.id // empty')
if [ -z "$ORG_DID" ]; then
  err "Could not fetch organization-vs DID from $ORG_PUBLIC_API"
  exit 1
fi
ok "organization-vs DID: $ORG_DID"

# =============================================================================
# STEP 1: Set up veranad CLI account (also the agent's own on-chain identity)
# =============================================================================

log "Step 1: Set up veranad CLI account"

if [ -n "$MNEMONIC" ]; then
  echo "$MNEMONIC" | veranad keys add "$USER_ACC" --recover --keyring-backend test 2>/dev/null || true
  ok "Mnemonic imported for account '$USER_ACC'"
elif ! veranad keys show "$USER_ACC" --keyring-backend test > /dev/null 2>&1; then
  err "No MNEMONIC provided and account '$USER_ACC' does not exist."
  err "Export MNEMONIC (or VERIFIER_CHATBOT_VS_MNEMONIC) with a funded devnet account and re-run."
  exit 1
fi
setup_veranad_account "$USER_ACC" "$FAUCET_URL"

# =============================================================================
# STEP 2: Create Corporation (skipped if CORPORATION_ID already set)
# =============================================================================

log "Step 2: Corporation"

if [ -n "${CORPORATION_ID:-}" ]; then
  ok "Using existing CORPORATION_ID=$CORPORATION_ID"
  resolve_corporation "$CORPORATION_ID"
else
  create_corporation "did:example:verifier-chatbot-vs-${CHAIN_ID}" "$EGF_DOC_URL" "" \
    '["/verana.pp.v1.MsgSelfCreateParticipant"]'
  ok "Corporation created: CORPORATION_ID=$CORPORATION_ID — add this to verifier-chatbot-vs/config.env to skip next time"
fi

# =============================================================================
# STEP 3: Deploy VS Agent, bound to the Corporation, delegated to organization-vs
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
ngrok http "$VS_AGENT_PUBLIC_PORT" --log=stdout > /tmp/ngrok-verifier-chatbot-vs.log 2>&1 &
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
  -e "AGENT_LABEL=${SERVICE_NAME}" \
  -e "ENABLE_PUBLIC_API_SWAGGER=true" \
  -e "EVENTS_BASE_URL=http://host.docker.internal:${CHATBOT_PORT}" \
  -e "VERANA_RPC_ENDPOINT_URL=${NODE_RPC}" \
  -e "VERANA_INDEXER_BASE_URL=${INDEXER_URL}" \
  -e "VERANA_CHAIN_ID=${CHAIN_ID}" \
  -e "VERANA_ACCOUNT_MNEMONIC=${MNEMONIC}" \
  -e "VERANA_CORPORATION_ID=${CORPORATION_ID}" \
  -e "AGENT_MODE=delegated" \
  -e "AGENT_DELEGATED_PARENT_VS_DID=${ORG_DID}" \
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

log "Waiting for the delegated Service credential to be obtained (up to 30s)..."
sleep 20
ok "Check: ${NGROK_URL}/.well-known/did.json"

# =============================================================================
# STEP 4: Discover organization-vs's "example" schema and self-create VERIFIER
# =============================================================================

log "Step 4: Self-create VERIFIER participant for organization-vs's 'example' schema"

CUSTOM_SCHEMA_ID=$(discover_custom_schema_id "${ORG_PUBLIC_API}/.well-known/did.json") || {
  err "Could not discover the 'example' schema from organization-vs's DID document"
  exit 1
}
ok "Organization-vs custom schema ID: $CUSTOM_SCHEMA_ID"

if EXISTING_PARTICIPANT_ID=$(find_active_participant "$CUSTOM_SCHEMA_ID" "$PP_IDX_ROLE_VERIFIER" "$AGENT_DID"); then
  ok "Active VERIFIER participant already exists: $EXISTING_PARTICIPANT_ID — skipping"
  VERIFIER_PARTICIPANT_ID="$EXISTING_PARTICIPANT_ID"
else
  ROOT_PARTICIPANT_ID=$(find_root_participant "$CUSTOM_SCHEMA_ID") || {
    err "Could not find the root participant for schema $CUSTOM_SCHEMA_ID"
    exit 1
  }
  VERIFIER_PARTICIPANT_ID=$(self_create_participant "$CORPORATION" "$PP_ROLE_VERIFIER" "$ROOT_PARTICIPANT_ID" "$AGENT_DID")
  ok "VERIFIER participant created: $VERIFIER_PARTICIPANT_ID"
fi

# =============================================================================
# STEP 5: Discover AnonCreds credential definition from issuer-chatbot-vs
# =============================================================================

log "Step 5: Discovering AnonCreds credential definition from issuer-chatbot-vs..."
ANONCREDS_CRED_DEF_ID=$(curl -sf "${ISSUER_VS_PUBLIC_URL}/resources?resourceType=anonCredsCredDef" \
  | jq -r '.[0].id // empty' 2>/dev/null || echo "")
if [ -n "$ANONCREDS_CRED_DEF_ID" ]; then
  ok "AnonCreds cred def discovered from issuer-chatbot-vs: $ANONCREDS_CRED_DEF_ID"
else
  err "No AnonCreds cred def found on issuer-chatbot-vs (${ISSUER_VS_PUBLIC_URL})"
  err "Make sure issuer-chatbot-vs is running and has created its credential definition"
  exit 1
fi

# =============================================================================
# Save IDs
# =============================================================================

log "Saving resource IDs to ${OUTPUT_FILE}"

cat > "$OUTPUT_FILE" <<EOF
# Verifier Chatbot VS — Resource IDs
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Network: ${NETWORK}

AGENT_DID=${AGENT_DID}
NGROK_URL=${NGROK_URL}
VS_AGENT_CONTAINER_NAME=${VS_AGENT_CONTAINER_NAME}
VS_AGENT_ADMIN_PORT=${VS_AGENT_ADMIN_PORT}
VS_AGENT_PUBLIC_PORT=${VS_AGENT_PUBLIC_PORT}
USER_ACC=${USER_ACC}
CORPORATION_ID=${CORPORATION_ID}
CUSTOM_SCHEMA_ID=${CUSTOM_SCHEMA_ID:-}
VERIFIER_PARTICIPANT_ID=${VERIFIER_PARTICIPANT_ID:-}
ANONCREDS_CRED_DEF_ID=${ANONCREDS_CRED_DEF_ID:-}
EOF

ok "IDs saved to ${OUTPUT_FILE}"

log "Verifier Chatbot VS setup complete!"
echo ""
echo "  Agent DID         : $AGENT_DID"
echo "  Public URL        : $NGROK_URL"
echo "  Admin API         : $ADMIN_API"
echo "  Corporation ID    : $CORPORATION_ID"
echo "  Schema ID         : ${CUSTOM_SCHEMA_ID:-n/a}"
echo "  Verifier Participant: ${VERIFIER_PARTICIPANT_ID:-n/a}"
if [ -n "${ANONCREDS_CRED_DEF_ID:-}" ]; then
echo "  AnonCreds Cred Def: $ANONCREDS_CRED_DEF_ID (from issuer-chatbot-vs)"
fi
echo ""
echo "  Start the chatbot:"
echo "    ./verifier-chatbot-vs/scripts/start.sh"
echo ""
echo "  To stop:"
echo "    docker stop $VS_AGENT_CONTAINER_NAME"
echo "    kill $NGROK_PID  # ngrok"
echo ""
