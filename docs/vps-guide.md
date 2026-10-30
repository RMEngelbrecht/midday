# Running Midday on a VPS: email forwarding, WhatsApp, AI and EU bank sync

This guide takes you from an empty Ubuntu or Debian VPS to Midday on your own domain. GitHub builds the images and the VPS only pulls and runs them. It also covers real email, the AI assistant, forwarding receipts by email, the WhatsApp assistant, and automatic bank sync.

For the reference material (every environment variable, the optional services, backups), see [self-hosting.md](./self-hosting.md) and [env-reference.md](./env-reference.md).

**Examples below use** `midday.rme.gg` for the dashboard and `api.midday.rme.gg` for the API. `<you>` is your GitHub username.

> **Tested so far:** the deploy-only stack and this hostname layout (login, images), SMTP and IMAP against local test servers. **Not yet run for real:** the GitHub release workflow, WhatsApp against Meta, a hosted AI provider, and a live Enable Banking connection. Sections 4, 8, 10 and 7 are where to look first if something misbehaves.

## 1. Prerequisites

- **A VPS** running Ubuntu 22.04+ or Debian 12+ with at least **2 GB of RAM**. Nothing is built on it. Images default to amd64; see section 4 for ARM servers.
- **A domain** where you can create DNS records.
- **A GitHub account.** Actions builds the images.
- **An email sending provider** (step 5.2) and a **mailbox for forwarded receipts** (section 9).
- **An AI provider key** (section 8). Email forwarding and WhatsApp both need one.

## 2. DNS

Create two records that point at the VPS's public IP:

| Type | Name | Value |
|---|---|---|
| A | `midday` | `<VPS IPv4>` |
| A | `api.midday` | `<VPS IPv4>` |

If your VPS has IPv6, add matching AAAA records too.

The dashboard and API **must share a parent domain**, because the login cookie is shared between them. Here the cookie is set on `midday.rme.gg`, which covers both hosts.

**If your DNS is on Cloudflare,** set both records to **DNS only** (grey cloud). Caddy gets its own certificates, and Cloudflare's free certificate doesn't cover two-level names like `api.midday.rme.gg`.

Wait until `dig +short api.midday.rme.gg` returns your IP before starting the stack.

## 3. Prepare the server

SSH in as a sudo user, then install Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER && newgrp docker
```

Open the firewall for SSH, HTTP and HTTPS:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw enable
```

## 4. Build the images on GitHub

**On your Mac,** create an empty **private** GitHub repository, then push the fork. The original project stays as the `upstream` remote.

```bash
jj git remote add origin git@github.com:<you>/midday.git
```

```bash
jj git push --bookmark main --remote origin
```

Then tag a release, which starts the build (`.github/workflows/release.yml`):

```bash
jj tag set v0.1.0 -r main
```

```bash
git push origin v0.1.0
```

Watch it under the repository's **Actions** tab. It publishes `ghcr.io/<you>/midday-api`, `-worker` and `-dashboard`. You can also start it by hand with **Run workflow** on that page, which is useful for rebuilding without a new version.

**ARM server (Hetzner CAX, Oracle Ampere)?** Before tagging, set the repository variable `IMAGE_PLATFORMS` to `linux/arm64` under Settings → Secrets and variables → Actions → Variables. ARM builds run under emulation and take much longer. Private repositories use your Actions minutes, so a public repository or an amd64 server keeps this free.

**On the VPS,** the images are private by default, so log in once. Create a classic GitHub token with only the `read:packages` scope, then:

```bash
docker login ghcr.io -u <you>
```

**Copy the deploy folder to the VPS.** It's the only part of the repo the server needs. From your Mac, inside the repo:

```bash
rsync -av --exclude .env deploy/ <vps>:~/midday/
```

Then on the VPS:

```bash
cd ~/midday && cp .env.example .env
```

## 5. Configure `.env`

Open `~/midday/deploy/.env` and set the following.

### 5.1 Domain and images

Keep `CADDY_SCHEME` empty, so Caddy serves HTTPS and fetches certificates automatically. The URLs **must** start with `https://`. Remove the `DOMAIN=` line: it's only for the default `app.`/`api.` naming.

