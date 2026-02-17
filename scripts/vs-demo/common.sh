#!/usr/bin/env bash
# =============================================================================
# common.sh — Shared helpers for VS Demo scripts
# =============================================================================
#
# Source this file from 01-deploy-vs.sh and 02-create-trust-registry.sh.
# It provides:
#   - Colored logging functions
#   - Transaction helpers (extract_tx_event, extract_tx_json)
#   - VS Agent API helpers (wait_for_agent, cleanup_self_generated)
#   - Network configuration (set_network_vars)
#   - Schema download helper
#
# =============================================================================

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log()  { echo -e "\n\033[1;34m▶ $1\033[0m" >&2; }
ok()   { echo -e "  \033[1;32m✔ $1\033[0m" >&2; }
err()  { echo -e "  \033[1;31m✘ $1\033[0m" >&2; }
warn() { echo -e "  \033[1;33m⚠ $1\033[0m" >&2; }

# ---------------------------------------------------------------------------
# Network configuration
# ---------------------------------------------------------------------------

set_network_vars() {
  local network="${1:-testnet}"

  case "$network" in
    devnet)
      CHAIN_ID="${CHAIN_ID:-vna-devnet-1}"
      NODE_RPC="${NODE_RPC:-https://rpc.devnet.verana.network}"
      FEES="${FEES:-600000uvna}"
      FAUCET_URL="https://faucet.devnet.verana.network"
      RESOLVER_URL="${RESOLVER_URL:-https://resolver.devnet.verana.network}"
      ECS_TR_ADMIN_API="${ECS_TR_ADMIN_API:-https://admin-ecs-trust-registry.devnet.verana.network}"
      ECS_TR_PUBLIC_URL="${ECS_TR_PUBLIC_URL:-https://ecs-trust-registry.devnet.verana.network}"
      INDEXER_URL="${INDEXER_URL:-https://idx.devnet.verana.network}"
      ;;
    testnet)
      CHAIN_ID="${CHAIN_ID:-vna-testnet-1}"
      NODE_RPC="${NODE_RPC:-https://rpc.testnet.verana.network}"
      FEES="${FEES:-600000uvna}"
      FAUCET_URL="https://faucet.testnet.verana.network"
      RESOLVER_URL="${RESOLVER_URL:-https://resolver.testnet.verana.network}"
      ECS_TR_ADMIN_API="${ECS_TR_ADMIN_API:-https://admin-ecs-trust-registry.testnet.verana.network}"
      ECS_TR_PUBLIC_URL="${ECS_TR_PUBLIC_URL:-https://ecs-trust-registry.testnet.verana.network}"
      INDEXER_URL="${INDEXER_URL:-https://idx.testnet.verana.network}"
      ;;
    *)
      err "Unknown network: $network. Use 'devnet' or 'testnet'."
      exit 1
      ;;
  esac

  export CHAIN_ID NODE_RPC FEES FAUCET_URL RESOLVER_URL ECS_TR_ADMIN_API ECS_TR_PUBLIC_URL INDEXER_URL
}

# ---------------------------------------------------------------------------
# Transaction helpers
# ---------------------------------------------------------------------------

# Extract a value from tx events JSON
extract_tx_event() {
  local tx_hash=$1
  local event_type=$2
  local attr_key=$3
  veranad q tx "$tx_hash" --node "$NODE_RPC" --output json 2>/dev/null \
    | jq -r ".events[] | select(.type == \"$event_type\") | .attributes[] | select(.key == \"$attr_key\") | .value" \
    | head -1
}

# Extract JSON from veranad tx output (strips "gas estimate:" prefix line)
extract_tx_json() {
  grep -E '^\{' | head -1
}

# Submit a veranad tx command, wait for confirmation, and extract an event value.
# Usage: submit_tx <event_type> <attr_key> <veranad tx ...args>
# Returns the extracted value on stdout; exits on failure.
submit_tx() {
  local event_type=$1; shift
  local attr_key=$1; shift

  local result
  result=$("$@" \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --node "$NODE_RPC" \
    --output json -y 2>&1 | extract_tx_json)

  local tx_hash
  tx_hash=$(echo "$result" | jq -r '.txhash // empty')
  if [ -z "$tx_hash" ]; then
    err "TX failed. Output: $result"
    return 1
  fi
  ok "TX submitted: $tx_hash"

  sleep 8

  local value
  value=$(extract_tx_event "$tx_hash" "$event_type" "$attr_key")
  if [ -z "$value" ]; then
    sleep 6
    value=$(extract_tx_event "$tx_hash" "$event_type" "$attr_key")
  fi
  if [ -z "$value" ]; then
    err "Could not extract '$attr_key' from event '$event_type' (tx: $tx_hash)"
    return 1
  fi

  echo "$value"
}

