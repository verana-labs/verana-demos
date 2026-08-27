#!/usr/bin/env bash
# =============================================================================
# common.sh — Shared helpers for VS Demo scripts (Verana v0.10.1+)
# =============================================================================
#
# Source this file from the VS Demo scripts. It provides:
#   - Colored logging functions
#   - Transaction helpers (extract_tx_event, extract_tx_json, submit_tx)
#   - VS Agent API helpers (wait_for_agent)
#   - Network configuration (set_network_vars)
#   - Corporation / Ecosystem / Participant helpers (co/ec/cs/pp modules)
#   - vt-flow validator helper (validate_pending_flow)
#   - Schema download / logo helpers
#   - AnonCreds VTJSC discovery
#
# CLI syntax verified directly against a live veranad v0.10.2 binary and
# the v0.10.1 verana-node source — see verana-deploy/scripts/ecs-ecosystem/common.sh
# and docs/14-ecs-ecosystem.md for how each one was confirmed.
#
# =============================================================================

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log()  { echo -e "\n\033[1;34m▶ $1\033[0m" >&2; }
ok()   { echo -e "  \033[1;32m✔ $1\033[0m" >&2; }
err()  {
  echo -e "  \033[1;31m✘ $1\033[0m" >&2
  # `set -e` aborts the step right after most err calls, and the last stderr
  # lines can lose the race with the runner log. An annotation always survives.
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::$1" || true
}
warn() { echo -e "  \033[1;33m⚠ $1\033[0m" >&2; }

# ---------------------------------------------------------------------------
# Network configuration
# ---------------------------------------------------------------------------

set_network_vars() {
  local network="${1:-devnet}"

  case "$network" in
    devnet)
      CHAIN_ID="${CHAIN_ID:-vna-devnet-1}"
      NODE_RPC="${NODE_RPC:-https://rpc.devnet.verana.network}"
      FEES="${FEES:-600000uvna}"
      FAUCET_URL="https://faucet-vs.devnet.verana.network/invitation"
      INDEXER_URL="${INDEXER_URL:-https://idx.devnet.verana.network}"
      # The shared ECS Ecosystem VS Agent (verana-deploy/scripts/ecs-ecosystem).
      # It defines the ECS schemas. It does NOT issue the Organization
      # credentials — see ECS_ORG_ISSUER_* below.
      ECS_ECOSYSTEM_DID="${ECS_ECOSYSTEM_DID:-did:webvh:QmbZCrGJxpy2KC5bt5d7bkFJJfyEcSUzKAqCgzvKSYsgws:ecs-ecosystem.devnet.verana.network}"
      # Port-forward before use: kubectl port-forward -n vna-devnet-1 svc/ecs-ecosystem 3100:3000
      ECS_ECOSYSTEM_ADMIN_API="${ECS_ECOSYSTEM_ADMIN_API:-http://localhost:3100}"
      # The Verifiable Service the ECS Ecosystem corporation assigned the
      # ISSUER Participant entry on the Organization schema. Every ECS
      # Organization credential comes from here, over the onboarding process.
      # Port-forward before use: kubectl port-forward -n vna-devnet-1 svc/ecs-org-issuer 3101:3000
      ECS_ORG_ISSUER_PUBLIC_URL="${ECS_ORG_ISSUER_PUBLIC_URL:-https://ecs-org-issuer.devnet.verana.network}"
      ECS_ORG_ISSUER_ADMIN_API="${ECS_ORG_ISSUER_ADMIN_API:-http://localhost:3101}"
      ;;
    testnet)
      err "testnet is not wired up on this branch (v4/devnet only). Use NETWORK=devnet."
      exit 1
      ;;
    *)
      err "Unknown network: $network. Use 'devnet'."
      exit 1
      ;;
  esac

  export CHAIN_ID NODE_RPC FEES FAUCET_URL INDEXER_URL ECS_ECOSYSTEM_DID ECS_ECOSYSTEM_ADMIN_API
  export ECS_ORG_ISSUER_PUBLIC_URL ECS_ORG_ISSUER_ADMIN_API
}

# ---------------------------------------------------------------------------
# VSOperatorAuthorization message types, per participant role
# ---------------------------------------------------------------------------
# A VS Agent uses exactly ONE Verana account, and that account is the
# vs_operator of the participants this script assigns to it. The chain accepts
# only these msg types per role, and rejects any other value at creation time
# (vsoaPermittedMsgTypes, verana-node x/pp/types/types.go). The Corporation
# operator account, which runs these scripts, holds the OperatorAuthorization
# instead; one account can never hold both.
readonly VSOA_ISSUER="/verana.pp.v1.MsgCreateOrUpdateParticipantSession,/verana.pp.v1.MsgSetParticipantOPToValidated"
readonly VSOA_VERIFIER="/verana.pp.v1.MsgCreateOrUpdateParticipantSession"
readonly VSOA_HOLDER="/verana.pp.v1.MsgTriggerResolver"

# ---------------------------------------------------------------------------
# OperatorAuthorization message types, per service role
# ---------------------------------------------------------------------------
# The blanket grant the Corporation gives its operator account. Keep each list
# to what the role actually sends. A Corporation created for a narrow role must
# widen its grant before it takes on a wider one — the chain checks each message
# type separately, so a missing entry surfaces much later, at the first
# transaction that needs it. Use ensure_operator_authorization for that.
#
# MsgCreateOrUpdateParticipantSession is deliberately absent: the chain refuses
# it in a blanket grant, and delegates it per participant through the VSOA.
readonly OA_MSGS_ECOSYSTEM='["/verana.ec.v1.MsgCreateEcosystem","/verana.ec.v1.MsgUpdateEcosystem","/verana.ec.v1.MsgArchiveEcosystem","/verana.cs.v1.MsgCreateCredentialSchema","/verana.pp.v1.MsgCreateRootParticipant","/verana.pp.v1.MsgStartParticipantOP","/verana.pp.v1.MsgSetParticipantOPToValidated","/verana.pp.v1.MsgRenewParticipantOP","/verana.pp.v1.MsgCancelParticipantOPLastRequest","/verana.pp.v1.MsgSelfCreateParticipant","/verana.pp.v1.MsgRevokeParticipant","/verana.pp.v1.MsgTriggerResolver"]'

