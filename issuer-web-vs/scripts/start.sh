#!/usr/bin/env bash
# =============================================================================
# Issuer Web VS — Start App
# =============================================================================
#
# Starts the Issuer Web application locally (outside Docker).
# The VS Agent must already be running (via setup.sh or docker-compose).
#
# Usage:
#   source issuer-web-vs/config.env
#   ./issuer-web-vs/scripts/start.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="${SERVICE_DIR}/issuer-web"

# Load config defaults
VS_AGENT_ADMIN_PORT="${VS_AGENT_ADMIN_PORT:-3004}"
ISSUER_WEB_PORT="${ISSUER_WEB_PORT:-4001}"
SERVICE_NAME="${SERVICE_NAME:-Example Issuer Web App}"
CUSTOM_SCHEMA_BASE_ID="${CUSTOM_SCHEMA_BASE_ID:-example}"
ENABLE_ANONCREDS="${ENABLE_ANONCREDS:-true}"
LOG_LEVEL="${LOG_LEVEL:-info}"

cd "$APP_DIR"

echo "Installing dependencies..."
npm install

echo "Starting Issuer Web on port ${ISSUER_WEB_PORT}..."
VS_AGENT_ADMIN_URL="http://localhost:${VS_AGENT_ADMIN_PORT}" \
  ORG_VS_PUBLIC_URL="${ORG_VS_PUBLIC_URL:-}" \
  PORT="${ISSUER_WEB_PORT}" \
  ISSUER_WEB_PORT="${ISSUER_WEB_PORT}" \
  SERVICE_NAME="${SERVICE_NAME}" \
  CUSTOM_SCHEMA_BASE_ID="${CUSTOM_SCHEMA_BASE_ID}" \
  ENABLE_ANONCREDS="${ENABLE_ANONCREDS}" \
  LOG_LEVEL="${LOG_LEVEL}" \
  npx tsx src/index.ts
