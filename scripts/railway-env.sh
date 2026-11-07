#!/usr/bin/env bash
# Copies the server's settings from .env into the linked Railway service, without printing values.
# Usage: bash scripts/railway-env.sh https://<your-vercel-app>.vercel.app
# Skips agent/LLM keys (not needed on the server) and PORT (Railway sets it).
set -euo pipefail
WEB_URL="${1:?pass the Vercel URL, e.g. https://leash.vercel.app}"
args=()
while IFS= read -r line; do
  [[ "$line" =~ ^[A-Z0-9_]+= ]] || continue
  k="${line%%=*}"; v="${line#*=}"; v="${v%%#*}"; v="$(echo -n "$v" | sed -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//')"
  [[ -z "$v" ]] && continue
  case "$k" in PORT|DATABASE_URL|PUBLIC_BASE_URL|WEB_ORIGIN|LEASH_API_URL|LEASH_AGENT_API_KEY|AGENT_*|ANTHROPIC_API_KEY|GITHUB_MODELS_TOKEN|GROQ_API_KEY|GEMINI_API_KEY|OPENROUTER_API_KEY) continue;; esac
  args+=(--set "$k=$v")
done < .env
args+=(--set "LEASH_FAKE_CHAINS=0" --set "MOUNT_MERCHANT=1" --set "MERCHANT_ASSET=0.0.0" --set "NIXPACKS_NODE_VERSION=22")
args+=(--set "DATABASE_URL=file:./leash.db" --set "PUBLIC_BASE_URL=$WEB_URL" --set "WEB_ORIGIN=$WEB_URL")
railway variables "${args[@]}" --skip-deploys > /dev/null
echo "set $(( ${#args[@]} / 2 )) variables on Railway (values not shown)"
