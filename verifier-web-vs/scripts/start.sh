#!/usr/bin/env bash
# =============================================================================
# Start the Web Verifier locally
# =============================================================================
#
# Prerequisites:
#   - Verifier Web VS Agent running (setup.sh completed)
#   - config.env sourced
#
# Usage:
#   source verifier-web-vs/config.env
#   ./verifier-web-vs/scripts/start.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFIER_DIR="$SERVICE_DIR/verifier-web"

# Defaults (can be overridden by env)
VS_AGENT_ADMIN_URL="${VS_AGENT_ADMIN_URL:-http://localhost:${VS_AGENT_ADMIN_PORT:-3008}}"
VERIFIER_PORT="${VERIFIER_PORT:-4003}"

echo "============================================="
echo " Web Verifier — Local Start"
echo "============================================="
echo "  VS-Agent URL  : $VS_AGENT_ADMIN_URL"
echo "  Verifier port : $VERIFIER_PORT"
echo "  Service name  : ${SERVICE_NAME:-Example Web Verifier}"
echo ""

# Install dependencies if needed
if [ ! -d "$VERIFIER_DIR/node_modules" ]; then
  echo "Installing dependencies..."
  (cd "$VERIFIER_DIR" && npm install)
fi

# Start the web verifier
echo "Starting Web Verifier..."
echo "  Open http://localhost:$VERIFIER_PORT in your browser"
echo ""
cd "$VERIFIER_DIR"
export VS_AGENT_ADMIN_URL VERIFIER_PORT ISSUER_VS_PUBLIC_URL
exec npx tsx src/index.ts
