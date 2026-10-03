#!/usr/bin/env bash
# Fails when hardcoded midday.ai hosts creep back into source. URLs must come
# from APP_URL / API_URL (see packages/utils/src/envs.ts) or local assets.
# Docs and licences are excluded.
set -euo pipefail
cd "$(dirname "$0")/.."

hits=$(grep -rInE 'midday\.ai' apps packages \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.turbo \
  --exclude-dir=dist --exclude-dir=target --exclude-dir=docs \
  --exclude='*.md' --exclude=LICENSE || true)

if [ -n "$hits" ]; then
  echo "Hardcoded midday.ai URLs found (use APP_URL/API_URL or local assets):" >&2
  echo "$hits" >&2
  exit 1
fi
echo "No hardcoded midday.ai URLs."
