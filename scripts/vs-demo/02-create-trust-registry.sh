#!/usr/bin/env bash
# =============================================================================
# 02-create-trust-registry.sh — Create a Trust Registry for a custom schema
# =============================================================================
#
# This script creates a Trust Registry on-chain for a VS Agent that was
# previously set up by 01-deploy-vs.sh. It registers a custom credential
# schema (e.g., example.json), creates root and issuer permissions, creates
# a VTJSC, and optionally configures an AnonCreds credential definition.
#
# Supports both devnet and testnet.
#
# Prerequisites:
#   - 01-deploy-vs.sh completed successfully (VS Agent running, vs-demo-ids.env exists)
#   - veranad binary
#   - curl, jq
#
# Usage:
#   source my-vs.env
#   ./scripts/vs-demo/02-create-trust-registry.sh
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

# Custom schema configuration
CUSTOM_SCHEMA_URL="${CUSTOM_SCHEMA_URL:-https://verana-labs.github.io/verifiable-trust-spec/schemas/v4/example.json}"
CUSTOM_SCHEMA_BASE_ID="${CUSTOM_SCHEMA_BASE_ID:-example}"

# Trust Registry configuration
TR_REGISTRY_URL="${TR_REGISTRY_URL:-}"
EGF_LANGUAGE="${EGF_LANGUAGE:-en}"
EGF_DOC_URL="${EGF_DOC_URL:?EGF_DOC_URL is required}"
EGF_DOC_DIGEST="${EGF_DOC_DIGEST:?EGF_DOC_DIGEST is required}"

# Trust fees (0 for devnet/testnet)
VALIDATION_FEES="${VALIDATION_FEES:-0}"
ISSUANCE_FEES="${ISSUANCE_FEES:-0}"
VERIFICATION_FEES="${VERIFICATION_FEES:-0}"

# AnonCreds configuration (optional)
ENABLE_ANONCREDS="${ENABLE_ANONCREDS:-false}"
ANONCREDS_NAME="${ANONCREDS_NAME:-${CUSTOM_SCHEMA_BASE_ID}}"
ANONCREDS_VERSION="${ANONCREDS_VERSION:-1.0}"
ANONCREDS_SUPPORT_REVOCATION="${ANONCREDS_SUPPORT_REVOCATION:-false}"

# Output file (append to Part 1 output)
OUTPUT_FILE="${OUTPUT_FILE:-vs-demo-ids.env}"

# ---------------------------------------------------------------------------
# Set network-specific variables
# ---------------------------------------------------------------------------

set_network_vars "$NETWORK"
log "Network: $NETWORK (chain: $CHAIN_ID)"

# ---------------------------------------------------------------------------
# Load Part 1 IDs
# ---------------------------------------------------------------------------

if [ -f "$VS_IDS_FILE" ]; then
  log "Loading VS Demo IDs from $VS_IDS_FILE"
  # shellcheck disable=SC1090
  source "$VS_IDS_FILE"
  ok "IDs loaded"
else
  err "VS IDs file not found: $VS_IDS_FILE"
  err "Run 01-deploy-vs.sh first."
  exit 1
fi

# Validate required variables from Part 1
AGENT_DID="${AGENT_DID:?AGENT_DID is required (check $VS_IDS_FILE)}"
USER_ACC="${USER_ACC:?USER_ACC is required (check $VS_IDS_FILE)}"
VS_AGENT_ADMIN_PORT="${VS_AGENT_ADMIN_PORT:-3000}"
VS_AGENT_PUBLIC_PORT="${VS_AGENT_PUBLIC_PORT:-3001}"
ADMIN_API="http://localhost:${VS_AGENT_ADMIN_PORT}"

# Default registry URL to the ngrok URL if not set
TR_REGISTRY_URL="${TR_REGISTRY_URL:-${NGROK_URL:-}}"

# =============================================================================
# STEP 1: Create Trust Registry on-chain
# =============================================================================

log "Step 1: Create Trust Registry on-chain"

TRUST_REG_ID=$(submit_tx "create_trust_registry" "trust_registry_id" \
  veranad tx tr create-trust-registry \
  "$AGENT_DID" "$EGF_LANGUAGE" "$EGF_DOC_URL" "$EGF_DOC_DIGEST" \
  --aka "$TR_REGISTRY_URL")

ok "Trust Registry created with ID: $TRUST_REG_ID"

# =============================================================================
# STEP 2: Create custom credential schema
# =============================================================================

log "Step 2: Create credential schema"

