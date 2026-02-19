#!/usr/bin/env bash
# =============================================================================
# 01-deploy-vs.sh — Deploy a Verifiable Service (VS) Agent locally
# =============================================================================
#
# This script:
#   1. Discovers ECS schema IDs from the ECS Trust Registry DID document
#   2. Deploys a VS Agent via Docker + ngrok
#   3. Sets up the veranad CLI account
#   4. Obtains an Organization credential from the ECS Trust Registry
#   5. Self-creates an ISSUER permission for the Service schema
#   6. Creates a Service VTJSC in the VS Agent
#   7. Self-issues a Service credential and links it as a VP
#   8. Verifies the setup
#
# Prerequisites:
#   - Docker
#   - ngrok (authenticated)
#   - veranad
#   - curl, jq
#
# Usage:
#   ./01-deploy-vs.sh
#   NETWORK=devnet ./01-deploy-vs.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

# ---------------------------------------------------------------------------
# Configuration — override via environment variables or a sourced .env file
# ---------------------------------------------------------------------------

# Network: devnet or testnet
NETWORK="${NETWORK:-testnet}"

# VS Agent
VS_AGENT_IMAGE="${VS_AGENT_IMAGE:-veranalabs/vs-agent:latest}"
VS_AGENT_CONTAINER_NAME="${VS_AGENT_CONTAINER_NAME:-vs-demo}"
VS_AGENT_ADMIN_PORT="${VS_AGENT_ADMIN_PORT:-3000}"
VS_AGENT_PUBLIC_PORT="${VS_AGENT_PUBLIC_PORT:-3001}"
VS_AGENT_DATA_DIR="${VS_AGENT_DATA_DIR:-$(pwd)/vs-agent-demo-data}"

# CLI account
USER_ACC="${USER_ACC:-vs-demo-admin}"

# Organization details
ORG_NAME="${ORG_NAME:-Verana Example Organization}"
ORG_COUNTRY="${ORG_COUNTRY:-CH}"
ORG_LOGO_URL="${ORG_LOGO_URL:-https://verana.io/logo.svg}"
ORG_REGISTRY_ID="${ORG_REGISTRY_ID:-CH-CHE-123.456.789}"
ORG_ADDRESS="${ORG_ADDRESS:-Bahnhofstrasse 42, 8001 Zurich, Switzerland}"

# Service details
SERVICE_NAME="${SERVICE_NAME:-Example Verana Service}"
SERVICE_TYPE="${SERVICE_TYPE:-IssuerService}"
SERVICE_DESCRIPTION="${SERVICE_DESCRIPTION:-An example service using Verana, the Open Trust Layer}"
SERVICE_LOGO_URL="${SERVICE_LOGO_URL:-https://verana.io/logo.svg}"
SERVICE_MIN_AGE="${SERVICE_MIN_AGE:-0}"
SERVICE_TERMS="${SERVICE_TERMS:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"
SERVICE_PRIVACY="${SERVICE_PRIVACY:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"

# Output file
OUTPUT_FILE="${OUTPUT_FILE:-vs-demo-ids.env}"

# ---------------------------------------------------------------------------
# Set network-specific variables
# ---------------------------------------------------------------------------

set_network_vars "$NETWORK"
log "Network: $NETWORK (chain: $CHAIN_ID)"

ADMIN_API="http://localhost:${VS_AGENT_ADMIN_PORT}"

# ---------------------------------------------------------------------------
# Discover ECS schema IDs from the ECS Trust Registry DID document
# ---------------------------------------------------------------------------

# Discover Organization VTJSC (URL needed for issue-credential)
ORG_VTJSC_OUTPUT=$(discover_ecs_vtjsc "$ECS_TR_PUBLIC_URL" "organization")
ORG_JSC_URL=$(echo "$ORG_VTJSC_OUTPUT" | sed -n '1p')
CS_ORG_ID=$(echo "$ORG_VTJSC_OUTPUT" | sed -n '2p')
if [ -z "$ORG_JSC_URL" ] || [ -z "$CS_ORG_ID" ]; then
  err "Could not discover Organization VTJSC from ECS TR DID document"
  exit 1
fi

