#!/usr/bin/env bash
# =============================================================================
# Issuer Chatbot VS — Local Setup
# =============================================================================
#
# This script sets up the Issuer Chatbot VS Agent locally (child service):
#   1. Deploys the VS Agent via Docker + ngrok
#   2. Sets up the veranad CLI account
#   3. Obtains a Service credential from organization-vs
#   4. Obtains an ISSUER permission for the organization-vs schema (VP flow)
#
# Requires organization-vs to be running and its admin API reachable.
#
# Prerequisites:
#   - Docker, ngrok (authenticated), curl, jq
#   - Organization VS running (ORG_VS_ADMIN_URL reachable)
#
# Usage:
#   source issuer-chatbot-vs/config.env
#   ./issuer-chatbot-vs/scripts/setup.sh
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

NETWORK="${NETWORK:-testnet}"
VS_AGENT_IMAGE="${VS_AGENT_IMAGE:-veranalabs/vs-agent:latest}"
VS_AGENT_CONTAINER_NAME="${VS_AGENT_CONTAINER_NAME:-issuer-chatbot-vs}"
VS_AGENT_ADMIN_PORT="${VS_AGENT_ADMIN_PORT:-3002}"
VS_AGENT_PUBLIC_PORT="${VS_AGENT_PUBLIC_PORT:-3003}"
VS_AGENT_DATA_DIR="${VS_AGENT_DATA_DIR:-${SERVICE_DIR}/data}"
CHATBOT_PORT="${CHATBOT_PORT:-4000}"
SERVICE_NAME="${SERVICE_NAME:-Example Issuer Chatbot}"
USER_ACC="${USER_ACC:-org-vs-admin}"
OUTPUT_FILE="${OUTPUT_FILE:-${SERVICE_DIR}/ids.env}"

# Organization VS
ORG_VS_ADMIN_URL="${ORG_VS_ADMIN_URL:-http://localhost:3000}"
ORG_VS_PUBLIC_URL="${ORG_VS_PUBLIC_URL:-}"

# Service details
SERVICE_TYPE="${SERVICE_TYPE:-IssuerService}"
SERVICE_DESCRIPTION="${SERVICE_DESCRIPTION:-Chatbot credential issuer for the Verana demo ecosystem}"
SERVICE_LOGO_URL="${SERVICE_LOGO_URL:-https://verana.io/logo.svg}"
SERVICE_MIN_AGE="${SERVICE_MIN_AGE:-0}"
SERVICE_TERMS="${SERVICE_TERMS:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"
SERVICE_PRIVACY="${SERVICE_PRIVACY:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"

# AnonCreds
ENABLE_ANONCREDS="${ENABLE_ANONCREDS:-false}"
ANONCREDS_NAME="${ANONCREDS_NAME:-example}"
ANONCREDS_VERSION="${ANONCREDS_VERSION:-1.0}"
ANONCREDS_SUPPORT_REVOCATION="${ANONCREDS_SUPPORT_REVOCATION:-false}"
CUSTOM_SCHEMA_BASE_ID="${CUSTOM_SCHEMA_BASE_ID:-example}"

# ---------------------------------------------------------------------------
# Ensure veranad is available
# ---------------------------------------------------------------------------

if ! command -v veranad &> /dev/null; then
  log "veranad not found — downloading..."
  VERANAD_VERSION="${VERANAD_VERSION:-v0.9.4}"
  PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
  esac
  mkdir -p "${HOME}/.local/bin"
  curl -sfL "https://github.com/verana-labs/verana/releases/download/${VERANAD_VERSION}/veranad-${PLATFORM}-${ARCH}" \
    -o "${HOME}/.local/bin/veranad"
  chmod +x "${HOME}/.local/bin/veranad"
  export PATH="${HOME}/.local/bin:$PATH"
  ok "veranad installed: $(veranad version)"
fi

# ---------------------------------------------------------------------------
# Set network-specific variables
# ---------------------------------------------------------------------------

set_network_vars "$NETWORK"
log "Network: $NETWORK (chain: $CHAIN_ID)"

