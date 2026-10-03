#!/bin/sh
# Brings up a throwaway Midday compose stack for the e2e suite.
#
#   e2e/stack.sh up [full]   build and start; `full` adds the s3 + dev profiles
#                            (Garage object storage, Mailpit SMTP sink)
#   e2e/stack.sh down        stop and delete the stack and its volumes
#   e2e/stack.sh logs        tail api and worker logs
#
# Env: E2E_PROJECT (compose project, default midday-e2e), E2E_HTTP_PORT
# (default 8080), E2E_HTTPS_PORT, E2E_NO_BUILD=1 to use pulled images.
# Overwrites deploy/.env; refuses when one exists unless E2E_OVERWRITE_ENV=1.
set -eu
cd "$(dirname "$0")/../deploy"

PROJECT="${E2E_PROJECT:-midday-e2e}"
PORT="${E2E_HTTP_PORT:-8080}"
HTTPS_PORT="${E2E_HTTPS_PORT:-8443}"
compose() { docker compose -p "$PROJECT" "$@"; }

setenv() { # key value: replace or append in .env
  if grep -q "^$1=" .env; then
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' .env >.env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$1" "$2" >>.env
  fi
}

case "${1:-}" in
  up)
    if [ -f .env ] && [ "${E2E_OVERWRITE_ENV:-}" != 1 ]; then
      echo "deploy/.env exists; set E2E_OVERWRITE_ENV=1 to overwrite it" >&2
      exit 1
    fi
    cp .env.example .env
    ./generate-secrets.sh >/dev/null
    # lvh.me resolves to 127.0.0.1 and gives the two hosts a shared parent
    # domain, which the session cookie needs (app.localhost would not work).
    setenv DOMAIN lvh.me
    setenv CADDY_SCHEME http://
    setenv HTTP_PORT "$PORT"
    setenv HTTPS_PORT "$HTTPS_PORT"
    setenv APP_URL "http://app.lvh.me:$PORT"
    setenv API_URL "http://api.lvh.me:$PORT"
    profiles=""
    if [ "${2:-}" = full ]; then
      profiles="--profile s3 --profile dev"
      setenv STORAGE_DRIVER s3
      setenv S3_ENDPOINT http://garage:3900
      setenv S3_REGION garage
      setenv S3_BUCKET midday
      setenv S3_FORCE_PATH_STYLE true
      setenv SMTP_URL smtp://mailpit:1025
      setenv MAILPIT_PORT 8025
    fi
    build="--build"
    [ "${E2E_NO_BUILD:-}" = 1 ] && build=""
    # shellcheck disable=SC2086
    compose $profiles up -d $build
    printf 'waiting for the API'
    i=0
    until curl -fsS "http://api.lvh.me:$PORT/health" >/dev/null 2>&1; do
      i=$((i + 1))
      [ "$i" -gt 90 ] && { echo " timed out"; compose logs --tail 80; exit 1; }
      printf .; sleep 2
    done
    echo " ready"
    ;;
  down)
    compose --profile s3 --profile dev --profile ai down -v
    rm -f .env
    ;;
  logs)
    compose logs -f api worker
    ;;
  *)
    echo "usage: $0 up [full] | down | logs" >&2
    exit 2
    ;;
esac
