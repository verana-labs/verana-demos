#!/usr/bin/env bash
# =============================================================================
# 01-deploy-vs.sh — Deploy a Verifiable Service (VS) Agent locally
# =============================================================================
#
# This script:
#   1. Deploys a VS Agent via Docker + ngrok
#   2. Waits for the agent to initialize
#   3. Retrieves the agent DID
#   4. Sets up the veranad CLI account
#
# After running this script, use 02-get-ecs-credentials.sh to obtain ECS
# credentials (Organization + Service) for the deployed agent.
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

# Service label (used as agent display name)
SERVICE_NAME="${SERVICE_NAME:-Example Verana Service}"

# CLI account
USER_ACC="${USER_ACC:-vs-demo-admin}"

# Output file
OUTPUT_FILE="${OUTPUT_FILE:-vs-demo-ids.env}"

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
USER_ACC=${USER_ACC}
EOF

ok "Resource IDs saved to ${OUTPUT_FILE}"

# =============================================================================
# Summary
# =============================================================================

log "VS Agent deployed!"
echo ""
echo "  VS Agent DID      : $AGENT_DID"
echo "  Public URL        : $NGROK_URL"
echo "  DID Document      : ${NGROK_URL}/.well-known/did.json"
echo "  Admin API         : $ADMIN_API"
echo ""
echo "  Next step: ./02-get-ecs-credentials.sh"
echo ""
echo "  To stop the service:"
echo "    docker stop $VS_AGENT_CONTAINER_NAME"
echo "    kill $NGROK_PID  # ngrok"
echo ""
