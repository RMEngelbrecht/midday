# Self-hosting Midday with Docker Compose

Requirements: Docker with Compose v2, a host with 2 GB RAM or more, and two DNS
records (`app.<domain>` and `api.<domain>`) pointing at it for a public install.

## Quickstart

```sh
git clone <this repo> && cd midday/deploy
cp .env.example .env
./generate-secrets.sh          # fills the empty secrets, safe to re-run
$EDITOR .env                   # set DOMAIN, APP_URL, API_URL
docker compose up -d           # pulls images from GHCR; use `build` to build locally
```

Open `APP_URL` and sign up. With the default `ALLOW_SIGNUP=first-user` the first
account can register, after that only invited emails can.

Caddy serves `app.$DOMAIN` (dashboard) and `api.$DOMAIN` (API, including the
`/realtime` event stream, which is not buffered) and obtains Let's Encrypt
certificates automatically. The two hosts must share a parent domain.

**Local trial without DNS:** in `.env` set `DOMAIN=lvh.me`, `CADDY_SCHEME=http://`,
`HTTP_PORT=8080`, `APP_URL=http://app.lvh.me:8080`, `API_URL=http://api.lvh.me:8080`.
`lvh.me` and its subdomains resolve to 127.0.0.1 and share a parent domain, so the
session cookie reaches both hosts (Caddy on plain HTTP; no TLS). Do not use
`app.localhost` + `api.localhost`: browsers treat those as different sites and the
dashboard never sees the session cookie.

Full guide, provider setup and backups: [`../docs/self-hosting.md`](../docs/self-hosting.md).

To build the images instead of pulling: `docker compose build`.

## Profiles

| Profile | Adds | Configure in `.env` |
|---|---|---|
| `dev` | Mailpit (SMTP sink, UI on `localhost:8025`) | `SMTP_URL=smtp://mailpit:1025` |
| `s3` | Garage S3 store, bucket and key created on start | `STORAGE_DRIVER=s3`, `S3_ENDPOINT=http://garage:3900`, `S3_REGION=garage`, `S3_BUCKET=midday`, `S3_FORCE_PATH_STYLE=true` |
| `ai` | Ollama | `AI_PROVIDER=openai-compatible`, `AI_BASE_URL=http://ollama:11434/v1`, `AI_MODEL_CHAT`, `AI_MODEL_VISION`, `AI_EMBEDDING_PROVIDER=openai-compatible`, `AI_EMBEDDING_BASE_URL=http://ollama:11434/v1`, `AI_EMBEDDING_MODEL=nomic-embed-text` |

```sh
docker compose --profile dev --profile s3 --profile ai up -d
docker compose exec ollama ollama pull nomic-embed-text
docker compose exec ollama ollama pull qwen2.5vl:7b   # any vision-capable model
```

Without `SMTP_URL` emails are written to the api/worker logs. Every key is
documented in the root `.env.schema`; `.env.example` lists the common ones.

## Data and backups

State lives in named volumes: `postgres-data`, `storage-data` (uploaded files,
local driver; shared by api and worker), `valkey-data` (queues, rebuildable),
and `garage-*` when using the `s3` profile.

```sh
# database
docker compose exec -T postgres pg_dump -U midday -Fc midday > midday-$(date +%F).dump
# restore into a fresh stack
docker compose exec -T postgres pg_restore -U midday -d midday --clean --if-exists < midday-DATE.dump

# files (local driver)
docker run --rm -v midday_storage-data:/data -v "$PWD":/out alpine tar czf /out/storage-$(date +%F).tgz -C /data .
```

Volume names are prefixed with the compose project name (`midday` by default).
Keep a copy of `.env`: losing `MIDDAY_ENCRYPTION_KEY` makes stored bank/OAuth
tokens unreadable. With an external S3 store, back it up with your provider's tools.

## Upgrading

```sh
# optionally pin MIDDAY_VERSION=1.2.3 in .env
docker compose pull && docker compose up -d
```

The one-shot `migrate` service runs pending database migrations before `api` and
`worker` start. Take a `pg_dump` first.

## Operations

- `docker compose ps` shows health; `docker compose logs -f api worker`.
- API health: `https://api.$DOMAIN/health`; dependencies: `/health/dependencies`.
