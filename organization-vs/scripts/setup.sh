#!/usr/bin/env bash
# =============================================================================
# Organization VS — Local Setup
# =============================================================================
#
# This script sets up the Organization VS Agent locally:
#   1. Deploys the VS Agent via Docker + ngrok
#   2. Sets up the veranad CLI account
#   3. Obtains Organization + Service credentials from ECS TR
#   4. Creates a Trust Registry with a custom schema
#   5. Creates an AnonCreds credential definition (optional)
#
# Idempotent: checks for existing resources before creating new ones.
#
# Prerequisites:
#   - Docker
#   - ngrok (authenticated)
#   - curl, jq
#
# Usage:
#   source organization-vs/config.env
#   ./organization-vs/scripts/setup.sh
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
VS_AGENT_CONTAINER_NAME="${VS_AGENT_CONTAINER_NAME:-organization-vs}"
VS_AGENT_ADMIN_PORT="${VS_AGENT_ADMIN_PORT:-3000}"
VS_AGENT_PUBLIC_PORT="${VS_AGENT_PUBLIC_PORT:-3001}"
VS_AGENT_DATA_DIR="${VS_AGENT_DATA_DIR:-${SERVICE_DIR}/data}"
SERVICE_NAME="${SERVICE_NAME:-Example Organization Service}"
USER_ACC="${USER_ACC:-org-vs-admin}"
OUTPUT_FILE="${OUTPUT_FILE:-${SERVICE_DIR}/ids.env}"

# Schema
CUSTOM_SCHEMA_URL="${CUSTOM_SCHEMA_URL:-}"
CUSTOM_SCHEMA_FILE="${CUSTOM_SCHEMA_FILE:-${SERVICE_DIR}/schema.json}"
CUSTOM_SCHEMA_BASE_ID="${CUSTOM_SCHEMA_BASE_ID:-example}"

# Trust Registry
TR_REGISTRY_URL="${TR_REGISTRY_URL:-}"
EGF_LANGUAGE="${EGF_LANGUAGE:-en}"
EGF_DOC_URL="${EGF_DOC_URL:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"
EGF_DOC_DIGEST="${EGF_DOC_DIGEST:-}"
VALIDATION_FEES="${VALIDATION_FEES:-0}"
ISSUANCE_FEES="${ISSUANCE_FEES:-0}"
VERIFICATION_FEES="${VERIFICATION_FEES:-0}"

# AnonCreds
ENABLE_ANONCREDS="${ENABLE_ANONCREDS:-true}"
ANONCREDS_NAME="${ANONCREDS_NAME:-${CUSTOM_SCHEMA_BASE_ID}}"
ANONCREDS_VERSION="${ANONCREDS_VERSION:-1.0}"
ANONCREDS_SUPPORT_REVOCATION="${ANONCREDS_SUPPORT_REVOCATION:-false}"

# Organization details
ORG_NAME="${ORG_NAME:-Verana Example Organization}"
ORG_COUNTRY="${ORG_COUNTRY:-CH}"
ORG_LOGO_URL="${ORG_LOGO_URL:-https://verana.io/logo.svg}"
ORG_REGISTRY_ID="${ORG_REGISTRY_ID:-CH-CHE-123.456.789}"
ORG_ADDRESS="${ORG_ADDRESS:-Bahnhofstrasse 42, 8001 Zurich, Switzerland}"

# Service details
SERVICE_TYPE="${SERVICE_TYPE:-IssuerService}"
SERVICE_DESCRIPTION="${SERVICE_DESCRIPTION:-Organization service for the Verana demo ecosystem}"
SERVICE_LOGO_URL="${SERVICE_LOGO_URL:-https://verana.io/logo.svg}"
SERVICE_MIN_AGE="${SERVICE_MIN_AGE:-0}"
SERVICE_TERMS="${SERVICE_TERMS:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"
SERVICE_PRIVACY="${SERVICE_PRIVACY:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"

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
  curl -sfL "https://github.com/verana-labs/verana/releases/download/${VERANAD_VERSION}/veranad-${PLATFORM}-${ARCH}" \
    -o /usr/local/bin/veranad 2>/dev/null || {
    curl -sfL "https://github.com/verana-labs/verana/releases/download/${VERANAD_VERSION}/veranad-${PLATFORM}-${ARCH}" \
      -o "${HOME}/.local/bin/veranad"
    export PATH="${HOME}/.local/bin:$PATH"
  }
  chmod +x "$(command -v veranad || echo /usr/local/bin/veranad)"
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

