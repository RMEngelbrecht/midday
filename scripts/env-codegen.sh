#!/bin/sh
# Regenerate the typed `src/env.ts` of every workspace that has a .env.schema.
# Output depends only on the schemas (not on values), so CI can check for drift:
#   bun run env:codegen && git diff --exit-code -- '*/src/env.ts'
set -e
cd "$(dirname "$0")/.."
for dir in apps/*/ packages/*/; do
  if [ -f "$dir.env.schema" ]; then
    bunx varlock codegen --path "$dir"
  fi
done
