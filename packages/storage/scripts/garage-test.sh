#!/bin/sh
# Start a throwaway Garage (S3-compatible) container for the s3 driver tests
# and print the env to point the driver at it.
#   sh scripts/garage-test.sh [name] [port]
set -e
NAME=${1:-midday-garage}
PORT=${2:-3900}
CONF=$(mktemp -d)/garage.toml
cat >"$CONF" <<TOML
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "$(openssl rand -hex 32)"
[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"
[admin]
api_bind_addr = "[::]:3903"
TOML
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "$PORT:3900" -v "$CONF:/etc/garage.toml" dxflrs/garage:v1.1.0 >/dev/null
g() { docker exec "$NAME" /garage "$@"; }
for _ in $(seq 1 30); do g status >/dev/null 2>&1 && break; sleep 1; done
NODE=$(g node id -q | cut -d@ -f1)
g layout assign -z dc1 -c 1G "$NODE" >/dev/null
g layout apply --version 1 >/dev/null
g bucket create midday >/dev/null
KEY=$(g key create midday-key)
ID=$(echo "$KEY" | awk '/Key ID/ {print $3}')
SECRET=$(echo "$KEY" | awk '/Secret key/ {print $3}')
g bucket allow --read --write --owner midday --key midday-key >/dev/null
echo "S3_ENDPOINT=http://localhost:$PORT"
echo "S3_REGION=garage"
echo "S3_BUCKET=midday"
echo "S3_ACCESS_KEY_ID=$ID"
echo "S3_SECRET_ACCESS_KEY=$SECRET"
echo "S3_FORCE_PATH_STYLE=true"
