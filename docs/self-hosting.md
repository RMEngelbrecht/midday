# Self-hosting Midday

Midday is sunset as a hosted product; this fork is meant to be run by you. One box, `docker compose up`, and every external service is switched on by setting its environment variables.

What you get with no configuration at all: email + password login, local file storage, manual accounts and statement import, invoices, inbox, vault, export, time tracking. Mail is written to the logs, and AI is off.

- [Quickstart](#quickstart)
- [Requirements](#requirements)
- [URLs and cookies](#urls-and-cookies)
- [Configuration](#configuration)
- [Optional services](#optional-services): [mail](#outbound-email-smtp), [inbound email](#inbound-email), [storage](#file-storage-local-or-s3), [AI](#ai), [bank data](#bank-data), [OAuth integrations](#oauth-integrations), [sign-up and instance admins](#sign-up-and-instance-admins), [social sign-in](#social-sign-in)
- [Desktop app and CLI](#desktop-app-and-cli)
- [Backups](#backups) and [upgrades](#upgrades)
- [Verifying a deployment](#verifying-a-deployment) (the Playwright suite)
- [Known limits](#known-limits)

## Quickstart

```sh
git clone https://github.com/<you>/midday && cd midday/deploy
cp .env.example .env
./generate-secrets.sh        # fills the empty secrets; safe to re-run
$EDITOR .env                 # set DOMAIN, APP_URL, API_URL
docker compose up -d         # pulls ghcr.io/<MIDDAY_OWNER>/midday-* images
```

Open `APP_URL` and choose **New here? Create an account**. With the default `ALLOW_SIGNUP=first-user` the first account can register and create the team; after that only invited or allowlisted people can sign up (see [Sign-up and instance admins](#sign-up-and-instance-admins)).

To build the images yourself instead of pulling them: `docker compose up -d --build`.

**Try it on your laptop (no DNS, no TLS).** The two hosts must share a parent domain (see below), so use a name that resolves to 127.0.0.1, for example `lvh.me`:

```sh
DOMAIN=lvh.me
CADDY_SCHEME=http://
HTTP_PORT=8080
APP_URL=http://app.lvh.me:8080
API_URL=http://api.lvh.me:8080
```

`app.localhost` plus `api.localhost` does **not** work: browsers treat those as separate sites and refuse a cookie shared between them, so the dashboard never sees your session. The API logs a warning when it detects this.

### Images and the GHCR owner

`compose.yaml` pulls `ghcr.io/${MIDDAY_OWNER}/midday-{api,worker,dashboard}:${MIDDAY_VERSION}`. The release workflow (`.github/workflows/release.yml`, tags `v*`) pushes them to the GitHub owner that runs it, lower-cased. Set `MIDDAY_OWNER` in `.env` to that owner (`midday-app` is a placeholder), and `MIDDAY_VERSION` to a release tag such as `1.2.3` instead of `latest` for pinned upgrades. Make the packages public, or `docker login ghcr.io` on the server.

## Requirements

- Docker with Compose v2; 2 GB RAM or more (4 GB with the `ai` profile and a small model; see [AI](#ai)).
- For a public install: two DNS records, `app.<domain>` and `api.<domain>`, pointing at the host, and ports 80 and 443 open. Caddy obtains Let's Encrypt certificates automatically.
- **`APP_URL` and `API_URL` must share a parent domain or be on the same host.** See the next section.

## URLs and cookies

The API is the auth server (better-auth at `API_URL/auth/*`). It sets the session cookie, and the dashboard's server reads that cookie to decide whether you are signed in, so the cookie has to be visible to both hosts.

| Setup | What happens |
|---|---|
| `app.example.com` + `api.example.com` | The API sets the cookie on `example.com`, derived from the two URLs. Nothing to configure. |
| Both on one host (`localhost:3001` + `localhost:3003`, or one reverse-proxy origin) | Host-only cookie; cookies ignore ports. |
| Multi-label public suffix (`app.example.co.uk`) | Set `AUTH_COOKIE_DOMAIN=example.co.uk`. |
| Unrelated domains (`midday.acme.dev` + `api.other.io`) | Not supported for the dashboard. Put both behind one parent domain. |
| `app.localhost` + `api.localhost` | Not supported (see above). Use `lvh.me` or a real domain. |

The desktop app and the CLI do not use cookies; they authenticate with bearer tokens against `API_URL`.

If you terminate TLS elsewhere, drop the Caddy service and route `app.<domain>` to `dashboard:3000` and `api.<domain>` to `api:8080`. Disable response buffering for the API: `/realtime` is a server-sent-events stream.

## Configuration

Everything lives in `deploy/.env`, which Compose hands to every service. The complete, generated list of settings (type, default, whether it is secret) is in **[env-reference.md](./env-reference.md)**. It is produced from the Varlock `.env.schema` files that the apps validate at startup, so it cannot drift from the code:

```sh
bun run docs:env         # regenerate docs/env-reference.md
bun run docs:env:check   # what CI runs
```

Optional services follow one rule: they turn on when their keys are present, and the UI hides what is off.

## Optional services

### Outbound email (SMTP)

With no `SMTP_URL`, sign-in codes, invitations and invoices are only written to the api/worker logs (`docker compose logs api worker`). Any SMTP server works:

| Provider | `SMTP_URL` |
|---|---|
| Resend | `smtps://resend:re_xxxxxxxx@smtp.resend.com:465` |
| Postmark | `smtp://<server-token>:<server-token>@smtp.postmarkapp.com:587` |
| Amazon SES | `smtp://<smtp-user>:<smtp-pass>@email-smtp.<region>.amazonaws.com:587` |
| Mailgun | `smtp://postmaster@mg.example.com:<password>@smtp.mailgun.org:587` |

`smtps://` is implicit TLS (port 465), `smtp://` is STARTTLS (587). URL-encode special characters in the password. Set `MAIL_FROM="Midday <noreply@example.com>"` and verify that sender domain with your provider (SPF/DKIM), otherwise invoices land in spam.

For local testing run the `dev` profile (`docker compose --profile dev up -d`) with `SMTP_URL=smtp://mailpit:1025`; the inbox UI is on `http://localhost:8025`.

### Inbound email

Teams can forward receipts to a per-team address, `<inboxId>@INBOX_EMAIL_DOMAIN`. Two ways to receive them:

- **IMAP polling** (simplest). Point `IMAP_URL=imaps://user:pass@imap.example.com:993` at one mailbox that receives mail for the domain. The worker polls every `IMAP_POLL_INTERVAL` minutes and matches each message to a team by recipient (`To`, `Delivered-To`, `X-Original-To`). With a single shared mailbox set `INBOX_EMAIL_LOCAL_PART` to use plus-addressing (`receipts+<inboxId>@domain`). `IMAP_PROCESSED_MAILBOX` moves handled mail out of the way.
- **Postmark inbound webhook.** Add an inbound stream in Postmark with the webhook `https://<user>:<password>@api.example.com/webhooks/inbox`, and set `INBOX_WEBHOOK_USERNAME` / `INBOX_WEBHOOK_PASSWORD` to the same credentials. Without both, the endpoint is open to Postmark's IP range only.

Set `INBOX_EMAIL_DOMAIN` either way; the forwarding address is hidden in the UI until inbound mail is configured.

### File storage (local or S3)

The default is a Docker volume (`storage-data`), shared by the API and worker. For S3-compatible storage set `STORAGE_DRIVER=s3` (inferred when `S3_BUCKET` is set) plus:

| Store | Settings |
|---|---|
| Bundled Garage (`--profile s3`) | `S3_ENDPOINT=http://garage:3900`, `S3_REGION=garage`, `S3_BUCKET=midday`, `S3_FORCE_PATH_STYLE=true`. Keys are generated by `generate-secrets.sh`; the `garage-init` job creates the bucket. |
| Cloudflare R2 | `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto`, bucket and API token keys. Optionally `S3_PUBLIC_URL` for a custom domain serving public objects. |
| AWS S3 | Leave `S3_ENDPOINT` empty, set `S3_REGION`, `S3_BUCKET` and an IAM key limited to the bucket. |
| MinIO | `S3_ENDPOINT=http://minio:9000`, `S3_FORCE_PATH_STYLE=true`. |

Buckets (`vault`, `avatars`, `apps`, `institutions`) are key prefixes inside the one bucket. Private files are always served through the API (or presigned URLs when `S3_PUBLIC_ENDPOINT` is a browser-reachable address). `STORAGE_MAX_UPLOAD_MB` caps uploads.

Switching drivers does not move existing files; copy them across (`rclone` works for both) before switching.

### AI

AI is optional. Without it chat, insights, natural-language search, AI categorisation and document extraction are off and hidden; everything else works. Configure it with `AI_PROVIDER` (`openai`, `openai-compatible`, `google`, `anthropic`, `mistral`), `AI_API_KEY` and the `AI_MODEL_*` roles. Details, embedding rules (768 dimensions) and the Ollama setup are in **[ai.md](./ai.md)**.

- **OpenAI or another hosted provider:** `AI_PROVIDER=openai`, `AI_API_KEY=...`.
- **Local models with Ollama:** `docker compose --profile ai up -d`, pull a chat/vision model and `nomic-embed-text`, and set `AI_PROVIDER=openai-compatible`, `AI_BASE_URL=http://ollama:11434/v1`. See [ai.md](./ai.md).
- **Hardware:** Ollama inside Docker on a machine without a GPU runs on the CPU, which is far too slow for receipt and invoice extraction (minutes per page for a vision model); timeouts are lengthened 15x for `openai-compatible`, but expect to wait. Docker Desktop on macOS cannot reach the GPU at all. Either run Ollama natively on the host and point `AI_BASE_URL` at `http://host.docker.internal:11434/v1` (Linux: add `extra_hosts: ["host.docker.internal:host-gateway"]` to `api` and `worker`), use an NVIDIA GPU with the container toolkit, or use a hosted provider.

### Bank data

No bank-data aggregator can be self-hosted: pulling live bank data takes a licensed intermediary. **Every provider except SimpleFIN needs your own developer account and keys.** Cheapest first:

| Option | Region | Cost | Setup |
|---|---|---|---|
| **Statement import** (OFX/QFX, CAMT.053, MT940, QIF, CSV) | any | free | Nothing to configure. Transactions, then Import. |
| **SimpleFIN Bridge** | US, Canada | about $15 to 25 per year, billed by SimpleFIN | `SIMPLEFIN_ENABLED=true`. Each user pastes a setup token from their SimpleFIN account; no developer account. |
| **Enable Banking** | EU, UK | restricted production mode is free for linking your **own** accounts, non-commercial only; companies need a commercial contract | Create an application at enablebanking.com, then set `ENABLEBANKING_APPLICATION_ID` and `ENABLE_BANKING_KEY_CONTENT` (the PEM private key). Register `APP_URL/api/enablebanking/session` as the redirect URL. |
| **Plaid** | US, Canada | the free Trial plan allows 10 production Items | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENVIRONMENT` (`sandbox`, `development`, `production`). Webhook: `API_URL/webhooks/plaid`. |
| **Teller** | US | a free development tier with a small number of live enrollments (check current limits) | `TELLER_APPLICATION_ID`, `TELLER_ENVIRONMENT`, `TELLER_CERT_BASE64`, `TELLER_KEY_BASE64`, `TELLER_SIGNING_SECRET`. Webhook: `API_URL/webhooks/teller`. |

Providers appear in the "Connect bank" dialog only when configured. Exchange rates come from the free jsDelivr currency dataset (`EXCHANGE_RATES_URL` to mirror it) and are cached in the database.

### OAuth integrations

Gmail, Outlook, Xero, QuickBooks, Fortnox and Slack each need an OAuth app registered by you with that vendor. Set the client id and secret, and register the redirect URL under `API_URL`:

| Integration | Keys | Redirect URL to register | Env for the redirect |
|---|---|---|---|
| Gmail | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | `API_URL/apps/gmail/oauth-callback` | `GMAIL_REDIRECT_URI` |
| Outlook | `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET` | `API_URL/apps/outlook/oauth-callback` | `OUTLOOK_REDIRECT_URI` |
| Xero | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | `API_URL/apps/xero/oauth-callback` | `XERO_OAUTH_REDIRECT_URL` |
| QuickBooks | `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` | `API_URL/apps/quickbooks/oauth-callback` | `QUICKBOOKS_OAUTH_REDIRECT_URL` |
| Fortnox | `FORTNOX_CLIENT_ID`, `FORTNOX_CLIENT_SECRET` | `API_URL/apps/fortnox/oauth-callback` | `FORTNOX_OAUTH_REDIRECT_URL` |
| Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `SLACK_STATE_SECRET` | `API_URL/apps/slack/oauth-callback`; events `API_URL/apps/slack/webhook`; interactivity `API_URL/apps/slack/interactions` | `SLACK_OAUTH_REDIRECT_URL` |

Set each redirect env var to exactly the URL you registered. Gmail and Outlook add the "Connect Gmail/Outlook" buttons to the inbox; the others appear under Apps. Stripe (invoice payments), WhatsApp, Telegram and Sendblue are configured the same way; see [env-reference.md](./env-reference.md).

### Sign-up and instance admins

`ALLOW_SIGNUP` decides who may create an account:

| Value | Who can sign up |
|---|---|
| `first-user` (default) | The first account, then invited or allowlisted emails |
| `invite-only` | Only invited or allowlisted emails, including the first account |
| `open` | Anyone who can reach `APP_URL` |

The check covers every way an account gets created: email + password, email codes and social sign-in.

There are two kinds of invite:

- **Team invite** (Settings > Members). The invitee signs up and joins your team.
- **Instance invite** (Settings > Instance, admins only). The invitee signs up and creates their **own** team; they see nothing of yours. The email links to `APP_URL/login?email=...`, which opens the sign-up form with the address filled in. The invite is used up when they sign up; revoking it before then blocks the sign-up again.

`SIGNUP_ALLOWED_EMAILS` lets people sign up without an invite, for example everyone at your company: `SIGNUP_ALLOWED_EMAILS=@example.com, friend@other.org`. Entries are comma-separated, case-insensitive, and `@example.com` does not cover `sub.example.com`. Allowlisted people also create their own team.

**Instance admins** are the first account ever created plus everyone in `ADMIN_EMAILS` (same format; these addresses may always sign up). Admins see Settings > Instance. Admin status is computed from these two rules on every request, so changing `ADMIN_EMAILS` takes effect after a restart; there is no role stored in the database.

### Social sign-in

Email + password always works, with optional email codes and TOTP. To add Google, GitHub, Apple or Microsoft set `AUTH_<PROVIDER>_CLIENT_ID` and `_CLIENT_SECRET` and register `API_URL/auth/callback/<provider>` as the redirect URL.

## Desktop app and CLI

Neither is tied to a hosted service. Both discover your instance from the dashboard URL: `GET APP_URL/api/instance` returns `{ appUrl, apiUrl, desktopScheme, version }`.

- **Desktop (Tauri).** On first launch enter your `APP_URL`. Login returns through the deep link `<scheme>://...`; the scheme is fixed when the app is built (default `midday`), and **`DESKTOP_SCHEME` on the server must equal it** (for example `midday-dev` for the dev build). Set `DESKTOP_RELEASES_URL` to your fork's GitHub releases page and the dashboard shows a download card in the Apps page. Auto-update is off unless you configure it; see `apps/desktop/README.md`.
- **CLI.** `midday auth login --server https://app.example.com` discovers and stores the API URL; or set `MIDDAY_API_URL=https://api.example.com` (and `MIDDAY_DASHBOARD_URL` if the dashboard is not at the `app.` counterpart). API keys work too: `MIDDAY_API_KEY`.

## Backups

State lives in named volumes: `postgres-data`, `storage-data` (uploads, local driver), `valkey-data` (queues; rebuildable), and `garage-*` with the `s3` profile.

```sh
# database
docker compose exec -T postgres pg_dump -U midday -Fc midday > midday-$(date +%F).dump
# restore into a fresh stack
docker compose exec -T postgres pg_restore -U midday -d midday --clean --if-exists < midday-DATE.dump

# uploaded files (local driver; volume name is prefixed by the compose project)
docker run --rm -v midday_storage-data:/data -v "$PWD":/out alpine \
  tar czf /out/storage-$(date +%F).tgz -C /data .
```

With an external S3 store use your provider's tooling. **Keep a copy of `.env`**: without `MIDDAY_ENCRYPTION_KEY` the stored bank and OAuth tokens cannot be decrypted, and without `AUTH_SECRET` every session and TOTP secret is invalidated.

## Upgrades

```sh
# optionally pin MIDDAY_VERSION=1.2.3 in .env first
docker compose pull && docker compose up -d
```

The one-shot `migrate` service applies pending database migrations (advisory-locked, idempotent) before `api` and `worker` start. Take a `pg_dump` first. Roll back by restoring the dump and the previous `MIDDAY_VERSION`.

## Verifying a deployment

`e2e/` holds a Playwright smoke suite that drives a running stack in a real browser: sign-up and team creation, a manual account via CSV and OFX import, a receipt uploaded to the inbox and showing up in a second tab without a reload (realtime), manual matching, creating and sending an invoice (and, with the `dev` profile, finding the email in Mailpit), opening the public invoice link, the vault, a data export and TOTP enrolment plus a re-login.

```sh
cd e2e && bunx playwright install chromium
E2E_APP_URL=http://app.lvh.me:8080 E2E_API_URL=http://api.lvh.me:8080 \
E2E_MAILPIT_URL=http://localhost:8025 bun run e2e      # Mailpit URL is optional
```

It expects a fresh stack (the first account is created by the suite) or the credentials in `E2E_EMAIL` / `E2E_PASSWORD`. In CI it runs nightly and on demand (`.github/workflows/e2e.yml`), not on every pull request.

## Known limits

- The bundled Caddy serves HTTP-01 certificates; wildcard certificates or private CAs need your own proxy.
- Bank data providers other than statement import need accounts you create and, for commercial use, contracts with those vendors.