ADMIN_API="http://localhost:${VS_AGENT_ADMIN_PORT}"

# =============================================================================
# STEP 1: Deploy VS Agent
# =============================================================================

log "Step 1: Deploy VS Agent"

# Clean up any previous instance
docker rm -f "$VS_AGENT_CONTAINER_NAME" 2>/dev/null || true
rm -rf "${VS_AGENT_DATA_DIR}/data/wallet"

# Pull image
log "Pulling VS Agent image..."
if ! docker pull --platform linux/amd64 "$VS_AGENT_IMAGE" 2>&1 | tail -1; then
  if docker image inspect "$VS_AGENT_IMAGE" > /dev/null 2>&1; then
    warn "Pull failed — using locally cached image: $VS_AGENT_IMAGE"
  else
    err "Pull failed and no local image found for: $VS_AGENT_IMAGE"
    exit 1
  fi
fi

# Start ngrok tunnel
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
ok "ngrok tunnel: $NGROK_URL (domain: $NGROK_DOMAIN)"

# Start VS Agent container
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
  --name "$VS_AGENT_CONTAINER_NAME" \
  "$VS_AGENT_IMAGE"

ok "VS Agent container started: $VS_AGENT_CONTAINER_NAME"

# Wait for agent
log "Waiting for VS Agent to initialize (up to 180s)..."
if wait_for_agent "$ADMIN_API" 90; then
  ok "VS Agent is ready"
else
  err "VS Agent did not start within timeout"
  docker logs "$VS_AGENT_CONTAINER_NAME" 2>&1 | tail -20
  exit 1
fi

# Get agent DID
AGENT_DID=$(curl -sf "${ADMIN_API}/v1/agent" | jq -r '.publicDid')
if [ -z "$AGENT_DID" ] || [ "$AGENT_DID" = "null" ]; then
  err "Could not retrieve agent DID"
  exit 1
fi
ok "Agent DID: $AGENT_DID"

# =============================================================================
# STEP 2: Set up veranad CLI account
# =============================================================================

log "Step 2: Set up veranad CLI account"
setup_veranad_account "$USER_ACC" "$FAUCET_URL"

# =============================================================================
# STEP 3: Obtain Service credential from organization-vs
# =============================================================================

log "Step 3: Obtain Service credential from organization-vs"

# Verify organization-vs admin API is reachable (use /api which is always exposed)
if ! curl -sf "${ORG_VS_ADMIN_URL}/api" > /dev/null 2>&1; then
  err "Organization VS admin API not reachable at ${ORG_VS_ADMIN_URL}"
  err "Make sure organization-vs is running and ORG_VS_ADMIN_URL is set correctly."
  exit 1
fi
ok "Organization VS admin API reachable: $ORG_VS_ADMIN_URL"

# Skip if Service credential is already linked on the local agent
if has_linked_vp "$NGROK_URL" "service"; then
  ok "Service credential already linked — skipping"
else
  # Discover Service VTJSC from ECS TR
  SERVICE_VTJSC_OUTPUT=$(discover_ecs_vtjsc "$ECS_TR_PUBLIC_URL" "service")
  SERVICE_JSC_URL=$(echo "$SERVICE_VTJSC_OUTPUT" | sed -n '1p')
  CS_SERVICE_ID=$(echo "$SERVICE_VTJSC_OUTPUT" | sed -n '2p')

  # Download logo
  SERVICE_LOGO_DATA_URI=$(download_logo_data_uri "$SERVICE_LOGO_URL")

  # Build Service credential claims
  SERVICE_CLAIMS=$(jq -n \
    --arg id "$AGENT_DID" \
    --arg name "$SERVICE_NAME" \
    --arg type "$SERVICE_TYPE" \
    --arg desc "$SERVICE_DESCRIPTION" \
    --arg logo "$SERVICE_LOGO_DATA_URI" \
    --argjson age "$SERVICE_MIN_AGE" \
    --arg terms "$SERVICE_TERMS" \
    --arg privacy "$SERVICE_PRIVACY" \
    '{id: $id, name: $name, type: $type, description: $desc, logo: $logo, minimumAgeRequired: $age, termsAndConditions: $terms, privacyPolicy: $privacy}')

  # Issue Service credential from organization-vs, link on local agent
  issue_remote_and_link "$ORG_VS_ADMIN_URL" "$ADMIN_API" "service" "$SERVICE_JSC_URL" "$AGENT_DID" "$SERVICE_CLAIMS"
