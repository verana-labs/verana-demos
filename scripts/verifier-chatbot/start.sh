#!/usr/bin/env bash
# =============================================================================
# Start the Verifier Chatbot locally
# =============================================================================
#
# Prerequisites:
#   - Verifier VS-Agent running (Pattern 2 child service)
#   - vs/config.env and vs/verifier-chatbot.env sourced
#
# Usage:
#   source vs/config.env
#   source vs/verifier-chatbot.env
#   ./scripts/verifier-chatbot/start.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHATBOT_DIR="$REPO_ROOT/verifier-chatbot"

# Defaults (can be overridden by env)
VS_AGENT_ADMIN_URL="${VS_AGENT_ADMIN_URL:-http://localhost:3000}"
CHATBOT_PORT="${CHATBOT_PORT:-4002}"

echo "============================================="
echo " Verifier Chatbot — Local Start"
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

# Start the chatbot
echo "Starting Verifier Chatbot..."
cd "$CHATBOT_DIR"
exec npx tsx src/index.ts