# ---------------------------------------------------------------------------
# VS Agent API helpers
# ---------------------------------------------------------------------------

# Wait for the VS Agent admin API to become ready
# Usage: wait_for_agent <admin_api_url> [max_retries]
wait_for_agent() {
  local admin_api=$1
  local max_retries=${2:-30}
  local i=0
  while [ $i -lt $max_retries ]; do
    if curl -sf "${admin_api}/v1/agent" > /dev/null 2>&1; then
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done
  return 1
}

# Remove self-generated (non-VPR) VTJSCs and their linked credentials
# Usage: cleanup_self_generated <admin_api_url>
cleanup_self_generated() {
  local admin_api=$1

  local self_jscs
  self_jscs=$(curl -sf "${admin_api}/v1/vt/json-schema-credentials" \
    | jq -r '.data[] | select(.schemaId | startswith("vpr:") | not) | .credential.id')

  for jsc_id in $self_jscs; do
    curl -sf -X DELETE "${admin_api}/v1/vt/linked-credentials" \
      -H 'Content-Type: application/json' \
      -d "{\"credentialSchemaId\": \"$jsc_id\"}" > /dev/null 2>&1 || true
    curl -sf -X DELETE "${admin_api}/v1/vt/json-schema-credentials" \
      -H 'Content-Type: application/json' \
      -d "{\"id\": \"$jsc_id\"}" > /dev/null 2>&1 || true
  done
}

# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------

# Download a JSON schema and return it as a compact string
download_schema() {
  curl -sf "$1" | jq -c '.'
}

# Compute SHA-384 SRI digest of a URL's content
# Usage: compute_sri_digest <url>
# Returns: sha384-<base64_hash>
compute_sri_digest() {
  local url=$1
  local hash
  hash=$(curl -sfL "$url" | openssl dgst -sha384 -binary | openssl base64 -A)
  if [ -z "$hash" ]; then
    err "Failed to compute SRI digest for $url"
    return 1
  fi
  echo "sha384-${hash}"
}

# ---------------------------------------------------------------------------
# ECS Trust Registry discovery helpers
# ---------------------------------------------------------------------------

