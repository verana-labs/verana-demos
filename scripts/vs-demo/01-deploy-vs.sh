#!/usr/bin/env bash
# =============================================================================
# 01-deploy-vs.sh — Deploy a Verifiable Service and obtain ECS credentials
# =============================================================================
#
# This script deploys a VS Agent locally (Docker + ngrok), obtains an
# Organization credential from the ECS Trust Registry, and self-issues a
# Service credential. The agent ends up with both credentials linked as
# Verifiable Presentations in its DID Document.
#
# Supports both devnet and testnet (identical ECS configuration).
#
# Prerequisites:
#   - docker (with linux/amd64 support)
#   - ngrok (authenticated, https://ngrok.com)
#   - veranad binary (https://github.com/verana-labs/verana-blockchain)
#   - curl, jq
#
# Usage:
#   # Copy and edit the example config
#   cp config/example-vs.env my-vs.env
#   # Source it and run
#   source my-vs.env
#   ./scripts/vs-demo/01-deploy-vs.sh
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
# STEP 1: Deploy VS Agent with ngrok
# =============================================================================

log "Step 1: Deploy VS Agent"

# Clean up any previous instance
docker rm -f "$VS_AGENT_CONTAINER_NAME" 2>/dev/null || true

# Pull the image (amd64 for Apple Silicon compatibility)
log "Pulling VS Agent image..."
docker pull --platform linux/amd64 "$VS_AGENT_IMAGE" 2>&1 | tail -1

# Start ngrok tunnel for the public port
log "Starting ngrok tunnel on port ${VS_AGENT_PUBLIC_PORT}..."
pkill -f "ngrok http ${VS_AGENT_PUBLIC_PORT}" 2>/dev/null || true
sleep 1
ngrok http "$VS_AGENT_PUBLIC_PORT" --log=stdout > /tmp/ngrok-vs-demo.log 2>&1 &
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
docker run --platform linux/amd64 -d \
  -p "${VS_AGENT_PUBLIC_PORT}:3001" \
  -p "${VS_AGENT_ADMIN_PORT}:3000" \
  -v "${VS_AGENT_DATA_DIR}:/root/.afj" \
  -e "AGENT_PUBLIC_DID=did:webvh:${NGROK_DOMAIN}" \
  -e "AGENT_LABEL=${SERVICE_NAME}" \
  -e "ENABLE_PUBLIC_API_SWAGGER=true" \
  --name "$VS_AGENT_CONTAINER_NAME" \
  "$VS_AGENT_IMAGE"

log "Waiting for VS Agent to initialize (up to 60s)..."
if wait_for_agent "$ADMIN_API"; then
  ok "VS Agent is running"
else
  err "VS Agent failed to start. Check: docker logs $VS_AGENT_CONTAINER_NAME"
  exit 1
fi

# Get the agent DID
AGENT_INFO=$(curl -sf "${ADMIN_API}/v1/agent")
AGENT_DID=$(echo "$AGENT_INFO" | jq -r '.publicDid')
ok "VS Agent DID: $AGENT_DID"

# =============================================================================
# STEP 2: Clean up self-generated items
# =============================================================================

log "Step 2: Clean up self-generated VTJSCs and linked credentials"
cleanup_self_generated "$ADMIN_API"
ok "Self-generated items removed"

# =============================================================================
# STEP 3: Set up veranad CLI
# =============================================================================

log "Step 3: Set up veranad CLI"
setup_veranad_account "$USER_ACC" "$FAUCET_URL"

# =============================================================================
# STEP 4: Obtain Organization credential from ECS Trust Registry
# =============================================================================

log "Step 4: Obtain Organization credential from ECS TR"

# Download and base64-encode logos
log "Downloading and encoding logos..."
ORG_LOGO_B64=$(curl -sfL "$ORG_LOGO_URL" | base64 | tr -d '\n')
if [ -z "$ORG_LOGO_B64" ]; then
  err "Failed to download org logo from $ORG_LOGO_URL"
  exit 1
fi
SERVICE_LOGO_B64=$(curl -sfL "$SERVICE_LOGO_URL" | base64 | tr -d '\n')
if [ -z "$SERVICE_LOGO_B64" ]; then
  err "Failed to download service logo from $SERVICE_LOGO_URL"
  exit 1
fi
ok "Logos downloaded and base64-encoded"

# Request Organization credential from ECS TR, link on local agent
ORG_CLAIMS=$(jq -n \
  --arg id "$AGENT_DID" \
  --arg name "$ORG_NAME" \
  --arg logo "$ORG_LOGO_B64" \
  --arg rid "$ORG_REGISTRY_ID" \
  --arg addr "$ORG_ADDRESS" \
  --arg cc "$ORG_COUNTRY" \
  '{id: $id, name: $name, logo: $logo, registryId: $rid, address: $addr, countryCode: $cc}')

issue_remote_and_link "$ECS_TR_ADMIN_API" "$ADMIN_API" "organization" "$ORG_JSC_URL" "$AGENT_DID" "$ORG_CLAIMS"

# =============================================================================
# STEP 5: Self-create ISSUER permission for Service schema (OPEN mode)
# =============================================================================

log "Step 5: Self-create ISSUER permission for Service schema"

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
  --arg logo "$SERVICE_LOGO_B64" \
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
VS_AGENT_ADMIN_PORT=${VS_AGENT_ADMIN_PORT}
VS_AGENT_PUBLIC_PORT=${VS_AGENT_PUBLIC_PORT}

# Verana account
USER_ACC=${USER_ACC}
USER_ACC_ADDR=${USER_ACC_ADDR}

# Chain
CHAIN_ID=${CHAIN_ID}
NODE_RPC=${NODE_RPC}

# ECS credentials
CS_SERVICE_ID=${CS_SERVICE_ID}
ISSUER_PERM_SERVICE=${ISSUER_PERM_SERVICE}
EOF

ok "Resource IDs saved to ${OUTPUT_FILE}"

# =============================================================================
# Summary
# =============================================================================

log "Part 1 complete!"
echo ""
echo "  VS Agent DID      : $AGENT_DID"
echo "  Public URL         : $NGROK_URL"
echo "  DID Document       : ${NGROK_URL}/.well-known/did.json"
echo "  Admin API          : $ADMIN_API"
echo "  Linked VPs         : $VP_COUNT"
echo ""
echo "  Your Verifiable Service is now registered with the ECS ecosystem."
echo "  Run 02-create-trust-registry.sh to create your own Trust Registry."
echo ""
echo "  To stop: docker rm -f $VS_AGENT_CONTAINER_NAME && kill $NGROK_PID"
echo ""