# Pull the image; fall back to local cache if pull fails
log "Pulling VS Agent image..."
if ! docker pull --platform linux/amd64 "$VS_AGENT_IMAGE" 2>&1 | tail -1; then
  if docker image inspect "$VS_AGENT_IMAGE" > /dev/null 2>&1; then
    warn "Pull failed — using locally cached image: $VS_AGENT_IMAGE"
  else
    err "Pull failed and no local image found for: $VS_AGENT_IMAGE"
    exit 1
  fi
fi

# Start ngrok tunnel for the public port
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
  --name "$VS_AGENT_CONTAINER_NAME" \
  "$VS_AGENT_IMAGE"

ok "VS Agent container started: $VS_AGENT_CONTAINER_NAME"

# Wait for the agent to initialize
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
# STEP 3: Get ECS credentials (Organization + Service)
# =============================================================================

log "Step 3: Get ECS credentials"

# Discover ECS VTJSCs
ORG_VTJSC_OUTPUT=$(discover_ecs_vtjsc "$ECS_TR_PUBLIC_URL" "organization")
ORG_JSC_URL=$(echo "$ORG_VTJSC_OUTPUT" | sed -n '1p')

SERVICE_VTJSC_OUTPUT=$(discover_ecs_vtjsc "$ECS_TR_PUBLIC_URL" "service")
SERVICE_JSC_URL=$(echo "$SERVICE_VTJSC_OUTPUT" | sed -n '1p')
CS_SERVICE_ID=$(echo "$SERVICE_VTJSC_OUTPUT" | sed -n '2p')

# Clean up previous ECS credentials
cleanup_ecs_credentials "$ADMIN_API" "$ORG_JSC_URL" "$SERVICE_JSC_URL"

# Obtain Organization credential from ECS TR
log "Downloading logos..."
ORG_LOGO_DATA_URI=$(download_logo_data_uri "$ORG_LOGO_URL")
SERVICE_LOGO_DATA_URI=$(download_logo_data_uri "$SERVICE_LOGO_URL")

ORG_CLAIMS=$(jq -n \
  --arg id "$AGENT_DID" \
  --arg name "$ORG_NAME" \
  --arg logo "$ORG_LOGO_DATA_URI" \
  --arg rid "$ORG_REGISTRY_ID" \
  --arg addr "$ORG_ADDRESS" \
  --arg cc "$ORG_COUNTRY" \
  '{id: $id, name: $name, logo: $logo, registryId: $rid, address: $addr, countryCode: $cc}')

issue_remote_and_link "$ECS_TR_ADMIN_API" "$ADMIN_API" "organization" "$ORG_JSC_URL" "$AGENT_DID" "$ORG_CLAIMS"

# Ensure ISSUER permission for Service schema
if EXISTING_PERM=$(find_active_issuer_perm "$CS_SERVICE_ID" "$AGENT_DID"); then
  ok "Active ISSUER permission already exists: $EXISTING_PERM — skipping"
else
  log "Creating ISSUER permission for Service schema..."
  check_balance "$USER_ACC"
  EFFECTIVE_FROM=$(future_timestamp 15)
  submit_tx "create_permission" "permission_id" \
    veranad tx perm create-perm "$CS_SERVICE_ID" issuer "$AGENT_DID" \
    --effective-from "$EFFECTIVE_FROM"
  sleep 21
fi

# Self-issue Service credential
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

issue_remote_and_link "$ADMIN_API" "$ADMIN_API" "service" "$SERVICE_JSC_URL" "$AGENT_DID" "$SERVICE_CLAIMS"

# =============================================================================
# STEP 4: Create Trust Registry + credential schema
# =============================================================================

log "Step 4: Create Trust Registry"

# Load schema
if [ -n "$CUSTOM_SCHEMA_URL" ]; then
  SCHEMA_JSON=$(download_schema "$CUSTOM_SCHEMA_URL")
else
  SCHEMA_JSON=$(jq -c '.' "$CUSTOM_SCHEMA_FILE")
fi

# Check if a trust registry already exists for this schema
if EXISTING=$(has_trust_registry_for_schema "$AGENT_DID" "$SCHEMA_JSON"); then
  EXISTING_TR_ID=$(echo "$EXISTING" | awk '{print $1}')
  EXISTING_CS_ID=$(echo "$EXISTING" | awk '{print $2}')
  ok "Trust registry already exists (TR=$EXISTING_TR_ID, CS=$EXISTING_CS_ID) — skipping"
  TRUST_REG_ID="$EXISTING_TR_ID"
  CUSTOM_SCHEMA_ID="$EXISTING_CS_ID"
