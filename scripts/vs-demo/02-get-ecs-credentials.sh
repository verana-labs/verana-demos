#!/usr/bin/env bash
# =============================================================================
# 02-get-ecs-credentials.sh — Obtain ECS credentials (Organization + Service)
# =============================================================================
#
# This script:
#   1. Discovers ECS schema IDs from the ECS Trust Registry DID document
#   2. Cleans up any previous ECS credentials (linked VPs + VTJSCs)
#   3. Obtains an Organization credential from the ECS Trust Registry
#   4. Checks for an existing ISSUER permission; creates one if missing
#   5. Self-issues a Service credential (using the ECS TR's VTJSC)
#   6. Verifies the setup
#
# Idempotent: safe to re-run. Previous credentials are replaced, and
# existing ISSUER permissions are reused.
#
# Prerequisites:
#   - VS Agent running (01-deploy-vs.sh completed, or Helm-deployed)
#   - veranad CLI with funded account
#   - curl, jq
#
# Usage:
#   source vs-demo-ids.env   # load AGENT_DID, USER_ACC, etc.
#   ./02-get-ecs-credentials.sh
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

# VS Demo IDs from Part 1
VS_IDS_FILE="${VS_IDS_FILE:-vs-demo-ids.env}"

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

# Output file (append to Part 1 output)
OUTPUT_FILE="${OUTPUT_FILE:-vs-demo-ids.env}"

# ---------------------------------------------------------------------------
# Set network-specific variables
# ---------------------------------------------------------------------------

set_network_vars "$NETWORK"
log "Network: $NETWORK (chain: $CHAIN_ID)"

# ---------------------------------------------------------------------------
# Load Part 1 IDs (if available)
# ---------------------------------------------------------------------------

if [ -f "$VS_IDS_FILE" ]; then
  log "Loading VS Demo IDs from $VS_IDS_FILE"
  # shellcheck disable=SC1090
  source "$VS_IDS_FILE"
  ok "IDs loaded"
fi

# Validate required variables
VS_AGENT_ADMIN_PORT="${VS_AGENT_ADMIN_PORT:-3000}"
VS_AGENT_PUBLIC_PORT="${VS_AGENT_PUBLIC_PORT:-3001}"
ADMIN_API="http://localhost:${VS_AGENT_ADMIN_PORT}"

# Get agent DID
if [ -z "${AGENT_DID:-}" ]; then
  AGENT_DID=$(curl -sf "${ADMIN_API}/v1/agent" | jq -r '.publicDid')
fi
if [ -z "$AGENT_DID" ] || [ "$AGENT_DID" = "null" ]; then
  err "Could not retrieve agent DID. Is the VS Agent running?"
  exit 1
fi
ok "Agent DID: $AGENT_DID"

# ---------------------------------------------------------------------------
# Discover ECS schema IDs from the ECS Trust Registry DID document
# ---------------------------------------------------------------------------

# Discover Organization VTJSC
ORG_VTJSC_OUTPUT=$(discover_ecs_vtjsc "$ECS_TR_PUBLIC_URL" "organization")
ORG_JSC_URL=$(echo "$ORG_VTJSC_OUTPUT" | sed -n '1p')
CS_ORG_ID=$(echo "$ORG_VTJSC_OUTPUT" | sed -n '2p')
if [ -z "$ORG_JSC_URL" ] || [ -z "$CS_ORG_ID" ]; then
  err "Could not discover Organization VTJSC from ECS TR DID document"
  exit 1
fi

# Discover Service VTJSC
SERVICE_VTJSC_OUTPUT=$(discover_ecs_vtjsc "$ECS_TR_PUBLIC_URL" "service")
SERVICE_JSC_URL=$(echo "$SERVICE_VTJSC_OUTPUT" | sed -n '1p')
CS_SERVICE_ID=$(echo "$SERVICE_VTJSC_OUTPUT" | sed -n '2p')
if [ -z "$SERVICE_JSC_URL" ] || [ -z "$CS_SERVICE_ID" ]; then
  err "Could not discover Service VTJSC from ECS TR DID document"
  exit 1
fi

# =============================================================================
# STEP 1: Clean up previous ECS credentials
# =============================================================================

log "Step 1: Clean up previous ECS credentials"
cleanup_ecs_credentials "$ADMIN_API" "$ORG_JSC_URL" "$SERVICE_JSC_URL"

# =============================================================================
# STEP 2: Obtain Organization credential from ECS Trust Registry
# =============================================================================

log "Step 2: Obtain Organization credential from ECS Trust Registry"

# Download logos and convert to data URIs
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
# STEP 3: Ensure ISSUER permission for Service schema
# =============================================================================

log "Step 3: Ensure ISSUER permission for Service schema"

ISSUER_PERM_SERVICE=""
if ISSUER_PERM_SERVICE=$(find_active_issuer_perm "$CS_SERVICE_ID" "$AGENT_DID"); then
  ok "Active ISSUER permission already exists: $ISSUER_PERM_SERVICE — skipping creation"
else
  log "No active ISSUER permission found — creating one"

  # Verify account has funds before on-chain transaction
  check_balance "$USER_ACC"

  EFFECTIVE_FROM=$(future_timestamp 15)
  log "Creating ISSUER permission (effective from: $EFFECTIVE_FROM)..."

  ISSUER_PERM_SERVICE=$(submit_tx "create_permission" "permission_id" \
    veranad tx perm create-perm "$CS_SERVICE_ID" issuer "$AGENT_DID" \
    --effective-from "$EFFECTIVE_FROM")

  ok "ISSUER permission created: perm_id=$ISSUER_PERM_SERVICE"

  # Wait for permission to become effective
  log "Waiting for ISSUER permission to become effective..."
  sleep 21
  ok "ISSUER permission should now be active"
fi

# =============================================================================
# STEP 4: Self-issue Service credential and link as VP
# =============================================================================
# The Service credential references the ECS Trust Registry's VTJSC (not a local
# one). VTJSCs must only be created by the trust registry that owns the schema.
# =============================================================================

log "Step 4: Self-issue Service credential"

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

issue_remote_and_link "$ADMIN_API" "$ADMIN_API" "service" "$SERVICE_JSC_URL" "$AGENT_DID" "$SERVICE_CLAIMS"

# =============================================================================
# STEP 5: Verify
# =============================================================================

log "Step 5: Verify"

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
fi

# =============================================================================
# Save IDs (append to output file)
# =============================================================================

log "Saving ECS credential IDs to ${OUTPUT_FILE}"

# Remove previous ECS section if re-running
sed -i.bak '/^# ECS Credentials/,/^$/d' "$OUTPUT_FILE" 2>/dev/null || true
rm -f "${OUTPUT_FILE}.bak"

cat >> "$OUTPUT_FILE" <<EOF

# ECS Credentials (Part 2)
CS_ORG_ID=${CS_ORG_ID}
CS_SERVICE_ID=${CS_SERVICE_ID}
ISSUER_PERM_SERVICE=${ISSUER_PERM_SERVICE}
EOF

ok "IDs saved to ${OUTPUT_FILE}"

# =============================================================================
# Summary
# =============================================================================

log "ECS credentials obtained!"
echo ""
echo "  Organization credential : linked as VP"
echo "  Service credential      : linked as VP"
echo "  ISSUER permission       : $ISSUER_PERM_SERVICE"
echo "  Linked VPs              : $VP_COUNT"
echo ""
echo "  Next step: ./03-create-trust-registry.sh (optional)"
echo ""
