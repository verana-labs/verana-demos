#!/usr/bin/env bash
# =============================================================================
# Issuer Chatbot VS — Local Setup (Verana v0.10.1+, devnet only)
# =============================================================================
#
# This script sets up the Issuer Chatbot VS Agent locally (child service):
#   1. Creates issuer-chatbot-vs's own Corporation and grants it operator
#      authorization for MsgStartParticipantOP
#   2. Deploys the VS Agent via Docker + ngrok, bound to that Corporation,
#      in AGENT_MODE=delegated against organization-vs
#   3. Waits for EcsBootstrapService's delegated flow to obtain the Service
#      credential from organization-vs automatically (no script action)
#   4. Discovers organization-vs's "example" schema + root participant, and
#      submits StartParticipantOP(ISSUER) — the DIDComm handshake then runs
#      by itself
#   5. Validates the pending request on organization-vs's admin API
#   6. Optionally creates an AnonCreds credential definition
#
# Requires organization-vs to be running and reachable (public URL + admin API).
#
# Prerequisites:
#   - Docker, ngrok (authenticated), curl, jq, veranad
#   - MNEMONIC (or ISSUER_CHATBOT_VS_MNEMONIC) env var — a funded devnet account
#
# Usage:
#   source issuer-chatbot-vs/config.env
#   MNEMONIC="..." ./issuer-chatbot-vs/scripts/setup.sh
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
VS_AGENT_IMAGE="${VS_AGENT_IMAGE:-veranalabs/vs-agent:v2.0.0-dev.17}"
VS_AGENT_CONTAINER_NAME="${VS_AGENT_CONTAINER_NAME:-issuer-chatbot-vs}"
VS_AGENT_ADMIN_PORT="${VS_AGENT_ADMIN_PORT:-3002}"
VS_AGENT_PUBLIC_PORT="${VS_AGENT_PUBLIC_PORT:-3003}"
VS_AGENT_DATA_DIR="${VS_AGENT_DATA_DIR:-${SERVICE_DIR}/data}"
CHATBOT_PORT="${CHATBOT_PORT:-4000}"
SERVICE_NAME="${SERVICE_NAME:-Example Issuer Chatbot}"
USER_ACC="${USER_ACC:-issuer-chatbot-vs-devnet-admin}"
OUTPUT_FILE="${OUTPUT_FILE:-${SERVICE_DIR}/ids.env}"
MNEMONIC="${MNEMONIC:-${ISSUER_CHATBOT_VS_MNEMONIC:-}}"

ORG_VS_ADMIN_URL="${ORG_VS_ADMIN_URL:-http://localhost:3000}"
ORG_VS_PUBLIC_URL="${ORG_VS_PUBLIC_URL:-}"

SERVICE_TYPE="${SERVICE_TYPE:-MESSAGING_APP}"
SERVICE_DESCRIPTION="${SERVICE_DESCRIPTION:-Chatbot credential issuer for the Verana demo ecosystem}"

ENABLE_ANONCREDS="${ENABLE_ANONCREDS:-false}"
ANONCREDS_NAME="${ANONCREDS_NAME:-example}"
ANONCREDS_VERSION="${ANONCREDS_VERSION:-1.0}"
ANONCREDS_SUPPORT_REVOCATION="${ANONCREDS_SUPPORT_REVOCATION:-false}"

# ---------------------------------------------------------------------------
# Ensure veranad is available
# ---------------------------------------------------------------------------

if ! command -v veranad &> /dev/null; then
  log "veranad not found — downloading..."
  VERANAD_VERSION="${VERANAD_VERSION:-v0.10.2}"
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
# The did:webvh lives in the log. /.well-known/did.json answers with the did:web
# alias, and the parent registers its participants under the did:webvh.
ORG_DID=$(fetch_did_from_log "$ORG_PUBLIC_API")
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
  err "Export MNEMONIC (or ISSUER_CHATBOT_VS_MNEMONIC) with a funded devnet account and re-run."
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
  ensure_operator_authorization "$CORPORATION" "$USER_ACC_ADDR" "$OA_MSGS_ISSUER"
else
  create_corporation "did:example:issuer-chatbot-vs-${CHAIN_ID}" "$EGF_DOC_URL" "" \
    "$OA_MSGS_ISSUER"
  ok "Corporation created: CORPORATION_ID=$CORPORATION_ID — add this to issuer-chatbot-vs/config.env to skip next time"
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
ngrok http "$VS_AGENT_PUBLIC_PORT" --log=stdout > /tmp/ngrok-issuer-chatbot-vs.log 2>&1 &
NGROK_PID=$!
sleep 5