# Discover a VTJSC from the ECS Trust Registry by resolving its DID document.
# Finds the LinkedVerifiablePresentation service entry matching "<schema_name>-jsc-vp",
# fetches the VP, and extracts the VTJSC credential URL and VPR schema ID.
#
# Usage: discover_ecs_vtjsc <ecs_public_url> <schema_name>
# Example: discover_ecs_vtjsc "$ECS_TR_PUBLIC_URL" "service"
# Outputs two lines to stdout:
#   line 1: VTJSC credential URL (jsonSchemaCredentialId for issue-credential)
#   line 2: numeric VPR schema ID
discover_ecs_vtjsc() {
  local ecs_public_url=$1
  local schema_name=$2

  log "Resolving ECS TR DID document for '$schema_name' VTJSC..."

  # Fetch the DID document from the ECS TR's public URL
  local did_doc
  did_doc=$(curl -sf "${ecs_public_url}/.well-known/did.json")
  if [ -z "$did_doc" ]; then
    err "Failed to fetch DID document from ${ecs_public_url}/.well-known/did.json"
    return 1
  fi

  # Find the JSC-VP LinkedVerifiablePresentation service entry
  local vp_url
  vp_url=$(echo "$did_doc" | jq -r --arg pat "${schema_name}-jsc-vp" '
    .service[] | select(.type == "LinkedVerifiablePresentation") |
    select(.id | test($pat)) | .serviceEndpoint' | head -1)

  if [ -z "$vp_url" ]; then
    err "No LinkedVerifiablePresentation matching '${schema_name}-jsc-vp' in DID document"
    return 1
  fi
  ok "VTJSC VP endpoint: $vp_url"

  # Fetch the VP and extract the VTJSC credential
  local vp
  vp=$(curl -sf "$vp_url")
  if [ -z "$vp" ]; then
    err "Failed to fetch VTJSC VP from $vp_url"
    return 1
  fi

  # Extract VTJSC credential URL (verifiableCredential[0].id)
  local vtjsc_url
  vtjsc_url=$(echo "$vp" | jq -r '.verifiableCredential[0].id // empty')
  if [ -z "$vtjsc_url" ]; then
    err "Could not extract VTJSC URL from VP"
    return 1
  fi

  # Extract VPR schema ref from credentialSubject.jsonSchema.$ref
  # e.g. "vpr:verana:vna-testnet-1/cs/v1/js/110"
  local schema_ref
  schema_ref=$(echo "$vp" | jq -r '.verifiableCredential[0].credentialSubject.jsonSchema."$ref" // empty')
  if [ -z "$schema_ref" ]; then
    err "Could not extract jsonSchema.\$ref from VTJSC"
    return 1
  fi

  # Extract numeric schema ID from the end of the VPR ref
  local schema_id
  schema_id=$(echo "$schema_ref" | grep -oE '[0-9]+$')
  if [ -z "$schema_id" ]; then
    err "Could not parse schema ID from ref: $schema_ref"
    return 1
  fi

  ok "VTJSC '$schema_name' → URL: $vtjsc_url, schema ID: $schema_id"
  echo "$vtjsc_url"
  echo "$schema_id"
}

# Discover the active root permission (ECOSYSTEM type) for a given schema
# using the Verana Indexer API.
# Usage: discover_active_root_perm <schema_id>
# Returns: the root permission ID on stdout
discover_active_root_perm() {
  local schema_id=$1

  log "Discovering active root permission for schema $schema_id via indexer..."

  local perms
  perms=$(curl -sf "${INDEXER_URL}/verana/perm/v1/list?schema_id=${schema_id}")

  if [ -z "$perms" ]; then
    err "Failed to query permissions from indexer for schema $schema_id"
    return 1
  fi

  # Find an active ECOSYSTEM (root) permission
  local root_perm_id
  root_perm_id=$(echo "$perms" | jq -r '
    .permissions[] |
    select(.type == "ECOSYSTEM" and .perm_state == "ACTIVE") |
    .id' | head -1)

  if [ -z "$root_perm_id" ]; then
    err "No active ECOSYSTEM permission found for schema $schema_id"
    return 1
  fi

  ok "Active root permission: $root_perm_id"
  echo "$root_perm_id"
}

# ---------------------------------------------------------------------------
# Credential helpers
# ---------------------------------------------------------------------------

# Issue a credential via the VS Agent admin API and link it as a VP
# Usage: issue_and_link <admin_api> <schema_base_id> <chain_id> <schema_id> <agent_did> <claims_json>
issue_and_link() {
  local admin_api=$1
  local schema_base_id=$2
  local chain_id=$3
  local schema_id=$4
  local agent_did=$5
  local claims_json=$6

  # Get the VTJSC URL for this schema
  local vpr_ref="vpr:verana:${chain_id}/cs/v1/js/${schema_id}"
  local jsc_url
  jsc_url=$(curl -sf "${admin_api}/v1/vt/json-schema-credentials" \
    | jq -r --arg sid "$vpr_ref" '.data[] | select(.schemaId == $sid) | .credential.id')
  if [ -z "$jsc_url" ]; then
    err "VTJSC not found for schema $schema_id (ref: $vpr_ref)"
    return 1
  fi
  ok "VTJSC URL: $jsc_url"

  # Issue the credential
  local credential
  credential=$(curl -sf -X POST "${admin_api}/v1/vt/issue-credential" \
    -H 'Content-Type: application/json' \
    -d "{
      \"format\": \"jsonld\",
      \"did\": \"${agent_did}\",
      \"jsonSchemaCredentialId\": \"${jsc_url}\",
      \"claims\": ${claims_json}
    }")

  if [ -z "$credential" ] || echo "$credential" | jq -e '.statusCode' > /dev/null 2>&1; then
    err "Failed to issue credential. Response: $credential"
    return 1
  fi
  ok "Credential issued"

  # Extract signed credential
  local signed_cred
  signed_cred=$(echo "$credential" | jq '.credential')
  if [ "$signed_cred" = "null" ] || [ -z "$signed_cred" ]; then
    signed_cred="$credential"
  fi

  # Link as VP
  local link_result
  link_result=$(curl -sf -X POST "${admin_api}/v1/vt/linked-credentials" \
    -H 'Content-Type: application/json' \
    -d "{
      \"schemaBaseId\": \"${schema_base_id}\",
      \"credential\": ${signed_cred}
    }")

  if echo "$link_result" | jq -e '.statusCode' > /dev/null 2>&1; then
    err "Failed to link credential. Response: $link_result"
    return 1
  fi
  ok "Credential linked as VP (schemaBaseId: $schema_base_id)"
}

# Issue a credential from a REMOTE admin API (e.g., ECS TR) and link it on the LOCAL agent
# Usage: issue_remote_and_link <remote_admin_api> <local_admin_api> <schema_base_id> <jsc_url> <target_did> <claims_json>
issue_remote_and_link() {
  local remote_api=$1
  local local_api=$2
  local schema_base_id=$3
  local jsc_url=$4
  local target_did=$5
  local claims_json=$6

  # Issue via remote API
  log "Requesting credential from remote API..."
  local credential
  credential=$(curl -sf -X POST "${remote_api}/v1/vt/issue-credential" \
    -H 'Content-Type: application/json' \
    -d "{
      \"format\": \"jsonld\",
      \"did\": \"${target_did}\",
      \"jsonSchemaCredentialId\": \"${jsc_url}\",
      \"claims\": ${claims_json}
    }")

  if [ -z "$credential" ] || echo "$credential" | jq -e '.statusCode' > /dev/null 2>&1; then
    err "Remote API failed to issue credential. Response: $credential"
    return 1
  fi
  ok "Credential received from remote API"

  # Extract signed credential
  local signed_cred
  signed_cred=$(echo "$credential" | jq '.credential')
  if [ "$signed_cred" = "null" ] || [ -z "$signed_cred" ]; then
    signed_cred="$credential"
  fi

  # Link on local agent
  local link_result
  link_result=$(curl -sf -X POST "${local_api}/v1/vt/linked-credentials" \
    -H 'Content-Type: application/json' \
    -d "{
      \"schemaBaseId\": \"${schema_base_id}\",
      \"credential\": ${signed_cred}
    }")

  if echo "$link_result" | jq -e '.statusCode' > /dev/null 2>&1; then
    err "Failed to link credential on local agent. Response: $link_result"
    return 1
  fi
  ok "Credential linked as VP on local agent (schemaBaseId: $schema_base_id)"
}

# ---------------------------------------------------------------------------
# CLI setup helpers
# ---------------------------------------------------------------------------

# Ensure veranad account exists and is funded
# Usage: setup_veranad_account <user_acc> <faucet_url>
setup_veranad_account() {
  local user_acc=$1
  local faucet_url=$2

  if ! veranad keys show "$user_acc" --keyring-backend test > /dev/null 2>&1; then
    log "Creating new account '$user_acc'..."
    veranad keys add "$user_acc" --keyring-backend test 2>&1
    ok "Account created"
  else
    ok "Account '$user_acc' already exists"
  fi

  USER_ACC_ADDR=$(veranad keys show "$user_acc" -a --keyring-backend test)
  ok "Account address: $USER_ACC_ADDR"

  local balance
  balance=$(veranad q bank balances "$USER_ACC_ADDR" --node "$NODE_RPC" --output json 2>/dev/null \
    | jq -r '.balances[] | select(.denom == "uvna") | .amount // "0"' 2>/dev/null || echo "0")

  if [ "$balance" = "0" ] || [ -z "$balance" ]; then
    echo ""
    echo "  ┌─────────────────────────────────────────────────────────────┐"
    echo "  │  Fund this account via the faucet:                          │"
    echo "  │                                                             │"
    echo "  │  Address: $USER_ACC_ADDR"
    echo "  │                                                             │"
    echo "  │  Faucet:  $faucet_url"
    echo "  └─────────────────────────────────────────────────────────────┘"
    echo ""
    read -p "  Press Enter once the account is funded (or Ctrl+C to abort)... "

    balance=$(veranad q bank balances "$USER_ACC_ADDR" --node "$NODE_RPC" --output json 2>/dev/null \
      | jq -r '.balances[] | select(.denom == "uvna") | .amount // "0"' 2>/dev/null || echo "0")
    if [ "$balance" = "0" ] || [ -z "$balance" ]; then
      err "Account still has no uvna balance. Please fund it before continuing."
      exit 1
    fi
  fi

  ok "Account balance: ${balance} uvna"
  export USER_ACC_ADDR
}

# ---------------------------------------------------------------------------
# Date helper (macOS + Linux compatible)
# ---------------------------------------------------------------------------

# Return a UTC timestamp N seconds in the future
# Usage: future_timestamp [seconds]
future_timestamp() {
  local seconds=${1:-15}
  date -u -v+${seconds}S +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
    || date -u -d "+${seconds} seconds" +"%Y-%m-%dT%H:%M:%SZ"
}