```
APP_HOST=midday.rme.gg
API_HOST=api.midday.rme.gg
APP_URL=https://midday.rme.gg
API_URL=https://api.midday.rme.gg
CADDY_SCHEME=
HTTP_PORT=80
HTTPS_PORT=443
MIDDAY_OWNER=<you>
MIDDAY_VERSION=0.1.0
```

`MIDDAY_OWNER` must be lowercase, and `MIDDAY_VERSION` has no leading `v`.

### 5.2 Email (outgoing)

Midday sends sign-in codes, team invites, invoices and notifications. Without `SMTP_URL`, these only appear in the API logs. Every major provider supports SMTP, so you only set one URL.

| Provider | `SMTP_URL` | Notes |
|---|---|---|
| Resend | `smtps://resend:<API_KEY>@smtp.resend.com:465` | Free tier available. Easiest to set up. |
| Postmark | `smtp://<SERVER_TOKEN>:<SERVER_TOKEN>@smtp.postmarkapp.com:587` | Very good deliverability. |
| Amazon SES | `smtp://<SMTP_USER>:<SMTP_PASS>@email-smtp.<region>.amazonaws.com:587` | Cheapest at volume. |
| Mailgun / Brevo / your own server | `smtp://user:pass@host:587` | Any SMTP server works. |

If the password contains special characters (`@ : / ? #`), URL-encode them. For example, `@` becomes `%40`.

Then:

1. In your provider's dashboard, **verify your sending domain**. That means adding the SPF and DKIM DNS records they show you, and ideally DMARC as well. Without this, mail lands in spam.
2. Set the sender address. It must be on the verified domain.

```
SMTP_URL=smtps://resend:re_xxxxxxxx@smtp.resend.com:465
MAIL_FROM="Midday <noreply@rme.gg>"
```

### 5.3 Sign-up policy

By default (`first-user`), only the very first account can sign up, and that account becomes the owner. Everyone after that needs an invite. Leave it like this. Section 12 explains how to add people.

## 6. Start it

```bash
./generate-secrets.sh
```

```bash
docker compose pull
```

```bash
docker compose up -d --no-build
```

`--no-build` makes sure the server runs the images from GitHub and never tries to build. Check the services:

```bash
docker compose ps
```

All services should be `healthy`, apart from Caddy, which has no health check. The `migrate` job runs and exits, so it won't stay listed.

```bash
curl -s https://api.midday.rme.gg/health
```

This should return `{"status":"ok"}`.

**Sign up straight away** at `https://midday.rme.gg`. The first account becomes the owner and instance admin.

To test email, sign out and sign in with an email code. If it doesn't arrive, read the API log:

```bash
docker compose logs --tail 100 api | grep -i -E "smtp|mail"
```

## 7. Bank sync in the EU: Enable Banking

### What's available

| Option | Cost | Who it's for |
|---|---|---|
| **GoCardless Bank Account Data** (formerly Nordigen) | Stopped accepting new sign-ups in July 2025 | Removed from this fork. |
| **Enable Banking, restricted mode** | **Free** | Your **own personal** accounts, non-commercial use. |
| **Enable Banking, full production** | Paid: volume-based, needs a contract, minimum monthly fee | Companies and business accounts, or linking other people's accounts. |
| **Statement import** (CAMT.053, MT940, CSV, OFX) | Free | Everyone, any bank. No automatic sync. |

**Restricted mode is the free path.** You activate your Enable Banking application by linking your own bank accounts in their Control Panel, and the API then only ever returns those accounts. Their terms limit it to individual, non-commercial use. It must not be used for business accounts or for accounts that aren't yours.

**If Midday is for a company's business accounts,** you need a commercial contract with Enable Banking (contact sales@enablebanking.com for pricing). The alternative is statement import: most EU business banks export **CAMT.053** or **MT940**, and Midday imports both, skipping duplicates when you re-import. A monthly export and import works well for bookkeeping.

Read Enable Banking's current terms yourself before relying on restricted mode. This guide is not legal advice.

### 7.1 Create the application