fi

# =============================================================================
# STEP 4: Obtain ISSUER permission for organization-vs schema (VP flow)
# =============================================================================

log "Step 4: Obtain ISSUER permission for organization-vs schema"

# Discover the custom schema from organization-vs DID document
# The organization-vs public endpoint serves its DID document
if [ -z "$ORG_VS_PUBLIC_URL" ]; then
  # Derive from org agent's DID
  ORG_AGENT_DID=$(curl -sf "${ORG_VS_ADMIN_URL}/v1/agent" | jq -r '.publicDid')
  ok "Organization VS DID: $ORG_AGENT_DID"
else
  ORG_AGENT_DID=""
fi

# Find VTJSC entries in the org's DID document that are NOT organization/service
# (those are the custom schema VTJSCs)
log "Looking for custom schema VTJSC in organization-vs..."
ORG_PUBLIC_API="${ORG_VS_PUBLIC_URL:-}"
if [ -z "$ORG_PUBLIC_API" ]; then
  # If organization-vs is local, try its public port
  ORG_PUBLIC_PORT="${ORG_VS_PUBLIC_PORT:-3001}"
  ORG_PUBLIC_API="http://localhost:${ORG_PUBLIC_PORT}"
fi

ORG_DID_DOC=$(curl -sf "${ORG_PUBLIC_API}/.well-known/did.json" 2>/dev/null || echo "{}")
if [ "$ORG_DID_DOC" = "{}" ]; then
  err "Could not fetch organization-vs DID document from $ORG_PUBLIC_API"
  err "Set ORG_VS_PUBLIC_URL to the organization-vs public endpoint."
  exit 1
fi

