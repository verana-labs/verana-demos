#!/usr/bin/env bash
# =============================================================================
# Start the Issuer Chatbot locally
# =============================================================================
#
# Prerequisites:
#   - Issuer VS-Agent running (01-deploy-vs.sh + 02-get-ecs-credentials.sh + 03-create-trust-registry.sh)
#   - vs/config.env and vs/issuer-chatbot.env sourced
#
# Usage:
#   source vs/config.env
#   source vs/issuer-chatbot.env
#   ./scripts/issuer-chatbot/start.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHATBOT_DIR="$REPO_ROOT/issuer-chatbot"

# Defaults (can be overridden by env)
VS_AGENT_ADMIN_URL="${VS_AGENT_ADMIN_URL:-http://localhost:3000}"
CHATBOT_PORT="${CHATBOT_PORT:-4000}"

echo "============================================="
echo " Issuer Chatbot — Local Start"
echo "============================================="
echo "  VS-Agent URL : $VS_AGENT_ADMIN_URL"
echo "  Chatbot port : $CHATBOT_PORT"
echo "  Service name : ${SERVICE_NAME:-Example Verana Service}"
echo ""

# Install dependencies if needed
if [ ! -d "$CHATBOT_DIR/node_modules" ]; then
  echo "Installing dependencies..."
  (cd "$CHATBOT_DIR" && npm install)
fi

# Configure VS-Agent to forward events to the chatbot
echo "Configuring VS-Agent EVENTS_BASE_URL → http://localhost:$CHATBOT_PORT"
# Note: This requires the VS-Agent to support runtime webhook configuration.
# If not, set EVENTS_BASE_URL when starting the VS-Agent Docker container.

# Start the chatbot
echo "Starting Issuer Chatbot..."
cd "$CHATBOT_DIR"
exec npx tsx src/index.ts