1. Create an account at [enablebanking.com](https://enablebanking.com) and open the **Control Panel**, then **Applications** (`https://enablebanking.com/cp/applications`).
2. Click **Add a new application**:
   - **Environment:** *Production*. Pick *Sandbox* first instead if you want to try it with fake banks.
   - **Private key:** keep the default, "generated in the browser". Your browser downloads a file named `<application-id>.pem`. **Keep it safe.** It is the only copy of the key.
   - **Application name:** anything you like, e.g. "Midday (personal)". It is shown on the bank's consent screen.
   - **Redirect URL:** `https://midday.rme.gg/api/enablebanking/session`
3. The app now shows as **Inactive**. Click **Activate by linking accounts**, log in to your bank, and approve. Repeat for each bank you use. Only the accounts you link here will ever be visible to Midday.

### 7.2 Configure Midday

Midday expects the key **base64-encoded on a single line**, not the raw PEM. On your Mac:

```bash
base64 -i ~/Downloads/<application-id>.pem | tr -d '\n' | pbcopy
```

Paste it into the VPS `.env`:

```
ENABLEBANKING_APPLICATION_ID=<application-id>
ENABLE_BANKING_KEY_CONTENT=<paste the base64 string>
```

You normally don't need `ENABLEBANKING_REDIRECT_URL`. It defaults to `APP_URL/api/enablebanking/session`, which must match the redirect URL you registered in step 7.1.

Apply the change:

```bash
docker compose up -d
```

The worker refreshes the list of banks when it starts, and again every night. Wait about a minute, then in Midday go to **Connect bank**, search for your bank, and authorise it. Your accounts and transactions sync automatically from then on.

### 7.3 Things to know

- **Consent expires.** Banks typically grant 180 days, under the EU's PSD2 rules. When it expires, Midday marks the connection as needing reconnection. Click **Reconnect** and authorise again.
- **New accounts aren't picked up automatically.** If you open a new account at your bank, link it in the Enable Banking Control Panel too, then reconnect in Midday.
- **SimpleFIN** (US/Canada, about $15–25 a year) and **Plaid** or **Teller** (US) are also supported. See [self-hosting.md](./self-hosting.md).

## 8. AI assistant

Forwarded receipts need AI to read vendor, amount and date, and the WhatsApp assistant is AI. So you need this for both of your main features.

### What the app needs

| Job | Needs | Setting |
|---|---|---|
| Assistant (web and WhatsApp) | Reliable **tool calling** | `AI_MODEL_CHAT` |
| Categorising, titles, search filters | Cheap and fast | `AI_MODEL_FAST` |
| Reading receipts and invoices | **Vision**, ideally PDF input | `AI_MODEL_VISION` |
| Category and tag matching | Embeddings with exactly **768 dimensions** | `AI_EMBEDDING_*` |

### Options

Prices are per million tokens (input / output), from third-party listings in October 2026. Check the provider's own page.

| Option | Rough price | PDF receipts | 768-dim embeddings | Notes |
|---|---|---|---|---|
| **Gemini, paid tier** (recommended) | Flash-Lite ~$0.10 / $0.40 | Native | Yes, one key | Everything on one key. |
| **OpenAI** | gpt-4o-mini ~$0.15 / $0.60; gpt-4.1-mini ~$0.40 / $1.60 | Native | Yes, ~$0.02 | Well-trodden tool calling. Costs a bit more. |
| **OpenRouter with Chinese models** | Qwen ~$0.09 / $0.10 up to Kimi ~$0.65 / $3.41, GLM ~$1.05 / $3.50, DeepSeek V4 Pro ~$1.30 / $2.60 | Text layer only | Use another provider | Only the small Qwen is cheaper than Flash-Lite. |
| **Ollama on the VPS** | Server cost | Text layer only | Yes (`nomic-embed-text`) | Not practical. A receipt took minutes on a CPU, and full extraction timed out. Needs a GPU. |

**Gemini's free tier:** Google may use free-tier content to improve its products, and rate limits are low. Don't send financial documents through it. Enable billing, which opts you out.

### OpenRouter and Chinese models

They're worth it only if you specifically want those models. For this app, they aren't a clear saving:

- **Most aren't cheaper.** The capable ones cost more than Gemini Flash-Lite. Only the small Qwen beats it, and tool calling quality matters more than a few cents here.
- **PDF handling is weaker.** The app sends OpenRouter-style endpoints the PDF's text, not the file. Scanned or image-only PDFs won't be read. Forwarded e-receipts usually have a text layer; scans don't.
- **Embeddings need a second provider,** because the model must return exactly 768 dimensions.
- **Privacy depends on the host.** This is your financial data. DeepSeek's own API reportedly trains on inputs unless you opt out. In OpenRouter's privacy settings, turn on Zero Data Retention and block training. Open-weight models can then run on non-Chinese hosts.

If you want to try it:

```
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=<openrouter key>
AI_MODEL_CHAT=<model id with tool support>
AI_MODEL_FAST=<cheap model id>
AI_MODEL_VISION=<model id with vision support>
AI_EMBEDDING_PROVIDER=google
AI_EMBEDDING_API_KEY=<gemini key>
```

### Recommended setup: Gemini

Create a key in Google AI Studio, enable billing, and set:

```
AI_PROVIDER=google
AI_API_KEY=<gemini key>
AI_MODEL_CHAT=gemini-2.5-flash
AI_MODEL_FAST=gemini-2.5-flash-lite
AI_MODEL_VISION=gemini-2.5-flash-lite
```

As a rough estimate, a receipt of about 5,000 tokens in and 500 out costs under $0.001 on Flash-Lite. Check that these model names are still current, then apply with `docker compose up -d --no-build`. More detail is in [ai.md](./ai.md).

## 9. Email forwarding (receipts into Inbox)

Each team gets a forwarding address, and whatever arrives there becomes an Inbox item that gets read and matched to transactions. The simplest setup needs **one ordinary mailbox** that supports plus-addressing, such as Google Workspace, Gmail, Fastmail or Migadu.

1. Create the mailbox, e.g. `inbox@rme.gg`, and enable IMAP. Use an app password if the provider offers them.
2. Add this to `.env`. In the URL, write `@` in the username as `%40`:

   ```
   IMAP_URL=imaps://inbox%40rme.gg:<app-password>@imap.yourprovider.com:993
   INBOX_EMAIL_DOMAIN=rme.gg
   INBOX_EMAIL_LOCAL_PART=inbox
   ```

3. Apply it with `docker compose up -d --no-build`.
4. Your forwarding address now appears in the Inbox settings, as `inbox+<team-id>@rme.gg`. The worker checks the mailbox every 5 minutes (`IMAP_POLL_INTERVAL`).

Then forward a receipt with a PDF attached and watch it appear in Inbox.

**Good to know:**
- **Use a dedicated mailbox.** The poller reads every unread message and marks it read.
- **Automatic forwarding from Gmail:** Gmail sends a confirmation message to the address first. Midday relays it to your team's email address, so SMTP (step 5.2) has to work. Open the link to confirm.
- **Sender:** messages are matched to a team by recipient, so anyone who knows the address can add items to your Inbox. Treat the address as private.

## 10. WhatsApp assistant

This lets you message the assistant and send receipt photos from WhatsApp. It uses Meta's WhatsApp Cloud API, and it needs section 8.

**Before you start, know the two catches:**

- **Meta's policy.** Since January 2026, Meta's business terms ban general-purpose AI chatbots on this API. Assistants tied to a specific business purpose are allowed, and a finance assistant for your own company fits that better than a personal general chatbot, but it's Meta's call and could get a number restricted.
- **Cost.** Since 1 October 2026, replies are reportedly billed at the utility rate after 1,000 free service messages per number per month. Personal use should fit inside that. Check Meta's pricing page.

**Setup:**

1. At [developers.facebook.com](https://developers.facebook.com), create an app of type **Business** and add the **WhatsApp** product. This also creates or links a Meta Business account.
2. **Use a dedicated phone number.** Add one under WhatsApp → API Setup. A number on the API can't also be used in the normal WhatsApp app. Meta's test number works for a first try, but only with recipients you've allowlisted.
3. **Create a permanent token.** In Business Settings → System users, create a system user, assign it your app, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. The token on the API Setup page expires within a day.
4. Add this to `.env`. Pick any random string for the verify token. The app secret is under App settings → Basic.

   ```
   WHATSAPP_PHONE_NUMBER_ID=<phone number id>
   WHATSAPP_NUMBER=<number with country code, digits only>
   WHATSAPP_ACCESS_TOKEN=<permanent token>
   WHATSAPP_APP_SECRET=<app secret>
   WHATSAPP_VERIFY_TOKEN=<random string>
   ```

5. Apply it with `docker compose up -d --no-build`.
6. In the app's WhatsApp → Configuration, set the callback URL to `https://api.midday.rme.gg/webhook/whatsapp` (singular `webhook`) with your verify token. Click **Verify and save**, then subscribe to the **messages** field.
7. Publish the app (switch it to Live) so real messages are delivered.
8. In Midday, open the WhatsApp connect option under **Apps** or in **Inbox**. It shows the number and a code. Send `Connect to Midday: <code>` and you're linked.

Then try "what did I spend last month?", and send a photo of a receipt.

**Backup: Telegram.** Midday has the same assistant for Telegram, which is free, takes minutes with @BotFather, and has no such policy. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET_TOKEN`. It's a good way to prove the assistant works before dealing with Meta.

## 11. Updating

On your Mac, push `main` and tag a new version:

```bash
jj git push --bookmark main --remote origin
```

```bash
jj tag set v0.1.1 -r main
```

```bash
git push origin v0.1.1
```

When the Actions build finishes, set `MIDDAY_VERSION=0.1.1` in the VPS `.env`, then:

```bash
cd ~/midday && docker compose pull && docker compose up -d --no-build
```

Database migrations run automatically on start. If `deploy/` changed, rsync it again first (the `--exclude .env` keeps your settings).

## 12. Adding people

Midday has two kinds of invite. People always sign up with the exact email address that was invited or allowed.

| You want them to… | How |
|---|---|
| Join **your** team | **Settings → Members → Invite**. |
| Use the instance with **their own** team, without seeing yours | **Settings → Instance → Invite**. This is only visible to instance admins. After signing up, they create their own team during onboarding. |
| Sign up without a personal invite, for everyone at a domain or a fixed list | Set `SIGNUP_ALLOWED_EMAILS` in `.env`. They create their own team. |

Instance admins are the first account plus anyone listed in `ADMIN_EMAILS`. Admins on that list can always sign up. Both settings take exact addresses or whole domains (`@yourcompany.com`); subdomains are not matched unless you list them:

```
SIGNUP_ALLOWED_EMAILS=alice@example.com,@yourcompany.com
ADMIN_EMAILS=you@yourdomain.com
```

After changing `.env`, run `docker compose up -d` for it to take effect. Pending instance invites can be revoked from the Instance page.

## 13. Backups

Two things hold all your data: the Postgres database and the `storage-data` volume (uploaded files). A nightly dump of the database:

```bash
docker compose exec -T postgres pg_dump -U midday -Fc midday > ~/backups/midday-$(date +%F).dump
```

Copy those dumps and the storage volume off the server, for example with restic or rclone to object storage. Restore steps are in [deploy/README.md](../deploy/README.md).

## 14. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `docker compose pull` says denied or not found | Not logged in to GHCR, `MIDDAY_OWNER` isn't lowercase, or the Actions build hasn't finished. |
| Sign-up or login spins, or says "Can't reach the server" | `APP_URL` / `API_URL` scheme or host doesn't match how Caddy serves the site (`https://` on a VPS). |
| Browser certificate error | DNS wasn't pointing at the server when Caddy started. Fix DNS, then run `docker compose restart caddy`. |
| Logged out immediately after logging in | The app and API don't share a parent domain. |
| No emails arrive | Check `docker compose logs api` for SMTP errors, and that the sending domain is verified (SPF/DKIM). |
| Forwarded email never appears | `docker compose logs worker | grep -i imap`. Check the IMAP URL encoding and that `INBOX_EMAIL_DOMAIN` matches the address. |
| WhatsApp webhook won't verify | The verify token differs from `.env`, or the URL isn't `/webhook/whatsapp`. |
| Receipts arrive but have no amounts | AI isn't configured (section 8), or a scanned PDF on an OpenAI-compatible provider. |
| Bank search is empty | Enable Banking env not set, or the worker hasn't finished its startup sync yet (`docker compose logs worker \| grep institution`). |
| Enable Banking error when signing requests | The key isn't base64-encoded on one line (see step 7.2). |