# Find the custom schema VTJSC (not organization-jsc-vp, not service-jsc-vp)
CUSTOM_VP_URL=$(echo "$ORG_DID_DOC" | jq -r '
  .service[] |
  select(.type == "LinkedVerifiablePresentation") |
  select(.id | test("organization-jsc-vp|service-jsc-vp") | not) |
  select(.id | test("jsc-vp")) |
  .serviceEndpoint' | head -1)

if [ -z "$CUSTOM_VP_URL" ]; then
  err "No custom schema VTJSC found in organization-vs DID document"
  exit 1
fi
ok "Custom schema VTJSC VP: $CUSTOM_VP_URL"

# Fetch VP and extract schema ref
CUSTOM_VP=$(curl -sf "$CUSTOM_VP_URL")
CUSTOM_SCHEMA_REF=$(echo "$CUSTOM_VP" | jq -r '.verifiableCredential[0].credentialSubject.jsonSchema."$ref" // empty')
CUSTOM_SCHEMA_ID=$(echo "$CUSTOM_SCHEMA_REF" | grep -oE '[0-9]+$')

if [ -z "$CUSTOM_SCHEMA_ID" ]; then
  err "Could not extract schema ID from organization-vs VTJSC"
  exit 1
fi
ok "Organization-vs custom schema ID: $CUSTOM_SCHEMA_ID"

# Check if ISSUER permission already exists
if EXISTING_PERM=$(find_active_issuer_perm "$CUSTOM_SCHEMA_ID" "$AGENT_DID"); then
  ok "Active ISSUER permission already exists: $EXISTING_PERM — skipping"
else
  log "Obtaining ISSUER permission via VP flow..."

  # Discover root permission
  ROOT_PERM_ID=$(discover_active_root_perm "$CUSTOM_SCHEMA_ID")

  check_balance "$USER_ACC"

  # Start VP flow
  START_RESULT=$(veranad tx perm start-perm-vp \
    issuer "$ROOT_PERM_ID" \
    --did "$AGENT_DID" \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --node "$NODE_RPC" \
    --output json -y 2>&1 | extract_tx_json)
  START_TX_HASH=$(echo "$START_RESULT" | jq -r '.txhash // empty')
  if [ -z "$START_TX_HASH" ]; then
    err "Failed to start ISSUER VP. Output: $START_RESULT"
    exit 1
  fi
  ok "VP start TX: $START_TX_HASH"
  sleep 8

  ISSUER_PERM_ID=$(extract_tx_event "$START_TX_HASH" "start_permission_vp" "permission_id" || true)
  if [ -z "$ISSUER_PERM_ID" ]; then
    sleep 6
    ISSUER_PERM_ID=$(extract_tx_event "$START_TX_HASH" "start_permission_vp" "permission_id" || true)
  fi
  if [ -z "$ISSUER_PERM_ID" ]; then
    err "Could not extract permission ID from start-perm-vp"
    exit 1
  fi

  # Validate (ecosystem authority — in demo, same account controls org)
  check_balance "$USER_ACC"
  VALIDATE_RESULT=$(veranad tx perm set-perm-vp-validated \
    "$ISSUER_PERM_ID" \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --node "$NODE_RPC" \
    --output json -y 2>&1 | extract_tx_json)
  VALIDATE_TX_HASH=$(echo "$VALIDATE_RESULT" | jq -r '.txhash // empty')
  if [ -z "$VALIDATE_TX_HASH" ]; then
    err "Failed to validate ISSUER perm. Output: $VALIDATE_RESULT"
    exit 1
  fi
  sleep 6
  ok "ISSUER permission validated: $ISSUER_PERM_ID"
fi

# =============================================================================
# STEP 5: AnonCreds credential definition (optional)
# =============================================================================

ANONCREDS_CRED_DEF_ID=""
if [ "$ENABLE_ANONCREDS" = "true" ]; then
  log "Step 5: AnonCreds credential definition"

  # Check if already exists on this issuer agent
  PUBLIC_URL="http://localhost:${VS_AGENT_PUBLIC_PORT}"
  EXISTING_ANONCREDS=$(curl -sf "${PUBLIC_URL}/resources?resourceType=anonCredsCredDef" \
    | jq -r '. | length' 2>/dev/null || echo "0")
  if [ "${EXISTING_ANONCREDS:-0}" -gt 0 ]; then
    ANONCREDS_CRED_DEF_ID=$(curl -sf "${PUBLIC_URL}/resources?resourceType=anonCredsCredDef" \
      | jq -r '.[0].id // empty' 2>/dev/null || echo "")
    ok "AnonCreds credential definition already exists: ${ANONCREDS_CRED_DEF_ID} — skipping"
  else
    # Find the VTJSC (json schema credential) for the custom schema
    VTJSC_VPR_REF="vpr:verana:${CHAIN_ID}/cs/v1/js/${CUSTOM_SCHEMA_ID}"
    VTJSC_CRED_ID=$(curl -sf "${ADMIN_API}/v1/vt/json-schema-credentials" \
      | jq -r --arg sid "$VTJSC_VPR_REF" '.data[] | select(.schemaId == $sid) | .credential.id')
    if [ -z "$VTJSC_CRED_ID" ]; then
      err "Could not find VTJSC for schema $CUSTOM_SCHEMA_ID"
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
  log "Step 5: AnonCreds — skipped (ENABLE_ANONCREDS=false)"
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
CUSTOM_SCHEMA_ID=${CUSTOM_SCHEMA_ID:-}
ANONCREDS_CRED_DEF_ID=${ANONCREDS_CRED_DEF_ID:-}
EOF

ok "IDs saved to ${OUTPUT_FILE}"

# =============================================================================
# Summary
# =============================================================================

log "Issuer Chatbot VS setup complete!"
echo ""
echo "  Agent DID         : $AGENT_DID"
echo "  Public URL        : $NGROK_URL"
echo "  Admin API         : $ADMIN_API"
echo "  Schema ID         : ${CUSTOM_SCHEMA_ID:-n/a}"
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
