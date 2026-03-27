#!/usr/bin/env bash
# =============================================================================
# Start the Issuer Chatbot locally
# =============================================================================
#
# Prerequisites:
#   - Issuer Chatbot VS Agent running (setup.sh completed)
#   - config.env sourced
#
# Usage:
#   source issuer-chatbot-vs/config.env
#   ./issuer-chatbot-vs/scripts/start.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CHATBOT_DIR="$SERVICE_DIR/issuer-chatbot"

# Defaults (can be overridden by env)
VS_AGENT_ADMIN_URL="${VS_AGENT_ADMIN_URL:-http://localhost:${VS_AGENT_ADMIN_PORT:-3002}}"
CHATBOT_PORT="${CHATBOT_PORT:-4000}"

echo "============================================="
echo " Issuer Chatbot — Local Start"
echo "============================================="
echo "  VS-Agent URL : $VS_AGENT_ADMIN_URL"
echo "  Chatbot port : $CHATBOT_PORT"
echo "  Service name : ${SERVICE_NAME:-Example Issuer Chatbot}"
echo ""

# Install dependencies if needed
if [ ! -d "$CHATBOT_DIR/node_modules" ]; then
  echo "Installing dependencies..."
  (cd "$CHATBOT_DIR" && npm install)
fi

# Start the chatbot
echo "Starting Issuer Chatbot..."
cd "$CHATBOT_DIR"
export VS_AGENT_ADMIN_URL CHATBOT_PORT ORG_VS_PUBLIC_URL
exec npx tsx src/index.ts
