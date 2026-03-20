#!/usr/bin/env bash
# =============================================================================
# Start the Web Verifier locally
# =============================================================================
#
# Prerequisites:
#   - Verifier VS-Agent running (Pattern 2 child service)
#   - vs/config.env and vs/web-verifier.env sourced
#
# Usage:
#   source vs/config.env
#   source vs/web-verifier.env
#   ./scripts/web-verifier/start.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERIFIER_DIR="$REPO_ROOT/web-verifier"

# Defaults (can be overridden by env)
VS_AGENT_ADMIN_URL="${VS_AGENT_ADMIN_URL:-http://localhost:3000}"
VERIFIER_PORT="${VERIFIER_PORT:-4001}"

echo "============================================="
echo " Web Verifier — Local Start"
echo "============================================="
echo "  VS-Agent URL  : $VS_AGENT_ADMIN_URL"
echo "  Verifier port : $VERIFIER_PORT"
echo "  Service name  : ${SERVICE_NAME:-Example Verana Service}"
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
exec npx tsx src/index.ts
