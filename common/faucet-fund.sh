#!/usr/bin/env bash
# =============================================================================
# faucet-fund.sh — Fund an account from the Verana faucet API, without a browser
# =============================================================================
#
# The faucet sends tokens only to an account that proves control of its key: the
# script signs the faucet challenge ("verana-faucet-auth:<nonce>") with an
# ADR-036 signature, exchanges it for a token, then asks for the tokens.
#
# Usage (the mnemonic comes from stdin, so it stays out of the shell history):
#   ./common/faucet-fund.sh [devnet|testnet] [amount_uvna] < mnemonic.txt
#
#   kubectl get secret -n verana-demos organization-vs-secrets \
#     -o jsonpath='{.data.ORGANIZATION_VS_MNEMONIC}' | base64 -d \
#     | ./common/faucet-fund.sh devnet 50000000
#
# Without an amount, the faucet sends its default (10 VNA). The faucet allows at
# most 50 VNA per account each hour and 300 VNA each day.
#
# The script needs Node.js 20 or later, or Docker. It installs @cosmjs/amino in
# a cache directory (FAUCET_FUND_CACHE, default ~/.cache/verana-faucet-fund).
# =============================================================================

set -euo pipefail

NETWORK="${1:-devnet}"
AMOUNT="${2:-}"
case "$NETWORK" in
  devnet|testnet) ;;
  *) echo "Usage: $0 [devnet|testnet] [amount_uvna] < mnemonic" >&2; exit 1 ;;
esac
FAUCET="${FAUCET_URL:-https://faucet.${NETWORK}.verana.network}"
CACHE="${FAUCET_FUND_CACHE:-$HOME/.cache/verana-faucet-fund}"

if [ -t 0 ]; then
  echo "Give the mnemonic on stdin, for example: ... | $0 $NETWORK" >&2
  exit 1
fi
MNEMONIC="$(cat)"
export MNEMONIC FAUCET AMOUNT

mkdir -p "$CACHE/app"
cat > "$CACHE/app/fund.cjs" <<'JS'
const { Secp256k1HdWallet } = require('@cosmjs/amino')
const { toBase64, toUtf8 } = require('@cosmjs/encoding')

async function post(url, body, token) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function main() {
  const { MNEMONIC, FAUCET, AMOUNT } = process.env
  if (!MNEMONIC || !MNEMONIC.trim()) throw new Error('the mnemonic on stdin is empty')
  const wallet = await Secp256k1HdWallet.fromMnemonic(MNEMONIC.trim(), { prefix: 'verana' })
  const [{ address }] = await wallet.getAccounts()
  console.error(`account: ${address}`)

  const { nonce } = await post(`${FAUCET}/v1/auth/challenge`, { account: address })
  // ADR-036 sign doc, the same one that a browser wallet builds for signArbitrary.
  const signDoc = {
    chain_id: '',
    account_number: '0',
    sequence: '0',
    fee: { gas: '0', amount: [] },
    msgs: [{ type: 'sign/MsgSignData', value: { signer: address, data: toBase64(toUtf8(`verana-faucet-auth:${nonce}`)) } }],
    memo: '',
  }
  const { signature } = await wallet.signAmino(address, signDoc)
  const { token } = await post(`${FAUCET}/v1/auth/token`, {
    account: address,
    pubKey: signature.pub_key.value,
    signature: signature.signature,
    nonce,
  })
  const r = await post(`${FAUCET}/v1/faucet`, AMOUNT ? { amount: AMOUNT } : {}, token)
  console.log(JSON.stringify({ account: address, status: r.status, txHash: r.txHash, height: r.height, amount: r.amount, denom: r.denom }))
}

main().catch(e => {
  console.error(`error: ${e.message}`)
  process.exit(1)
})
JS

DEPS="@cosmjs/amino@0.32.4 @cosmjs/encoding@0.32.4"

if command -v node > /dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then
  if [ ! -d "$CACHE/deps/node_modules/@cosmjs/amino" ]; then
    mkdir -p "$CACHE/deps"
    (cd "$CACHE/deps" && npm init -y > /dev/null && npm install --silent --no-audit --no-fund $DEPS > /dev/null)
  fi
  NODE_PATH="$CACHE/deps/node_modules" node "$CACHE/app/fund.cjs"
elif command -v docker > /dev/null; then
  mkdir -p "$CACHE/deps"
  docker run --rm -e MNEMONIC -e FAUCET -e AMOUNT \
    -v "$CACHE/app:/app:ro" -v "$CACHE/deps:/deps" node:22-alpine sh -c "
      cd /deps && { [ -d node_modules/@cosmjs/amino ] || { npm init -y > /dev/null && npm install --silent --no-audit --no-fund $DEPS > /dev/null; }; } &&
      NODE_PATH=/deps/node_modules node /app/fund.cjs"
else
  echo "error: the script needs Node.js 20 or later, or Docker" >&2
  exit 1
fi