else
  log "Creating Trust Registry..."

  # Compute EGF digest
  if [ -z "$EGF_DOC_DIGEST" ]; then
    EGF_DOC_DIGEST=$(compute_sri_digest "$EGF_DOC_URL")
    ok "EGF digest: $EGF_DOC_DIGEST"
  fi

  TR_REGISTRY_URL="${TR_REGISTRY_URL:-${NGROK_URL}}"

  check_balance "$USER_ACC"
  TRUST_REG_ID=$(submit_tx "create_trust_registry" "trust_registry_id" \
    veranad tx tr create-trust-registry \
    "$AGENT_DID" "$EGF_LANGUAGE" "$EGF_DOC_URL" "$EGF_DOC_DIGEST" \
    --aka "$TR_REGISTRY_URL")
  ok "Trust Registry: $TRUST_REG_ID"

  # Create credential schema (issuer_mode=ECOSYSTEM, verifier_mode=OPEN)
  check_balance "$USER_ACC"
  CUSTOM_SCHEMA_ID=$(submit_tx "create_credential_schema" "credential_schema_id" \
    veranad tx cs create-credential-schema "$TRUST_REG_ID" "$SCHEMA_JSON" \
    --issuer-grantor-validation-validity-period '{"value":0}' \
    --verifier-grantor-validation-validity-period '{"value":0}' \
    --issuer-validation-validity-period '{"value":0}' \
    --verifier-validation-validity-period '{"value":0}' \
    --holder-validation-validity-period '{"value":0}' \
    3 1)
  ok "Schema: $CUSTOM_SCHEMA_ID"

  # Create root permission
  check_balance "$USER_ACC"
  EFFECTIVE_FROM=$(future_timestamp 15)
  ROOT_PERM_ID=$(submit_tx "create_root_permission" "root_permission_id" \
    veranad tx perm create-root-perm \
    "$CUSTOM_SCHEMA_ID" "$AGENT_DID" \
    "$VALIDATION_FEES" "$ISSUANCE_FEES" "$VERIFICATION_FEES" \
    --effective-from "$EFFECTIVE_FROM")
  sleep 21

  # Obtain ISSUER permission via VP flow
  check_balance "$USER_ACC"
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

  # Validate ISSUER permission
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

  # Create VTJSC for custom schema
  curl -sf -X POST "${ADMIN_API}/v1/vt/json-schema-credentials" \
    -H 'Content-Type: application/json' \
    -d "{\"schemaBaseId\": \"${CUSTOM_SCHEMA_BASE_ID}\", \"jsonSchemaRef\": \"vpr:verana:${CHAIN_ID}/cs/v1/js/${CUSTOM_SCHEMA_ID}\"}" \
    -o /dev/null
  ok "VTJSC created for '${CUSTOM_SCHEMA_BASE_ID}'"
fi

# =============================================================================
# STEP 5: AnonCreds credential definition — SKIPPED
# =============================================================================
# NOTE: organization-vs no longer creates a credential definition.
# Each issuer (issuer-chatbot-vs, issuer-web-vs) creates its own credential
# definition pointing to the jsonSchemaCredential published by this service.

log "Step 5: AnonCreds credential definition — skipped (issuers create their own)"

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
TRUST_REG_ID=${TRUST_REG_ID:-}
CUSTOM_SCHEMA_ID=${CUSTOM_SCHEMA_ID:-}
EOF

ok "IDs saved to ${OUTPUT_FILE}"

# =============================================================================
# Summary
# =============================================================================

log "Organization VS setup complete!"
echo ""
echo "  Agent DID         : $AGENT_DID"
echo "  Public URL        : $NGROK_URL"
echo "  DID Document      : ${NGROK_URL}/.well-known/did.json"
echo "  Admin API         : $ADMIN_API"
echo "  Trust Registry    : ${TRUST_REG_ID:-n/a}"
echo "  Schema ID         : ${CUSTOM_SCHEMA_ID:-n/a}"
echo ""
echo "  To stop:"
echo "    docker stop $VS_AGENT_CONTAINER_NAME"
echo "    kill $NGROK_PID  # ngrok"
echo ""
