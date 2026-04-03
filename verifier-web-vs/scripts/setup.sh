#!/usr/bin/env bash
# =============================================================================
# Verifier Web VS — Local Setup
# =============================================================================
#
# This script sets up the Verifier Web VS Agent locally (child service):
#   1. Deploys the VS Agent via Docker + ngrok
#   2. Sets up the veranad CLI account
#   3. Obtains a Service credential from organization-vs
#   4. Self-creates a VERIFIER permission for the organization-vs schema
#
# Requires organization-vs to be running and its admin API reachable.
#
# Prerequisites:
#   - Docker, ngrok (authenticated), curl, jq
#   - Organization VS running (ORG_VS_ADMIN_URL reachable)
#
# Usage:
#   source verifier-web-vs/config.env
#   ./verifier-web-vs/scripts/setup.sh
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
VS_AGENT_CONTAINER_NAME="${VS_AGENT_CONTAINER_NAME:-verifier-web-vs}"
VS_AGENT_ADMIN_PORT="${VS_AGENT_ADMIN_PORT:-3008}"
VS_AGENT_PUBLIC_PORT="${VS_AGENT_PUBLIC_PORT:-3009}"
VS_AGENT_DATA_DIR="${VS_AGENT_DATA_DIR:-${SERVICE_DIR}/data}"
SERVICE_NAME="${SERVICE_NAME:-Example Web Verifier}"
USER_ACC="${USER_ACC:-org-vs-admin}"
OUTPUT_FILE="${OUTPUT_FILE:-${SERVICE_DIR}/ids.env}"

# Organization VS
ORG_VS_ADMIN_URL="${ORG_VS_ADMIN_URL:-http://localhost:3000}"
ORG_VS_PUBLIC_URL="${ORG_VS_PUBLIC_URL:-}"

# Service details
SERVICE_TYPE="${SERVICE_TYPE:-VerifierService}"
SERVICE_DESCRIPTION="${SERVICE_DESCRIPTION:-Web-based credential verifier for the Verana demo ecosystem}"
SERVICE_LOGO_URL="${SERVICE_LOGO_URL:-https://verana.io/logo.svg}"
SERVICE_MIN_AGE="${SERVICE_MIN_AGE:-0}"
SERVICE_TERMS="${SERVICE_TERMS:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"
SERVICE_PRIVACY="${SERVICE_PRIVACY:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"

# Issuer VS — discover credential definition from this issuer's public API
ISSUER_VS_PUBLIC_URL="${ISSUER_VS_PUBLIC_URL:-http://localhost:3005}"

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
ngrok http "$VS_AGENT_PUBLIC_PORT" --log=stdout > /tmp/ngrok-verifier-web-vs.log 2>&1 &
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
  SERVICE_VTJSC_OUTPUT=$(discover_ecs_vtjsc "$ECS_TR_PUBLIC_URL" "service")
  SERVICE_JSC_URL=$(echo "$SERVICE_VTJSC_OUTPUT" | sed -n '1p')

  SERVICE_LOGO_DATA_URI=$(download_logo_data_uri "$SERVICE_LOGO_URL")

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

  issue_remote_and_link "$ORG_VS_ADMIN_URL" "$ADMIN_API" "service" "$SERVICE_JSC_URL" "$AGENT_DID" "$SERVICE_CLAIMS"
fi

# =============================================================================
# STEP 4: Self-create VERIFIER permission for organization-vs schema
# =============================================================================

log "Step 4: Self-create VERIFIER permission for organization-vs schema"

# Discover custom schema from organization-vs DID document
ORG_PUBLIC_API="${ORG_VS_PUBLIC_URL:-}"
if [ -z "$ORG_PUBLIC_API" ]; then
  ORG_PUBLIC_PORT="${ORG_VS_PUBLIC_PORT:-3001}"
  ORG_PUBLIC_API="http://localhost:${ORG_PUBLIC_PORT}"
fi

ORG_DID_DOC=$(curl -sf "${ORG_PUBLIC_API}/.well-known/did.json" 2>/dev/null || echo "{}")
if [ "$ORG_DID_DOC" = "{}" ]; then
  err "Could not fetch organization-vs DID document from $ORG_PUBLIC_API"
  err "Set ORG_VS_PUBLIC_URL to the organization-vs public endpoint."
  exit 1
fi

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