# Used only by the local <service>/scripts/setup.sh path, which still gives each demo service
# its own Corporation. The GitHub workflows no longer do that: a service joins organization-vs's
# Corporation, because the DID ownership invariant binds a DID to one Corporation and lets one
# Corporation own many DIDs. Port the local scripts the same way, then delete these.
readonly OA_MSGS_ISSUER='["/verana.pp.v1.MsgStartParticipantOP","/verana.pp.v1.MsgRenewParticipantOP","/verana.pp.v1.MsgCancelParticipantOPLastRequest","/verana.pp.v1.MsgTriggerResolver"]'
readonly OA_MSGS_VERIFIER='["/verana.pp.v1.MsgSelfCreateParticipant","/verana.pp.v1.MsgStartParticipantOP","/verana.pp.v1.MsgRenewParticipantOP","/verana.pp.v1.MsgCancelParticipantOPLastRequest","/verana.pp.v1.MsgTriggerResolver"]'

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

# Check that the veranad account has sufficient balance for on-chain transactions.
# Usage: check_balance <user_acc>
check_balance() {
  local user_acc=$1
  local addr
  addr=$(veranad keys show "$user_acc" -a --keyring-backend test 2>/dev/null)
  if [ -z "$addr" ]; then
    err "Account '$user_acc' not found in keyring"
    return 1
  fi

  local balance
  balance=$(veranad q bank balances "$addr" --node "$NODE_RPC" --output json 2>/dev/null \
    | jq -r '.balances[]? | select(.denom == "uvna") | .amount // "0"' 2>/dev/null || echo "0")

  if [ -z "$balance" ] || [ "$balance" = "0" ]; then
    err "Account '$user_acc' ($addr) has no uvna balance."
    err "On-chain transactions require funds. Top up using the faucet:"
    err ""
    err "  ${FAUCET_URL}"
    err ""
    return 1
  fi

  ok "Account balance: ${balance} uvna"
}

