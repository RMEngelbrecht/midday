#!/bin/sh
# Fill empty secret variables in deploy/.env (idempotent: existing values are kept).
#   ./generate-secrets.sh [path/to/.env]
set -eu
cd "$(dirname "$0")"
ENV_FILE="${1:-.env}"
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"

fill() { # name generator-command
  if grep -Eq "^$1=.+" "$ENV_FILE"; then return; fi
  value=$(sh -c "$2")
  if grep -Eq "^$1=" "$ENV_FILE"; then
    # use a temp file: portable across BSD/GNU sed
    awk -v k="$1" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$ENV_FILE" >"$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$value" >>"$ENV_FILE"
  fi
  echo "generated $1"
}

hex32='openssl rand -hex 32'
fill POSTGRES_PASSWORD "$hex32"
fill MIDDAY_ENCRYPTION_KEY "$hex32"
fill FILE_KEY_SECRET "$hex32"
fill INVOICE_JWT_SECRET "$hex32"
fill INTERNAL_API_KEY "$hex32"
fill AUTH_SECRET "$hex32"
# Garage (profile s3). Harmless when unused.
fill GARAGE_RPC_SECRET "$hex32"
fill GARAGE_ADMIN_TOKEN "$hex32"
chmod 600 "$ENV_FILE"
fill S3_ACCESS_KEY_ID 'echo GK$(openssl rand -hex 12)'
fill S3_SECRET_ACCESS_KEY 'openssl rand -hex 32'
chmod 600 "$ENV_FILE"