CUSTOM_VP=$(curl -sf "$CUSTOM_VP_URL")
CUSTOM_SCHEMA_REF=$(echo "$CUSTOM_VP" | jq -r '.verifiableCredential[0].credentialSubject.jsonSchema."$ref" // empty')
CUSTOM_SCHEMA_ID=$(echo "$CUSTOM_SCHEMA_REF" | grep -oE '[0-9]+$')

if [ -z "$CUSTOM_SCHEMA_ID" ]; then
  err "Could not extract schema ID from organization-vs VTJSC"
  exit 1
fi
ok "Organization-vs custom schema ID: $CUSTOM_SCHEMA_ID"

# Check if VERIFIER permission already exists
if EXISTING_PERM=$(find_active_perm "$CUSTOM_SCHEMA_ID" "VERIFIER" "$AGENT_DID"); then
  ok "Active VERIFIER permission already exists: $EXISTING_PERM — skipping"
  VERIFIER_PERM_ID="$EXISTING_PERM"
else
  # Self-create VERIFIER permission (verifier_mode=OPEN, so no VP needed)
  log "Creating VERIFIER permission..."
  check_balance "$USER_ACC"
  EFFECTIVE_FROM=$(future_timestamp 15)

  VERIFIER_PERM_ID=$(submit_tx "create_permission" "permission_id" \
    veranad tx perm create-perm "$CUSTOM_SCHEMA_ID" verifier "$AGENT_DID" \
    --effective-from "$EFFECTIVE_FROM")

  ok "VERIFIER permission created: $VERIFIER_PERM_ID"
  sleep 21
  ok "VERIFIER permission should now be active"
fi

# =============================================================================
# STEP 5: Discover AnonCreds credential definition from issuer-web-vs
# =============================================================================

log "Step 5: Discovering AnonCreds credential definition from issuer-web-vs..."
ANONCREDS_CRED_DEF_ID=$(curl -sf "${ISSUER_VS_PUBLIC_URL}/resources?resourceType=anonCredsCredDef" \
  | jq -r '.[0].id // empty' 2>/dev/null || echo "")
if [ -n "$ANONCREDS_CRED_DEF_ID" ]; then
  ok "AnonCreds cred def discovered from issuer-web-vs: $ANONCREDS_CRED_DEF_ID"
else
  err "No AnonCreds cred def found on issuer-web-vs (${ISSUER_VS_PUBLIC_URL})"
  err "Make sure issuer-web-vs is running and has created its credential definition"
  exit 1
fi

# =============================================================================
# Save IDs
# =============================================================================

log "Saving resource IDs to ${OUTPUT_FILE}"

cat > "$OUTPUT_FILE" <<EOF
# Verifier Web VS — Resource IDs
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Network: ${NETWORK}

AGENT_DID=${AGENT_DID}
NGROK_URL=${NGROK_URL}
VS_AGENT_CONTAINER_NAME=${VS_AGENT_CONTAINER_NAME}
VS_AGENT_ADMIN_PORT=${VS_AGENT_ADMIN_PORT}
VS_AGENT_PUBLIC_PORT=${VS_AGENT_PUBLIC_PORT}
USER_ACC=${USER_ACC}
CUSTOM_SCHEMA_ID=${CUSTOM_SCHEMA_ID:-}
VERIFIER_PERM_ID=${VERIFIER_PERM_ID:-}
ANONCREDS_CRED_DEF_ID=${ANONCREDS_CRED_DEF_ID:-}
EOF

ok "IDs saved to ${OUTPUT_FILE}"

log "Verifier Web VS setup complete!"
echo ""
echo "  Agent DID         : $AGENT_DID"
echo "  Public URL        : $NGROK_URL"
echo "  Admin API         : $ADMIN_API"
echo "  Schema ID         : ${CUSTOM_SCHEMA_ID:-n/a}"
echo "  Verifier Perm     : ${VERIFIER_PERM_ID:-n/a}"
if [ -n "${ANONCREDS_CRED_DEF_ID:-}" ]; then
echo "  AnonCreds Cred Def: $ANONCREDS_CRED_DEF_ID (from issuer-web-vs)"
fi
echo ""
echo "  Start the web verifier:"
echo "    ./verifier-web-vs/scripts/start.sh"
echo ""
echo "  To stop:"
echo "    docker stop $VS_AGENT_CONTAINER_NAME"
echo "    kill $NGROK_PID  # ngrok"
echo ""