# Submit a veranad tx command, wait for confirmation, and extract an event value.
# Usage: submit_tx <event_type> <attr_key> <veranad tx ...args>
# Returns the extracted value on stdout; exits on failure.
submit_tx() {
  local event_type=$1; shift
  local attr_key=$1; shift

  local raw_output
  raw_output=$("$@" \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --node "$NODE_RPC" \
    --output json -y 2>&1) || true

  local result
  result=$(echo "$raw_output" | extract_tx_json)

  local tx_hash
  tx_hash=$(echo "$result" | jq -r '.txhash // empty')
  if [ -z "$tx_hash" ]; then
    err "TX failed. Raw output:"
    echo "$raw_output" >&2
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

# Submit a message as a group proposal, vote YES with auto-execute, and return
# the proposal execution TX hash. Used for operations that require the
# Corporation's group policy account itself as the signer (e.g. granting
# operator authorization before the operator has any grant of its own).
# Usage: exec_group_proposal <corporation_policy_address> "<description>" '<message_json>'
exec_group_proposal() {
  local corporation=$1
  local description=$2
  local message_json=$3

  local tmpfile
  tmpfile=$(mktemp /tmp/group_proposal_XXXXXX.json)

  cat > "$tmpfile" << PROPEOF
{
  "group_policy_address": "$corporation",
  "proposers": ["$USER_ACC_ADDR"],
  "metadata": "$description",
  "messages": [ $message_json ],
  "title": "$description",
  "summary": "$description"
}
PROPEOF

  local prop_raw
  prop_raw=$(veranad tx group submit-proposal "$tmpfile" \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --gas-adjustment 1.5 --node "$NODE_RPC" \
    --output json -y 2>&1) || true
  echo "$prop_raw" >&2
  rm -f "$tmpfile"

  local prop_result
  prop_result=$(echo "$prop_raw" | extract_tx_json)
  local prop_tx
  prop_tx=$(echo "$prop_result" | jq -r '.txhash // empty')
  if [ -z "$prop_tx" ]; then
    err "Failed to submit group proposal. Raw output: $prop_raw"
    return 1
  fi

  sleep 6

  local prop_id
  prop_id=$(veranad q tx "$prop_tx" --node "$NODE_RPC" --output json 2>/dev/null \
    | jq -r '.events[] | select(.type == "cosmos.group.v1.EventSubmitProposal") | .attributes[] | select(.key == "proposal_id") | .value' \
    | tr -d '"' | head -1)
  if [ -z "$prop_id" ]; then
    err "Could not extract proposal ID"
    return 1
  fi

  local vote_raw
  vote_raw=$(veranad tx group vote \
    "$prop_id" "$USER_ACC_ADDR" VOTE_OPTION_YES "" \
    --exec 1 \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --gas-adjustment 1.5 --node "$NODE_RPC" \
    --output json -y 2>&1) || true
  echo "$vote_raw" >&2

  local vote_result
  vote_result=$(echo "$vote_raw" | extract_tx_json)
  local vote_tx
  vote_tx=$(echo "$vote_result" | jq -r '.txhash // empty')
  if [ -z "$vote_tx" ]; then
    err "Failed to vote on proposal $prop_id. Raw output: $vote_raw"
    return 1
  fi

  sleep 6
  echo "$vote_tx"
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
  while [ $i -lt "$max_retries" ]; do
    if curl -sf "${admin_api}/v1/agent" > /dev/null 2>&1; then
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done
  return 1
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
# CLI setup helpers
# ---------------------------------------------------------------------------

# Derive USER_ACC_ADDR from the keyring when the caller has not set it. The
# interactive setup_veranad_account sets it, but CI imports the key directly and
# never calls that helper. An empty value reaches the chain as an empty member
# address, which fails with "members[0].address is required".
require_user_acc_addr() {
  if [ -z "${USER_ACC_ADDR:-}" ]; then
    USER_ACC_ADDR=$(veranad keys show "$USER_ACC" -a --keyring-backend test 2>/dev/null) || true
    export USER_ACC_ADDR
  fi
  if [ -z "${USER_ACC_ADDR:-}" ]; then
    err "Could not derive an address for '$USER_ACC'. Is the key in the keyring?"
    return 1
  fi
}

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
    read -rp "  Press Enter once the account is funded (or Ctrl+C to abort)... "

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
  date -u -v+"${seconds}"S +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
    || date -u -d "+${seconds} seconds" +"%Y-%m-%dT%H:%M:%SZ"
}

# ---------------------------------------------------------------------------
# Corporation helpers (verana.co.v1 / verana.de.v1)
# ---------------------------------------------------------------------------

# Create a Corporation and grant its operator (USER_ACC_ADDR) a blanket
# OperatorAuthorization covering the given msg types. Sets CORPORATION_ID and
# CORPORATION (policy address) on success.
# Usage: create_corporation <did> [doc_url] [doc_digest_sri] [msg_types_json_array]
create_corporation() {
  require_user_acc_addr || return 1
  local did=$1
  local doc_url="${2:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"
  local doc_digest="${3:-}"
  local msg_types="$4"
  if [ -z "$msg_types" ]; then
    msg_types="$OA_MSGS_ECOSYSTEM"
  fi

  if [ -z "$doc_digest" ]; then
    doc_digest=$(compute_sri_digest "$doc_url")
  fi

  log "Creating Corporation (did: $did)..."
  check_balance "$USER_ACC"

  local members_json="{\"address\":\"${USER_ACC_ADDR}\",\"weight\":\"1\",\"metadata\":\"demo corporation\"}"
  local decision_policy_json='{"@type":"/cosmos.group.v1.ThresholdDecisionPolicy","threshold":"1","windows":{"voting_period":"432000s","min_execution_period":"0s"}}'

  local raw_output
  raw_output=$(veranad tx co create-corporation \
    --did "$did" --language en \
    --doc-url "$doc_url" --doc-digest-sri "$doc_digest" \
    --group-metadata "demo corporation" --group-policy-metadata "demo corporation policy" \
    --members "$members_json" \
    --decision-policy "$decision_policy_json" \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --gas-adjustment 1.5 --node "$NODE_RPC" \
    --output json -y 2>&1) || true
  echo "$raw_output" >&2
  local result
  local tx_hash
  result=$(echo "$raw_output" | extract_tx_json)
  tx_hash=$(echo "$result" | jq -r '.txhash // empty')
  if [ -z "$tx_hash" ]; then
    err "Failed to create corporation. Raw output: $raw_output"
    return 1
  fi
  ok "TX submitted: $tx_hash"
  sleep 6

  CORPORATION_ID=$(extract_tx_event "$tx_hash" "create_corporation" "corporation_id")
  CORPORATION=$(extract_tx_event "$tx_hash" "create_corporation" "policy_address")
  if [ -z "$CORPORATION_ID" ] || [ -z "$CORPORATION" ]; then
    err "Could not extract corporation_id/policy_address from tx events"
    return 1
  fi
  ok "Corporation created: id=$CORPORATION_ID policy_address=$CORPORATION"

  log "Funding corporation..."
  local fund_raw
  fund_raw=$(veranad tx bank send "$USER_ACC_ADDR" "$CORPORATION" 100000000uvna \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --node "$NODE_RPC" \
    --output json -y 2>&1) || true
  local fund_tx
  fund_tx=$(echo "$fund_raw" | extract_tx_json | jq -r '.txhash // empty')
  if [ -z "$fund_tx" ]; then
    err "Failed to fund corporation. Raw output: $fund_raw"
    return 1
  fi
  ok "Corporation funded (100 VNA): TX $fund_tx"
  sleep 6

  log "Granting operator authorization to $USER_ACC_ADDR..."
  local grant_msg
  grant_msg=$(cat << GRANTEOF
{
  "@type": "/verana.de.v1.MsgGrantOperatorAuthorization",
  "corporation": "$CORPORATION",
  "operator": "$CORPORATION",
  "grantee": "$USER_ACC_ADDR",
  "msg_types": $msg_types,
  "with_feegrant": true
}
GRANTEOF
)
  local grant_tx
  grant_tx=$(exec_group_proposal "$CORPORATION" "Grant operator authorization to $USER_ACC_ADDR" "$grant_msg")
  if [ -z "$grant_tx" ]; then
    err "Failed to grant operator authorization via group proposal"
    return 1
  fi
  ok "Operator authorization granted: TX $grant_tx"

  export CORPORATION_ID CORPORATION
}

# Resolve an existing Corporation's policy_address from its id.
# Usage: resolve_corporation <corporation_id>
# Sets CORPORATION on success.
resolve_corporation() {
  local corporation_id=$1
  local corp_json
  corp_json=$(veranad query co get-corporation "$corporation_id" --node "$NODE_RPC" --output json 2>/dev/null || true)
  CORPORATION=$(echo "$corp_json" | jq -r '.corporation.policy_address // .corporation.policyAddress // .policy_address // .policyAddress // empty' 2>/dev/null || echo "")
  if [ -z "$CORPORATION" ]; then
    err "Could not resolve policy_address for corporation $corporation_id"
    return 1
  fi
  ok "Corporation $corporation_id policy_address: $CORPORATION"
  export CORPORATION
}

# Make sure the operator's blanket OperatorAuthorization covers every message
# type the service sends. A Corporation created for a narrow role keeps that
# narrow grant, so a service that later takes on a wider role fails at its first
# transaction of the new kind, far from the cause. Re-grants the union, so it
# never removes a message type another role still needs.
# Usage: ensure_operator_authorization <corporation> <grantee> <msg_types_json>
ensure_operator_authorization() {
  require_user_acc_addr || return 1
  local corporation=$1
  # The caller usually passes $USER_ACC_ADDR, which is empty when the keyring was imported
  # directly, as CI does. require_user_acc_addr has just derived it, so fall back to it.
  local grantee="${2:-$USER_ACC_ADDR}"
  local required=$3

  # An authorization is per corporation, and one account may operate several. Resolve the id
  # of this corporation from its policy address, so the check never unions the grants of
  # another corporation and then reports this one as complete.
  local corporation_id
  corporation_id=$(veranad query co list-corporations --node "$NODE_RPC" --output json 2>/dev/null \
    | jq -r --arg addr "$corporation" '(.corporations // [])[] | select(.policy_address == $addr) | .id' | head -1)
  if [ -z "$corporation_id" ]; then
    err "Could not resolve a corporation id for policy address $corporation"
    return 1
  fi

  local granted
  granted=$(veranad query de list-operator-authorizations --node "$NODE_RPC" --output json 2>/dev/null \
    | jq -c --arg g "$grantee" --arg c "$corporation_id" '[(.operator_authorizations // [])[]
        | select(.operator == $g and (.corporation_id|tostring) == $c and (.revoked // null) == null)
        | .msg_types[]] | unique') || granted='[]'
  [ -n "$granted" ] || granted='[]'

  local missing
  missing=$(jq -c -n --argjson have "$granted" --argjson want "$required" '$want - $have')
  if [ "$missing" = "[]" ]; then
    ok "Operator authorization already covers every required message type"
    return 0
  fi
  warn "Operator authorization is missing: $(echo "$missing" | jq -r 'join(", ")')"

  local union
  union=$(jq -c -n --argjson have "$granted" --argjson want "$required" '($have + $want) | unique')
  local grant_msg
  grant_msg=$(jq -c -n --arg c "$corporation" --arg g "$grantee" --argjson m "$union" \
    '{"@type":"/verana.de.v1.MsgGrantOperatorAuthorization",corporation:$c,operator:$c,grantee:$g,msg_types:$m,with_feegrant:true}')

  log "Widening the operator authorization to $(echo "$union" | jq -r 'length') message types..."
  exec_group_proposal "$corporation" "Widen operator authorization" "$grant_msg" > /dev/null || {
    err "Could not widen the operator authorization for $grantee"
    return 1
  }
  sleep 6
  ok "Operator authorization widened"
}

# ---------------------------------------------------------------------------
# Ecosystem / Credential Schema / Participant helpers (verana.ec.v1 / cs.v1 / pp.v1)
# ---------------------------------------------------------------------------

# Onboarding mode constants (x/cs/v1 IssuerOnboardingMode / VerifierOnboardingMode /
# HolderOnboardingMode enums — numeric, verified against verana-node's
# tx.proto/types.proto).
readonly ONBOARDING_MODE_OPEN=1
readonly ONBOARDING_MODE_ECOSYSTEM=2
readonly ONBOARDING_MODE_GRANTOR=3
readonly HOLDER_MODE_ISSUER_OP=1
readonly HOLDER_MODE_PERMISSIONLESS=2

# Participant role constants (x/pp/v1 ParticipantRole enum). The CLI's [role]
# positional arg and the indexer's `role` query param take different casing —
# verified against verana-node's autocli.go (CLI: lowercase, hyphenated) and
# vs-agent's VeranaIndexerService.ts (indexer: uppercase, underscored).
readonly PP_ROLE_ISSUER="issuer"
readonly PP_ROLE_VERIFIER="verifier"
readonly PP_ROLE_ISSUER_GRANTOR="issuer-grantor"
readonly PP_ROLE_VERIFIER_GRANTOR="verifier-grantor"
readonly PP_ROLE_ECOSYSTEM="ecosystem"
readonly PP_ROLE_HOLDER="holder"

readonly PP_IDX_ROLE_ISSUER="ISSUER"
readonly PP_IDX_ROLE_VERIFIER="VERIFIER"
readonly PP_IDX_ROLE_ISSUER_GRANTOR="ISSUER_GRANTOR"
readonly PP_IDX_ROLE_VERIFIER_GRANTOR="VERIFIER_GRANTOR"
readonly PP_IDX_ROLE_ECOSYSTEM="ECOSYSTEM"
readonly PP_IDX_ROLE_HOLDER="HOLDER"

# Create an Ecosystem under a Corporation. Sets ECOSYSTEM_ID.
# Usage: create_ecosystem <corporation> <did> [doc_url] [doc_digest_sri]
create_ecosystem() {
  local corporation=$1
  local did=$2
  local doc_url="${3:-https://verana-labs.github.io/governance-docs/EGF/example.pdf}"
  local doc_digest="${4:-}"

  if [ -z "$doc_digest" ]; then
    doc_digest=$(compute_sri_digest "$doc_url")
  fi

  log "Creating Ecosystem (did: $did)..."
  local raw_output
  raw_output=$(veranad tx ec create-ecosystem \
    "$corporation" "$did" en "$doc_url" "$doc_digest" \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --node "$NODE_RPC" \
    --output json -y 2>&1) || true
  echo "$raw_output" >&2
  local tx_hash
  tx_hash=$(echo "$raw_output" | extract_tx_json | jq -r '.txhash // empty')
  if [ -z "$tx_hash" ]; then
    err "Failed to create ecosystem. Raw output: $raw_output"
    return 1
  fi
  ok "TX submitted: $tx_hash"
  sleep 6

  ECOSYSTEM_ID=$(extract_tx_event "$tx_hash" "create_ecosystem" "ecosystem_id")
  if [ -z "$ECOSYSTEM_ID" ]; then
    err "Could not extract ecosystem_id from tx events"
    return 1
  fi
  ok "Ecosystem created: id=$ECOSYSTEM_ID"
  export ECOSYSTEM_ID
}

# Check the indexer for an Ecosystem already owned by a Corporation.
# Usage: find_ecosystem_for_corporation <corporation_id>
# Prints the ecosystem id on stdout if found (and returns 0); returns 1 otherwise.
find_ecosystem_for_corporation() {
  local corporation_id=$1
  local eco_id
  eco_id=$(veranad query ec list-ecosystems --corporation-id "$corporation_id" --node "$NODE_RPC" --output json 2>/dev/null \
    | jq -r '.ecosystems[0].id // empty' 2>/dev/null || echo "")
  if [ -n "$eco_id" ]; then
    echo "$eco_id"
    return 0
  fi
  return 1
}

# Create a Credential Schema under an Ecosystem. Echoes the schema id on success.
# Usage: create_credential_schema <corporation> <ecosystem_id> <schema_json> <issuer_mode> <verifier_mode> <holder_mode>
create_credential_schema() {
  local corporation=$1
  local ecosystem_id=$2
  local schema_json=$3
  local issuer_mode=$4
  local verifier_mode=$5
  local holder_mode=$6

  log "Creating credential schema under ecosystem $ecosystem_id (issuer=$issuer_mode, verifier=$verifier_mode, holder=$holder_mode)..."
  local raw_output
  raw_output=$(veranad tx cs create-credential-schema \
    "$ecosystem_id" "$schema_json" "$issuer_mode" "$verifier_mode" "$holder_mode" \
    1 tu sha384 \
    --corporation "$corporation" \
    --issuer-grantor-validation-validity-period '{"value":0}' \
    --verifier-grantor-validation-validity-period '{"value":0}' \
    --issuer-validation-validity-period '{"value":0}' \
    --verifier-validation-validity-period '{"value":0}' \
    --holder-validation-validity-period '{"value":0}' \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --node "$NODE_RPC" \
    --output json -y 2>&1) || true
  echo "$raw_output" >&2
  local tx_hash
  tx_hash=$(echo "$raw_output" | extract_tx_json | jq -r '.txhash // empty')
  if [ -z "$tx_hash" ]; then
    err "Failed to create credential schema. Raw output: $raw_output"
    return 1
  fi
  ok "TX submitted: $tx_hash"
  sleep 8

  local schema_id
  schema_id=$(extract_tx_event "$tx_hash" "create_credential_schema" "credential_schema_id")
  if [ -z "$schema_id" ]; then
    sleep 6
    schema_id=$(extract_tx_event "$tx_hash" "create_credential_schema" "credential_schema_id")
  fi
  if [ -z "$schema_id" ]; then
    err "Could not extract schema ID"
    return 1
  fi
  ok "Credential schema created: id=$schema_id"
  echo "$schema_id"
}

# Create a Root Participant (role=ECOSYSTEM) for a schema. Echoes the participant id.
# Usage: create_root_participant <corporation> <schema_id> <did>
create_root_participant() {
  local corporation=$1
  local schema_id=$2
  local did=$3

  log "Creating root participant for schema $schema_id..."
  local now
  now=$(future_timestamp 15)

  local raw_output
  raw_output=$(veranad tx pp create-root-participant \
    "$schema_id" "$did" 0 0 0 \
    --corporation "$corporation" --effective-from "$now" \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --node "$NODE_RPC" \
    --output json -y 2>&1) || true
  echo "$raw_output" >&2
  local tx_hash
  tx_hash=$(echo "$raw_output" | extract_tx_json | jq -r '.txhash // empty')
  if [ -z "$tx_hash" ]; then
    err "Failed to create root participant. Raw output: $raw_output"
    return 1
  fi
  ok "TX submitted: $tx_hash"
  sleep 6

  local participant_id
  participant_id=$(extract_tx_event "$tx_hash" "create_root_participant" "root_participant_id")
  if [ -z "$participant_id" ]; then
    err "Could not extract root participant ID"
    return 1
  fi
  ok "Root participant created: id=$participant_id"
  echo "$participant_id"
}

# Submit StartParticipantOP. The applicant agent drives the rest (DIDComm
# onboarding-request) automatically once this lands on-chain — see
# startParticipantOPAutoFlow in vs-agent. Echoes the new participant id.
# Usage: start_participant_op <corporation> <role> <validator_participant_id> <did>
#   role: one of $PP_ROLE_ISSUER / $PP_ROLE_VERIFIER / $PP_ROLE_HOLDER / ...
start_participant_op() {
  local corporation=$1
  local role=$2
  local validator_participant_id=$3
  local did=$4
  local vs_operator="${5:-}"
  local vs_operator_msg_types="${6:-}"

  # The vs_operator and its msg types are frozen at creation: the only way to
  # correct them later is to revoke the participant and create it again.
  local vsoa_args=()
  if [ -n "$vs_operator" ]; then
    vsoa_args=(--vs-operator "$vs_operator"
               --vs-operator-authz-msg-types "$vs_operator_msg_types"
               --vs-operator-authz-with-feegrant)
  fi

  log "Starting participant OP (role=$role) against validator $validator_participant_id..."
  local raw_output
  raw_output=$(veranad tx pp start-participant-op \
    "$role" "$validator_participant_id" "$did" \
    --corporation "$corporation" \
    "${vsoa_args[@]}" \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --node "$NODE_RPC" \
    --output json -y 2>&1) || true
  echo "$raw_output" >&2
  local tx_hash
  tx_hash=$(echo "$raw_output" | extract_tx_json | jq -r '.txhash // empty')
  if [ -z "$tx_hash" ]; then
    err "Failed to start participant OP. Raw output: $raw_output"
    return 1
  fi
  ok "TX submitted: $tx_hash"
  sleep 6

  local participant_id
  participant_id=$(extract_tx_event "$tx_hash" "start_participant_op" "participant_id")
  if [ -z "$participant_id" ]; then
    err "Could not extract participant ID"
    return 1
  fi
  ok "Participant OP started: id=$participant_id (state: PENDING)"
  echo "$participant_id"
}

# Self-create a participant (OPEN mode only — no onboarding process). Echoes the
# new participant id.
# Usage: self_create_participant <corporation> <role> <validator_participant_id> <did>
#   role: one of $PP_ROLE_ISSUER / $PP_ROLE_VERIFIER
self_create_participant() {
  local corporation=$1
  local role=$2
  local validator_participant_id=$3
  local did=$4
  local vs_operator="${5:-}"
  local vs_operator_msg_types="${6:-}"

  local vsoa_args=()
  if [ -n "$vs_operator" ]; then
    vsoa_args=(--vs-operator "$vs_operator"
               --vs-operator-authz-msg-types "$vs_operator_msg_types"
               --vs-operator-authz-with-feegrant)
  fi

  log "Self-creating participant (role=$role) against validator $validator_participant_id..."
  local raw_output
  # The chain makes effective_from mandatory on self-create-participant. Give it a
  # small lead, so the value is still in the future when the block commits.
  # CAUTION: a participant whose effective_from is null is INACTIVE, and the chain
  # refuses to revoke it, to adjust it, and to create an entry that overlaps it.
  raw_output=$(veranad tx pp self-create-participant \
    "$role" "$validator_participant_id" "$did" \
    --corporation "$corporation" \
    --effective-from "$(future_timestamp)" \
    "${vsoa_args[@]}" \
    --from "$USER_ACC" --chain-id "$CHAIN_ID" --keyring-backend test \
    --fees "$FEES" --gas auto --node "$NODE_RPC" \
    --output json -y 2>&1) || true
  echo "$raw_output" >&2
  local tx_hash
  tx_hash=$(echo "$raw_output" | extract_tx_json | jq -r '.txhash // empty')
  if [ -z "$tx_hash" ]; then
    err "Failed to self-create participant. Raw output: $raw_output"
    return 1
  fi
  ok "TX submitted: $tx_hash"
  sleep 6

  local participant_id
  participant_id=$(extract_tx_event "$tx_hash" "create_participant" "participant_id")
  if [ -z "$participant_id" ]; then
    err "Could not extract participant ID"
    return 1
  fi
  ok "Participant self-created: id=$participant_id"
  echo "$participant_id"
}

# Check the v4 indexer for an active participant of a given role/DID/schema.
# Usage: find_active_participant <schema_id> <role> <did>
#   role: one of $PP_IDX_ROLE_ISSUER / $PP_IDX_ROLE_VERIFIER / $PP_IDX_ROLE_ECOSYSTEM / ...
# Prints the participant id on stdout if found (and returns 0); returns 1 otherwise.
find_active_participant() {
  local schema_id=$1
  local role=$2
  local did=$3
  local url="${INDEXER_URL}/v4/participant/list?schema_id=${schema_id}&role=${role}&did=$(printf '%s' "$did" | jq -sRr @uri)&participant_state=ACTIVE"

  local resp http_code
  http_code=$(curl -s -o /tmp/participant_check.json -w '%{http_code}' "$url")
  if [ "$http_code" != "200" ]; then
    return 1
  fi
  resp=$(cat /tmp/participant_check.json)

  local participant_id
  participant_id=$(echo "$resp" | jq -r '
    .participants[]? |
    select(.revoked == null and .slashed == null) |
    .id' | head -1)

  if [ -n "$participant_id" ]; then
    echo "$participant_id"
    return 0
  fi
  return 1
}

# Find a participant of a DID/schema/role and print "<id>\t<vs_operator>".
# Unlike find_active_participant this also returns a PENDING entry, and it
# reports the vs_operator, so a caller can tell an entry it can use from one
# that names a different account and has to be recreated.
# Usage: find_participant_with_vs_operator <schema_id> <role> <did>
find_participant_with_vs_operator() {
  local schema_id=$1
  local role=$2
  local did=$3
  veranad query pp list-participants --schema-id "$schema_id" --role "$role" --node "$NODE_RPC" --output json 2>/dev/null \
    | jq -r --arg did "$did" '(.participants // [])[]
        | select(.did == $did and .revoked == null and .slashed == null)
        | [(.id|tostring), (.vs_operator // "")] | @tsv' \
    | head -1
}

# Read a VS Agent's public DID from its did:webvh log. Each line of the log is
# a version entry, and .state.id carries the DID, which is SCID-stable across
# versions.
# Usage: fetch_did_from_log <public_base_url>
fetch_did_from_log() {
  local base_url=$1
  local did_log did
  did_log=$(curl -sf "${base_url}/.well-known/did.jsonl" 2>/dev/null) || return 1
  did=$(echo "$did_log" | tail -1 | jq -r '.state.id // empty' 2>/dev/null)
  [ -z "$did" ] && return 1
  echo "$did"
}

# Find an ECS credential schema by its JSON Schema title, under the Ecosystem
# that a given DID controls.
# Usage: find_ecs_schema_id <ecosystem_did> <title>
#   title: OrganizationCredential | PersonaCredential | ServiceCredential | UserAgentCredential
find_ecs_schema_id() {
  local ecosystem_did=$1
  local title=$2

  local ecosystem_id
  ecosystem_id=$(curl -sf "${INDEXER_URL}/v4/ecosystem/list" 2>/dev/null \
    | jq -r --arg did "$ecosystem_did" '(.ecosystems // [])[]
        | select(.did == $did and (.archived == null or .archived == false)) | .id' | head -1)
  [ -z "$ecosystem_id" ] && return 1

  local schema_id
  schema_id=$(veranad query cs list-schemas --ecosystem_id "$ecosystem_id" --node "$NODE_RPC" --output json 2>/dev/null \
    | jq -r --arg title "$title" '(.schemas // [])[]
        | select((.json_schema | fromjson | .title) == $title) | .id' | head -1)
  [ -z "$schema_id" ] && return 1
  echo "$schema_id"
}

# Check the v4 indexer for the (root, ECOSYSTEM-role) active participant of a
# schema — the validator_participant_id start_participant_op/
# self_create_participant need.
# Usage: find_root_participant <schema_id>
# Prints the participant id on stdout if found (and returns 0); returns 1 otherwise.
find_root_participant() {
  local schema_id=$1
  local url="${INDEXER_URL}/v4/participant/list?schema_id=${schema_id}&role=${PP_IDX_ROLE_ECOSYSTEM}&participant_state=ACTIVE"

  local resp http_code
  http_code=$(curl -s -o /tmp/root_participant_check.json -w '%{http_code}' "$url")
  if [ "$http_code" != "200" ]; then
    return 1
  fi
  resp=$(cat /tmp/root_participant_check.json)

  local participant_id
  participant_id=$(echo "$resp" | jq -r '.participants[0].id // empty')

  if [ -n "$participant_id" ]; then
    echo "$participant_id"
    return 0
  fi
  return 1
}

# Extract a custom (non-ECS) schema's numeric ID from a VS Agent's DID
# document, by finding its "*-jsc-vp" LinkedVerifiablePresentation service
# entry (excluding the 4 ECS ones) and resolving the VTJSC's jsonSchema $ref.
# Usage: discover_custom_schema_id <did_document_url>
discover_custom_schema_id() {
  local did_doc_url=$1
  local did_doc
  did_doc=$(curl -sf "$did_doc_url" 2>/dev/null) || return 1

  local vp_url
  vp_url=$(echo "$did_doc" | jq -r '
    .service[] |
    select(.type == "LinkedVerifiablePresentation") |
    select(.id | test("organization-jsc-vp|persona-jsc-vp|service-jsc-vp|ua-jsc-vp") | not) |
    select(.id | test("jsc-vp")) |
    .serviceEndpoint' | head -1)
  [ -z "$vp_url" ] && return 1

  local vp schema_ref schema_id
  vp=$(curl -sf "$vp_url") || return 1
  schema_ref=$(echo "$vp" | jq -r '.verifiableCredential[0].credentialSubject.jsonSchema."$ref" // empty')
  schema_id=$(echo "$schema_ref" | grep -oE '[0-9]+$')
  [ -z "$schema_id" ] && return 1

  echo "$schema_id"
}

# ---------------------------------------------------------------------------
# vt-flow validator helper (/v1/vt/flows) — verified against the vs-agent source
# (VtFlowsController.ts): unauthenticated on the internal admin listener.
# ---------------------------------------------------------------------------

# SRI digest (sha384) of a URL's content, in the same "sha384-<base64>" form
# vs-agent computes with generateDigestSRI/urlDigestSri.
# Usage: sri_digest_sha384 <url>
sri_digest_sha384() {
  local url=$1
  local b64
  b64=$(curl -sf "$url" | openssl dgst -sha384 -binary | openssl base64 -A) || return 1
  [ -n "$b64" ] || return 1
  echo "sha384-${b64}"
}

# Find a pending onboarding request from a given peer DID and validate it,
# offering the credential if the flow calls for one. The validator only
# builds a credential from claims actually present on the flow record — pass
# claims_json (the real subject data, e.g. org name/registryId/address) so
# the offered credential conforms to the schema instead of being rejected as
# empty. Omit it only for schemas that carry no subject claims of their own.
# Usage: validate_pending_flow <admin_api> <peer_did> [schema_id] [claims_json]
# Resolve the Corporation that owns a DID, and set CORPORATION_ID and CORPORATION.
#
# The DID ownership invariant of the VPR gives every DID a single owning Corporation, so any
# active Participant entry that carries the DID names it. Services of one organization share
# that Corporation; they do not each need one.
# Usage: resolve_corporation_for_did <did>
resolve_corporation_for_did() {
  local did=$1
  local corp_id
  # Filter on the node: an unfiltered list is paged, and it answers with the oldest entries.
  corp_id=$(veranad query pp list-participants --did "$did" --node "$NODE_RPC" --output json 2>/dev/null \
    | jq -r 'first((.participants // [])[]
        | select(.revoked == null and .slashed == null)
        | .corporation_id) // empty')
  if [ -z "$corp_id" ]; then
    err "No active Participant carries $did, so its Corporation cannot be resolved"
    return 1
  fi
  CORPORATION_ID="$corp_id"
  export CORPORATION_ID
  resolve_corporation "$CORPORATION_ID"
}

# Build the claims of an ECS Service credential for a delegated service.
#
# In a delegated onboarding the applicant sends no claims: the validator supplies them, as it
# does for every other onboarding process. The agent serves its own terms, privacy policy and
# logo, so the digests come from the agent that will hold the credential.
# Usage: build_service_claims <public_url> <name> <type> <description> [logo_uri]
build_service_claims() {
  local public_url="${1%/}"
  local name=$2
  local type=$3
  local description=$4
  local logo_uri="${5:-${public_url}/vt/default/logo.svg}"

  local terms_uri="${public_url}/vt/default/terms.html"
  local privacy_uri="${public_url}/vt/default/privacy.html"

  local logo_digest terms_digest privacy_digest
  logo_digest=$(compute_sri_digest "$logo_uri") || return 1
  terms_digest=$(compute_sri_digest "$terms_uri") || return 1
  privacy_digest=$(compute_sri_digest "$privacy_uri") || return 1

  jq -c -n \
    --arg name "$name" --arg type "$type" --arg description "$description" \
    --arg logoUri "$logo_uri" --arg logoDigestSri "$logo_digest" \
    --arg termsUri "$terms_uri" --arg termsDigestSri "$terms_digest" \
    --arg privacyUri "$privacy_uri" --arg privacyDigestSri "$privacy_digest" \
    --argjson minimumAgeRequired "${SERVICE_MINIMUM_AGE:-18}" \
    '{name: $name, type: $type, description: $description,
      logoUri: $logoUri, logoDigestSri: $logoDigestSri,
      minimumAgeRequired: $minimumAgeRequired,
      termsAndConditionsUri: $termsUri, termsAndConditionsDigestSri: $termsDigestSri,
      privacyPolicyUri: $privacyUri, privacyPolicyDigestSri: $privacyDigestSri}'
}

validate_pending_flow() {
  local admin_api=$1
  local peer_did=$2
  local schema_id="${3:-}"
  local claims_json="${4:-}"

  log "Looking up pending vt-flow from $peer_did on $admin_api..."
  local query="role=validator&flowState=AWAITING_OR&peerDID=$(printf '%s' "$peer_did" | jq -sRr @uri)"
  [ -n "$schema_id" ] && query="${query}&schema_id=${schema_id}"

  local flows
  flows=$(curl -sf "${admin_api}/v1/vt/flows?${query}" 2>/dev/null)
  if [ -z "$flows" ] || [ "$flows" = "[]" ]; then
    err "No pending AWAITING_OR flow found from $peer_did on $admin_api"
    return 1
  fi

  local session_id
  session_id=$(echo "$flows" | jq -r '.[0].participantSessionId // .[0].participant_session_id // empty')
  if [ -z "$session_id" ]; then
    err "Could not extract participantSessionId from flow list: $flows"
    return 1
  fi
  ok "Found pending flow: $session_id"

  if [ -n "$claims_json" ]; then
    log "Submitting credential claims for flow $session_id..."
    local claims_result claims_http_code
    claims_http_code=$(curl -s -o /tmp/vt_flow_claims.json -w '%{http_code}' \
      -X PUT "${admin_api}/v1/vt/flows/${session_id}/claims" \
      -H 'Content-Type: application/json' \
      -d "$(jq -c -n --argjson claims "$claims_json" '{claims: $claims}')")
    claims_result=$(cat /tmp/vt_flow_claims.json)
    if [ "$claims_http_code" != "200" ] && [ "$claims_http_code" != "201" ]; then
      err "Failed to submit claims for flow $session_id (HTTP $claims_http_code). Response: $claims_result"
      return 1
    fi
    ok "Claims submitted for flow $session_id"
  fi

  local result http_code
  http_code=$(curl -s -o /tmp/vt_flow_validate.json -w '%{http_code}' \
    -X POST "${admin_api}/v1/vt/flows/${session_id}/validate")
  result=$(cat /tmp/vt_flow_validate.json)
  if [ "$http_code" != "200" ] && [ "$http_code" != "201" ]; then
    err "Failed to validate flow $session_id (HTTP $http_code). Response: $result"
    return 1
  fi
  ok "Flow validated: $session_id"
  echo "$session_id"
}

# Check whether a flow from a peer DID is already COMPLETED or VALIDATED
# (idempotency: skip re-validating).
# Usage: has_completed_flow <admin_api> <peer_did>
has_completed_flow() {
  local admin_api=$1
  local peer_did=$2
  local query="role=validator&peerDID=$(printf '%s' "$peer_did" | jq -sRr @uri)"

  local flows
  flows=$(curl -sf "${admin_api}/v1/vt/flows?${query}" 2>/dev/null) || return 1
  local match
  match=$(echo "$flows" | jq -r '
    [.[] | select(.flowState == "COMPLETED" or .flowState == "VALIDATED")] | length' 2>/dev/null || echo "0")
  [ "${match:-0}" -gt 0 ]
}