log "Downloading schema from $CUSTOM_SCHEMA_URL..."
SCHEMA_JSON=$(download_schema "$CUSTOM_SCHEMA_URL")
if [ -z "$SCHEMA_JSON" ]; then
  err "Failed to download schema from $CUSTOM_SCHEMA_URL"
  exit 1
fi
ok "Schema downloaded"

# issuer_mode=ECOSYSTEM (3), verifier_mode=OPEN (1)
log "Creating schema (issuer_mode=ECOSYSTEM, verifier_mode=OPEN)..."

CUSTOM_SCHEMA_ID=$(submit_tx "create_credential_schema" "credential_schema_id" \
  veranad tx cs create-credential-schema "$TRUST_REG_ID" "$SCHEMA_JSON" \
  --issuer-grantor-validation-validity-period '{"value":0}' \
  --verifier-grantor-validation-validity-period '{"value":0}' \
  --issuer-validation-validity-period '{"value":0}' \
  --verifier-validation-validity-period '{"value":0}' \
  --holder-validation-validity-period '{"value":0}' \
  3 1)

ok "Schema created with ID: $CUSTOM_SCHEMA_ID"

# =============================================================================
# STEP 3: Create root permission
# =============================================================================

log "Step 3: Create root permission"

EFFECTIVE_FROM=$(future_timestamp 15)
log "Creating root permission (effective from: $EFFECTIVE_FROM)..."

ROOT_PERM_ID=$(submit_tx "create_root_permission" "root_permission_id" \
  veranad tx perm create-root-perm \
  "$CUSTOM_SCHEMA_ID" "$AGENT_DID" \
  "$VALIDATION_FEES" "$ISSUANCE_FEES" "$VERIFICATION_FEES" \
  --effective-from "$EFFECTIVE_FROM")

ok "Root permission created: $ROOT_PERM_ID"

# Wait for root permission to become effective
log "Waiting for root permission to become effective..."
sleep 21
ok "Root permission should now be active"

# =============================================================================
# STEP 4: Obtain ISSUER permission via VP flow (ECOSYSTEM mode)
# =============================================================================

log "Step 4: Obtain ISSUER permission (ECOSYSTEM VP flow)"

# 4a. Start the validation process
log "Starting ISSUER validation process..."
START_RESULT=$(veranad tx perm start-perm-vp \
  issuer "$ROOT_PERM_ID" \
  --did "$AGENT_DID" \
  --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
  --fees "$FEES" --gas auto --node "$NODE_RPC" \
  --output json -y 2>&1 | extract_tx_json)

START_TX_HASH=$(echo "$START_RESULT" | jq -r '.txhash // empty')
if [ -z "$START_TX_HASH" ]; then
  err "Failed to start ISSUER VP. Output: $START_RESULT"
  exit 1
fi
ok "VP start TX submitted: $START_TX_HASH"

sleep 8

ISSUER_PERM_ID=$(extract_tx_event "$START_TX_HASH" "start_permission_vp" "permission_id")
if [ -z "$ISSUER_PERM_ID" ]; then
  sleep 6
  ISSUER_PERM_ID=$(extract_tx_event "$START_TX_HASH" "start_permission_vp" "permission_id")
fi
if [ -z "$ISSUER_PERM_ID" ]; then
  err "Could not extract permission ID from start-perm-vp"
  exit 1
fi
ok "Validation process started: perm_id=$ISSUER_PERM_ID"

# 4b. Validate (ecosystem authority approves — in this demo, same account)
log "Validating ISSUER permission..."
VALIDATE_RESULT=$(veranad tx perm set-perm-vp-validated \
  "$ISSUER_PERM_ID" \
  --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
  --fees "$FEES" --gas auto --node "$NODE_RPC" \
  --output json -y 2>&1 | extract_tx_json)

VALIDATE_TX_HASH=$(echo "$VALIDATE_RESULT" | jq -r '.txhash // empty')
if [ -z "$VALIDATE_TX_HASH" ]; then
  err "Failed to validate ISSUER perm. Output: $VALIDATE_RESULT"
  exit 1
fi

sleep 6
ok "ISSUER permission validated: perm_id=$ISSUER_PERM_ID"

# =============================================================================
# STEP 5: Create VTJSC for custom schema
# =============================================================================

log "Step 5: Create VTJSC for custom schema"

VTJSC_RESULT=$(curl -sf -X POST "${ADMIN_API}/v1/vt/json-schema-credentials" \
  -H 'Content-Type: application/json' \
  -d "{\"schemaBaseId\": \"${CUSTOM_SCHEMA_BASE_ID}\", \"jsonSchemaRef\": \"vpr:verana:${CHAIN_ID}/cs/v1/js/${CUSTOM_SCHEMA_ID}\"}")