NGROK_URL=$(curl -sf http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url // empty')
if [ -z "$NGROK_URL" ]; then
  err "Failed to get ngrok URL. Is ngrok installed and authenticated?"
  exit 1
fi
NGROK_DOMAIN=$(echo "$NGROK_URL" | sed 's|https://||')
ok "ngrok tunnel: $NGROK_URL"

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
# STEP 4: Discover organization-vs's "example" schema and submit StartParticipantOP
# =============================================================================

log "Step 4: Obtain ISSUER participant for organization-vs's 'example' schema"

CUSTOM_SCHEMA_ID=$(discover_custom_schema_id "${ORG_PUBLIC_API}/.well-known/did.json") || {
  err "Could not discover the 'example' schema from organization-vs's DID document"
  exit 1
}
ok "Organization-vs custom schema ID: $CUSTOM_SCHEMA_ID"

if EXISTING_PARTICIPANT_ID=$(find_active_participant "$CUSTOM_SCHEMA_ID" "$PP_IDX_ROLE_ISSUER" "$AGENT_DID"); then
  ok "Active ISSUER participant already exists: $EXISTING_PARTICIPANT_ID — skipping"
else
  ROOT_PARTICIPANT_ID=$(find_root_participant "$CUSTOM_SCHEMA_ID") || {
    err "Could not find the root participant for schema $CUSTOM_SCHEMA_ID"
    exit 1
  }
  start_participant_op "$CORPORATION" "$PP_ROLE_ISSUER" "$ROOT_PARTICIPANT_ID" "$AGENT_DID" > /dev/null

  # =============================================================================
  # STEP 5: Validate the pending request on organization-vs
  # =============================================================================

  log "Step 5: Validate onboarding request on organization-vs"
  sleep 15
  validate_pending_flow "$ORG_VS_ADMIN_URL" "$AGENT_DID"
fi

# =============================================================================
# STEP 6: AnonCreds credential definition (optional)
# =============================================================================

ANONCREDS_CRED_DEF_ID=""
if [ "$ENABLE_ANONCREDS" = "true" ]; then
  log "Step 6: AnonCreds credential definition"

  PUBLIC_URL="http://localhost:${VS_AGENT_PUBLIC_PORT}"
  EXISTING_ANONCREDS=$(curl -sf "${PUBLIC_URL}/resources?resourceType=anonCredsCredDef" \
    | jq -r '. | length' 2>/dev/null || echo "0")
  if [ "${EXISTING_ANONCREDS:-0}" -gt 0 ]; then
    ANONCREDS_CRED_DEF_ID=$(curl -sf "${PUBLIC_URL}/resources?resourceType=anonCredsCredDef" \
      | jq -r '.[0].id // empty' 2>/dev/null || echo "")
    ok "AnonCreds credential definition already exists: ${ANONCREDS_CRED_DEF_ID} — skipping"
  else
    # v4 VTJSC schema ref format: vpr:verana:<chain-id>:cs:<schema-id>
    VTJSC_VPR_REF="vpr:verana:${CHAIN_ID}:cs:${CUSTOM_SCHEMA_ID}"
    VTJSC_CRED_ID=$(curl -sf "${ADMIN_API}/v1/vt/json-schema-credentials" \
      | jq -r --arg sid "$VTJSC_VPR_REF" '.data[] | select(.schemaId == $sid) | .credential.id')
    if [ -z "$VTJSC_CRED_ID" ]; then
      err "Could not find VTJSC for schema $CUSTOM_SCHEMA_ID (ref: $VTJSC_VPR_REF)"
      exit 1
    fi

    ANONCREDS_RESULT=$(curl -sf -X POST "${ADMIN_API}/v1/credential-types" \
      -H 'Content-Type: application/json' \
      -d "{\"name\": \"${ANONCREDS_NAME}\", \"version\": \"${ANONCREDS_VERSION}\", \"relatedJsonSchemaCredentialId\": \"${VTJSC_CRED_ID}\", \"supportRevocation\": ${ANONCREDS_SUPPORT_REVOCATION}}")
    ANONCREDS_CRED_DEF_ID=$(echo "$ANONCREDS_RESULT" | jq -r '.id // empty')
    if [ -z "$ANONCREDS_CRED_DEF_ID" ]; then
      err "Failed to create AnonCreds credential definition. Response: $ANONCREDS_RESULT"
      exit 1
    fi
    ok "AnonCreds credential definition created: $ANONCREDS_CRED_DEF_ID"
  fi
else
  log "Step 6: AnonCreds — skipped (ENABLE_ANONCREDS=false)"
fi

# =============================================================================
# Save IDs
# =============================================================================

log "Saving resource IDs to ${OUTPUT_FILE}"

cat > "$OUTPUT_FILE" <<EOF
# Issuer Chatbot VS — Resource IDs
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
ANONCREDS_CRED_DEF_ID=${ANONCREDS_CRED_DEF_ID:-}
EOF

ok "IDs saved to ${OUTPUT_FILE}"

log "Issuer Chatbot VS setup complete!"
echo ""
echo "  Agent DID    : $AGENT_DID"
echo "  Public URL   : $NGROK_URL"
echo "  Admin API    : $ADMIN_API"
echo "  Corporation ID: $CORPORATION_ID"
echo "  Schema ID    : ${CUSTOM_SCHEMA_ID:-n/a}"
if [ -n "${ANONCREDS_CRED_DEF_ID:-}" ]; then
echo "  AnonCreds Cred Def: $ANONCREDS_CRED_DEF_ID"
fi
echo ""
echo "  Start the chatbot:"
echo "    ./issuer-chatbot-vs/scripts/start.sh"
echo ""
echo "  To stop:"
echo "    docker stop $VS_AGENT_CONTAINER_NAME"
echo "    kill $NGROK_PID  # ngrok"
echo ""
