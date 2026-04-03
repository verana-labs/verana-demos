#!/usr/bin/env bash
# =============================================================================
# Start the Verifier Chatbot locally
# =============================================================================
#
# Prerequisites:
#   - Verifier Chatbot VS Agent running (setup.sh completed)
#   - config.env sourced
#
# Usage:
#   source verifier-chatbot-vs/config.env
#   ./verifier-chatbot-vs/scripts/start.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CHATBOT_DIR="$SERVICE_DIR/verifier-chatbot"

# Defaults (can be overridden by env)
VS_AGENT_ADMIN_URL="${VS_AGENT_ADMIN_URL:-http://localhost:${VS_AGENT_ADMIN_PORT:-3006}}"
CHATBOT_PORT="${CHATBOT_PORT:-4002}"

echo "============================================="
echo " Verifier Chatbot — Local Start"
echo "============================================="
echo "  VS-Agent URL : $VS_AGENT_ADMIN_URL"
echo "  Chatbot port : $CHATBOT_PORT"
echo "  Service name : ${SERVICE_NAME:-Example Verifier Chatbot}"
echo ""

# Install dependencies if needed
if [ ! -d "$CHATBOT_DIR/node_modules" ]; then
  echo "Installing dependencies..."
  (cd "$CHATBOT_DIR" && npm install)
fi

# Start the chatbot
echo "Starting Verifier Chatbot..."
cd "$CHATBOT_DIR"
export VS_AGENT_ADMIN_URL CHATBOT_PORT ISSUER_VS_PUBLIC_URL
exec npx tsx src/index.ts
