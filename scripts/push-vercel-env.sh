#!/usr/bin/env bash
# Push a curated subset of .env values to Vercel project env (production
# + preview). Intentionally excludes dev-only keys (DEV_AUTH_BYPASS,
# legacy Manus OAuth vars). Values never print to stdout — fed to
# `vercel env add` via stdin.
set -euo pipefail

if [ ! -f .env ]; then
  echo "No .env at cwd; aborting." >&2
  exit 1
fi

# Vars that should exist in Vercel production environment.
VARS_PROD=(
  SUPABASE_DIRECT_CONNECTION_STRING
  SUPABASE_SESSION_POOLER_STRING
  SUPABASE_TRANSACTION_POOLER_STRING
  SUPABASE_SECRET_KEY
  VITE_SUPABASE_PROJECT_URL
  VITE_SUPABASE_PUBLISHABLE_KEY
  JWT_SECRET
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PRICE_PLAYER
  STRIPE_PRICE_PRO
  STRIPE_PRICE_ELITE
  ALLOWED_ORIGINS
)

VERCEL=./node_modules/.bin/vercel

push_var() {
  local name="$1" env="$2"
  # Extract the value from .env (strip "name=" prefix and trailing whitespace).
  local value
  value=$(awk -v k="$name" -F= 'BEGIN{OFS=""} $1==k {$1=""; sub(/^=/, ""); print; exit}' .env)
  if [ -z "$value" ]; then
    echo "  skip $name (no value in .env)"
    return
  fi
  # Remove if exists, then add fresh. `vercel env rm` is idempotent-ish.
  printf "%s" "$value" | "$VERCEL" env add "$name" "$env" >/dev/null 2>&1 || {
    "$VERCEL" env rm "$name" "$env" --yes >/dev/null 2>&1 || true
    printf "%s" "$value" | "$VERCEL" env add "$name" "$env" >/dev/null 2>&1 || {
      echo "  ❌ failed to add $name to $env"
      return
    }
  }
  echo "  ✅ $name → $env"
}

echo "Pushing env vars to Vercel (production + preview)…"
for v in "${VARS_PROD[@]}"; do
  push_var "$v" production
  push_var "$v" preview
done

echo "Done. Verify with: $VERCEL env ls"
