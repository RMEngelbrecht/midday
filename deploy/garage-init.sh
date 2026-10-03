#!/bin/sh
# Idempotent Garage bootstrap via the admin API (v1): single-node layout,
# bucket and the access key from S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.
set -eu
apk add --no-cache curl jq >/dev/null
A="$GARAGE_ADMIN_URL"
H="Authorization: Bearer $GARAGE_ADMIN_TOKEN"
BUCKET="${S3_BUCKET:-midday}"
api() { curl -fsS -H "$H" -H 'Content-Type: application/json' "$@"; }

for _ in $(seq 1 60); do api "$A/v1/status" >/dev/null 2>&1 && break; sleep 1; done

ST=$(api "$A/v1/status")
NODE=$(echo "$ST" | jq -r '.node')
if [ "$(echo "$ST" | jq '[.nodes[] | select(.role != null)] | length')" = 0 ]; then
  api -X POST "$A/v1/layout" -d "[{\"id\":\"$NODE\",\"zone\":\"dc1\",\"capacity\":1073741824,\"tags\":[]}]" >/dev/null
  VER=$(api "$A/v1/layout" | jq '.version + 1')
  api -X POST "$A/v1/layout/apply" -d "{\"version\":$VER}" >/dev/null
fi

BID=$(api "$A/v1/bucket?globalAlias=$BUCKET" 2>/dev/null | jq -r '.id' || true)
if [ -z "$BID" ] || [ "$BID" = null ]; then
  BID=$(api -X POST "$A/v1/bucket" -d "{\"globalAlias\":\"$BUCKET\"}" | jq -r '.id')
fi
if ! api "$A/v1/key?id=$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  api -X POST "$A/v1/key/import" -d "{\"accessKeyId\":\"$S3_ACCESS_KEY_ID\",\"secretAccessKey\":\"$S3_SECRET_ACCESS_KEY\",\"name\":\"midday\"}" >/dev/null
fi
api -X POST "$A/v1/bucket/allow" -d "{\"bucketId\":\"$BID\",\"accessKeyId\":\"$S3_ACCESS_KEY_ID\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":true}}" >/dev/null
echo "garage ready: bucket=$BUCKET"