if [ -z "$VTJSC_RESULT" ] || echo "$VTJSC_RESULT" | jq -e '.statusCode' > /dev/null 2>&1; then
  err "Failed to create VTJSC. Response: $VTJSC_RESULT"
  exit 1
fi
ok "VTJSC created for '${CUSTOM_SCHEMA_BASE_ID}'"

# =============================================================================
# STEP 6: (Optional) Configure AnonCreds credential definition
# =============================================================================

ANONCREDS_CRED_DEF_ID=""
if [ "$ENABLE_ANONCREDS" = "true" ]; then
  log "Step 6: Configure AnonCreds credential definition"

  # Get the VTJSC credential ID
  VTJSC_VPR_REF="vpr:verana:${CHAIN_ID}/cs/v1/js/${CUSTOM_SCHEMA_ID}"
  VTJSC_CRED_ID=$(curl -sf "${ADMIN_API}/v1/vt/json-schema-credentials" \
    | jq -r --arg sid "$VTJSC_VPR_REF" '.data[] | select(.schemaId == $sid) | .credential.id')
  if [ -z "$VTJSC_CRED_ID" ]; then
    err "Could not find VTJSC for schema $CUSTOM_SCHEMA_ID"
    exit 1
  fi
  ok "VTJSC credential ID: $VTJSC_CRED_ID"

  # Create AnonCreds credential definition linked to the VTJSC
  log "Creating AnonCreds credential definition..."
  ANONCREDS_RESULT=$(curl -sf -X POST "${ADMIN_API}/v1/credential-types" \
    -H 'Content-Type: application/json' \
    -d "{
      \"name\": \"${ANONCREDS_NAME}\",
      \"version\": \"${ANONCREDS_VERSION}\",
      \"relatedJsonSchemaCredentialId\": \"${VTJSC_CRED_ID}\",
      \"supportRevocation\": ${ANONCREDS_SUPPORT_REVOCATION}
    }")

  if [ -z "$ANONCREDS_RESULT" ] || echo "$ANONCREDS_RESULT" | jq -e '.statusCode' > /dev/null 2>&1; then
    err "Failed to create AnonCreds credential definition. Response: $ANONCREDS_RESULT"
    exit 1
  fi

  ANONCREDS_CRED_DEF_ID=$(echo "$ANONCREDS_RESULT" | jq -r '.id // empty')
  ok "AnonCreds credential definition created: $ANONCREDS_CRED_DEF_ID"
  ok "VS Agent can now issue credentials in both W3C JSON-LD and AnonCreds formats"
else
  log "Step 6: AnonCreds — skipped (ENABLE_ANONCREDS=false)"
fi

# =============================================================================
# STEP 7: Verify
# =============================================================================

log "Step 7: Verify"

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
# Save IDs (append to Part 1 output)
# =============================================================================

log "Appending Trust Registry IDs to ${OUTPUT_FILE}"

cat >> "$OUTPUT_FILE" <<EOF

# Trust Registry (Part 2)
TRUST_REG_ID=${TRUST_REG_ID}
CUSTOM_SCHEMA_URL=${CUSTOM_SCHEMA_URL}
CUSTOM_SCHEMA_ID=${CUSTOM_SCHEMA_ID}
ROOT_PERM_ID=${ROOT_PERM_ID}
ISSUER_PERM_ID=${ISSUER_PERM_ID}
ANONCREDS_CRED_DEF_ID=${ANONCREDS_CRED_DEF_ID}
EOF

ok "IDs saved to ${OUTPUT_FILE}"

# =============================================================================
# Summary
# =============================================================================

log "Part 2 complete!"
echo ""
echo "  Trust Registry ID  : $TRUST_REG_ID"
echo "  Schema ID          : $CUSTOM_SCHEMA_ID"
echo "  Root Permission    : $ROOT_PERM_ID"
echo "  Issuer Permission  : $ISSUER_PERM_ID"
if [ -n "$ANONCREDS_CRED_DEF_ID" ]; then
echo "  AnonCreds Cred Def : $ANONCREDS_CRED_DEF_ID"
fi
echo "  Linked VPs         : $VP_COUNT"
echo ""
echo "  Your Trust Registry is live. You can now issue credentials for"
echo "  the '${CUSTOM_SCHEMA_BASE_ID}' schema to other Verifiable Services."
echo ""