# Discover Service VTJSC (schema ID needed for issuer permission + VTJSC creation)
SERVICE_VTJSC_OUTPUT=$(discover_ecs_vtjsc "$ECS_TR_PUBLIC_URL" "service")
CS_SERVICE_ID=$(echo "$SERVICE_VTJSC_OUTPUT" | sed -n '2p')
if [ -z "$CS_SERVICE_ID" ]; then
  err "Could not discover Service schema ID from ECS TR DID document"
  exit 1
fi

# Discover the active root permission for the Service schema
ROOT_PERM_SERVICE=$(discover_active_root_perm "$CS_SERVICE_ID")
if [ -z "$ROOT_PERM_SERVICE" ]; then
  err "No active root permission for Service schema $CS_SERVICE_ID"
  exit 1
fi

# =============================================================================
# STEP 1: Deploy VS Agent
# =============================================================================

log "Step 1: Deploy VS Agent"

# Pull image
log "Pulling VS Agent image: $VS_AGENT_IMAGE"
docker pull "$VS_AGENT_IMAGE"

# Start ngrok tunnel
log "Starting ngrok tunnel on port $VS_AGENT_PUBLIC_PORT..."
ngrok http "$VS_AGENT_PUBLIC_PORT" --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!
sleep 3

NGROK_URL=$(curl -sf http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')
if [ -z "$NGROK_URL" ] || [ "$NGROK_URL" = "null" ]; then
  err "Could not get ngrok URL. Is ngrok running?"
  exit 1
fi
ok "ngrok URL: $NGROK_URL"

# Start VS Agent container
log "Starting VS Agent container..."
mkdir -p "$VS_AGENT_DATA_DIR"
docker run -d \
  --name "$VS_AGENT_CONTAINER_NAME" \
  -p "${VS_AGENT_ADMIN_PORT}:3000" \
  -p "${VS_AGENT_PUBLIC_PORT}:3001" \
  -v "${VS_AGENT_DATA_DIR}:/data" \
  -e "VS_AGENT_PUBLIC_URL=${NGROK_URL}" \
  -e "VS_AGENT_DATA_DIR=/data" \
  "$VS_AGENT_IMAGE"

ok "VS Agent container started: $VS_AGENT_CONTAINER_NAME"

# Wait for the agent to initialize
log "Waiting for VS Agent to initialize..."
if wait_for_agent "$ADMIN_API" 45; then
  ok "VS Agent is ready"
else
  err "VS Agent did not start within timeout"
  docker logs "$VS_AGENT_CONTAINER_NAME" 2>&1 | tail -20
  exit 1
fi

# =============================================================================
# STEP 2: Get agent DID
# =============================================================================

log "Step 2: Get agent DID"

AGENT_DID=$(curl -sf "${ADMIN_API}/v1/agent" | jq -r '.publicDid')
if [ -z "$AGENT_DID" ] || [ "$AGENT_DID" = "null" ]; then
  err "Could not retrieve agent DID"
  exit 1
fi
ok "Agent DID: $AGENT_DID"

# =============================================================================
# STEP 3: Set up veranad CLI
# =============================================================================

log "Step 3: Set up veranad CLI"
setup_veranad_account "$USER_ACC" "$FAUCET_URL"

# =============================================================================
# STEP 4: Obtain Organization credential from ECS Trust Registry
# =============================================================================

log "Step 4: Obtain Organization credential from ECS Trust Registry"

# Clean up self-generated items from VS Agent init
cleanup_self_generated "$ADMIN_API"

# Download logos and convert to data URIs (ECS schema requires data:<type>;base64,<data>)
log "Downloading logos and converting to data URIs..."
ORG_LOGO_DATA_URI=$(download_logo_data_uri "$ORG_LOGO_URL")
SERVICE_LOGO_DATA_URI=$(download_logo_data_uri "$SERVICE_LOGO_URL")
ok "Logos converted to data URIs"

ORG_CLAIMS=$(jq -n \
  --arg id "$AGENT_DID" \
  --arg name "$ORG_NAME" \
  --arg logo "$ORG_LOGO_DATA_URI" \
  --arg rid "$ORG_REGISTRY_ID" \
  --arg addr "$ORG_ADDRESS" \
  --arg cc "$ORG_COUNTRY" \
  '{id: $id, name: $name, logo: $logo, registryId: $rid, address: $addr, countryCode: $cc}')

issue_remote_and_link "$ECS_TR_ADMIN_API" "$ADMIN_API" "organization" "$ORG_JSC_URL" "$AGENT_DID" "$ORG_CLAIMS"

# =============================================================================
# STEP 5: Self-create ISSUER permission for Service schema (OPEN mode)
# =============================================================================

log "Step 5: Self-create ISSUER permission for Service schema"

# Verify account has funds before on-chain transactions
check_balance "$USER_ACC"

EFFECTIVE_FROM=$(future_timestamp 15)
log "Creating ISSUER permission (effective from: $EFFECTIVE_FROM)..."

ISSUER_PERM_SERVICE=$(submit_tx "create_permission" "permission_id" \
  veranad tx perm create-perm "$CS_SERVICE_ID" issuer "$AGENT_DID" \
  --effective-from "$EFFECTIVE_FROM")

ok "ISSUER permission for Service: perm_id=$ISSUER_PERM_SERVICE"

# Wait for permission to become effective
log "Waiting for ISSUER permission to become effective..."
sleep 21
ok "ISSUER permission should now be active"

# =============================================================================
# STEP 6: Create Service VTJSC in VS agent
# =============================================================================

log "Step 6: Create Service VTJSC"

VTJSC_RESULT=$(curl -sf -X POST "${ADMIN_API}/v1/vt/json-schema-credentials" \
  -H 'Content-Type: application/json' \
  -d "{\"schemaBaseId\": \"service\", \"jsonSchemaRef\": \"vpr:verana:${CHAIN_ID}/cs/v1/js/${CS_SERVICE_ID}\"}")

if [ -z "$VTJSC_RESULT" ] || echo "$VTJSC_RESULT" | jq -e '.statusCode' > /dev/null 2>&1; then
  err "Failed to create Service VTJSC. Response: $VTJSC_RESULT"
  exit 1
fi
ok "Service VTJSC created"

# =============================================================================
# STEP 7: Self-issue Service credential and link as VP
# =============================================================================

log "Step 7: Self-issue Service credential"

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

issue_and_link "$ADMIN_API" "service" "$CHAIN_ID" "$CS_SERVICE_ID" "$AGENT_DID" "$SERVICE_CLAIMS"

# =============================================================================
# STEP 8: Verify
# =============================================================================

log "Step 8: Verify"

# Check DID Document
DID_DOC=$(curl -sf "http://localhost:${VS_AGENT_PUBLIC_PORT}/.well-known/did.json")
VP_COUNT=$(echo "$DID_DOC" | jq '[.service[]? | select(.type == "LinkedVerifiablePresentation")] | length')
ok "DID Document has $VP_COUNT LinkedVerifiablePresentation entries"

# Check resolver (optional)
RESOLVE_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" \
  "${RESOLVER_URL}/v1/trust-resolve?did=${AGENT_DID}" 2>/dev/null || echo "000")
if [ "$RESOLVE_STATUS" = "200" ]; then
  ok "Resolver confirms the service is trusted"
else
  warn "Resolver returned HTTP $RESOLVE_STATUS (may not be available yet)"
  warn "Verify manually: ${NGROK_URL}/.well-known/did.json"
fi

# =============================================================================
# Save IDs
# =============================================================================

log "Saving resource IDs to ${OUTPUT_FILE}"

cat > "$OUTPUT_FILE" <<EOF
# VS Demo — Resource IDs
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Network: ${NETWORK}

# VS Agent
AGENT_DID=${AGENT_DID}
NGROK_URL=${NGROK_URL}
VS_AGENT_CONTAINER_NAME=${VS_AGENT_CONTAINER_NAME}

# Schema IDs (from ECS TR)
CS_ORG_ID=${CS_ORG_ID}
CS_SERVICE_ID=${CS_SERVICE_ID}

# Permissions
ROOT_PERM_SERVICE=${ROOT_PERM_SERVICE}
ISSUER_PERM_SERVICE=${ISSUER_PERM_SERVICE}
EOF

ok "Resource IDs saved to ${OUTPUT_FILE}"

# =============================================================================
# Summary
# =============================================================================

log "Deployment complete!"
echo ""
echo "  VS Agent DID      : $AGENT_DID"
echo "  Public URL        : $NGROK_URL"
echo "  DID Document      : ${NGROK_URL}/.well-known/did.json"
echo "  Admin API         : $ADMIN_API"
echo "  Linked VPs        : $VP_COUNT"
echo ""
echo "  To stop the service:"
echo "    docker stop $VS_AGENT_CONTAINER_NAME"
echo "    kill $NGROK_PID  # ngrok"
echo ""
