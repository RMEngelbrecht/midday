# Running Midday on a VPS: email and EU bank sync

This guide takes you from an empty Ubuntu or Debian VPS to Midday running on your own domain, with HTTPS, real email, and automatic bank sync through Enable Banking.

For the reference material (every environment variable, the optional services, backups), see [self-hosting.md](./self-hosting.md) and [env-reference.md](./env-reference.md).

**Placeholders used below**

| Placeholder | Example |
|---|---|
| `yourdomain.com` | your domain |
| `app.yourdomain.com` | the dashboard |
| `api.yourdomain.com` | the API |
| `<you>` | your GitHub username |

---

## 1. Prerequisites

- **A VPS** running Ubuntu 22.04+ or Debian 12+.
  - Building the images on the server needs **4 GB of RAM** (2 GB plus swap also works; see step 3).
  - Running prebuilt images needs **2 GB**.
- **A domain** where you can create DNS records.
- **An email sending provider.** Step 5 covers this.
- **For bank sync:** an Enable Banking account. Step 7 covers this.

## 2. DNS

Create two records that point at the VPS's public IP:

| Type | Name | Value |
|---|---|---|
| A | `app` | `<VPS IPv4>` |
| A | `api` | `<VPS IPv4>` |

If your VPS has IPv6, add matching AAAA records too.

The dashboard and API **must share a parent domain**, as `app.` and `api.` do here, because the login cookie is shared between them. Wait until `dig +short app.yourdomain.com` returns your IP before you start the stack. Caddy needs working DNS to obtain its HTTPS certificates.

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

**Only if the VPS has less than 4 GB of RAM:** add 4 GB of swap so the image build doesn't run out of memory.

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 4. Get the code onto the server

The fork lives in a jj repository on your machine. Push it to a **private** GitHub repository first. On your Mac, inside the repo:

```bash
jj git remote add origin git@github.com:<you>/midday.git
```

```bash
jj git push --bookmark main --remote origin
```

Then on the VPS, clone it. Add an SSH deploy key to the GitHub repo first, or use HTTPS with a token.

```bash
git clone git@github.com:<you>/midday.git ~/midday && cd ~/midday/deploy
```

```bash
cp .env.example .env
```

## 5. Configure `.env`

Open `~/midday/deploy/.env` and set the following.

### 5.1 Domain

Keep `CADDY_SCHEME` empty. Caddy then serves HTTPS and fetches Let's Encrypt certificates automatically. The URLs **must** start with `https://`.

```
DOMAIN=yourdomain.com
APP_URL=https://app.yourdomain.com
API_URL=https://api.yourdomain.com
CADDY_SCHEME=
HTTP_PORT=80
HTTPS_PORT=443
```

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
MAIL_FROM="Midday <noreply@yourdomain.com>"
```

**Optional: forwarding receipts by email.** To have emails sent to your team's inbox address turn into Inbox items, create a mailbox (for example `inbox@yourdomain.com`) that receives mail, then set:

```
IMAP_URL=imaps://inbox%40yourdomain.com:<password>@imap.yourprovider.com:993
INBOX_EMAIL_DOMAIN=yourdomain.com
```

### 5.3 Sign-up policy

By default (`first-user`), only the very first account can sign up, and that account becomes the owner. Everyone after that needs an invite. Leave it like this. Section 9 explains how to add people.

## 6. Start it

```bash
./generate-secrets.sh
```

```bash
docker compose up -d --build
```

The first build takes 10 to 20 minutes on a small VPS. When it finishes, check the services:

```bash
docker compose ps
```

All services should be `healthy`. The `migrate` service is a one-off job, so it should show as exited (code 0) rather than healthy. Caddy has no health check.

```bash
curl -s https://api.yourdomain.com/health
```

This should return `{"status":"ok"}`.

**Sign up straight away** at `https://app.yourdomain.com`. The first account becomes the owner.

To test email, sign out and sign in again using "email code". The code should arrive in your inbox. If it doesn't, read the API log:

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
   - **Redirect URL:** `https://app.yourdomain.com/api/enablebanking/session`
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

## 8. Updating

```bash
cd ~/midday && git pull && cd deploy && docker compose up -d --build
```

Database migrations run automatically when the stack starts.

## 9. Adding people

Invite them to your team from **Settings → Members**. They sign up with the invited email address and join your team.

## 10. Backups

Two things hold all your data: the Postgres database and the `storage-data` volume (uploaded files). A nightly dump of the database:

```bash
docker compose exec -T postgres pg_dump -U midday -Fc midday > ~/backups/midday-$(date +%F).dump
```

Copy those dumps and the storage volume off the server, for example with restic or rclone to object storage. Restore steps are in [deploy/README.md](../deploy/README.md).

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Sign-up or login spins, or says "Can't reach the server" | `APP_URL` / `API_URL` scheme or host doesn't match how Caddy serves the site (`https://` on a VPS). |
| Browser certificate error | DNS wasn't pointing at the server when Caddy started. Fix DNS, then run `docker compose restart caddy`. |
| Logged out immediately after logging in | The app and API don't share a parent domain. |
| No emails arrive | Check `docker compose logs api` for SMTP errors, and that the sending domain is verified (SPF/DKIM). |
| Bank search is empty | Enable Banking env not set, or the worker hasn't finished its startup sync yet (`docker compose logs worker \| grep institution`). |
| Enable Banking error when signing requests | The key isn't base64-encoded on one line (see step 7.2). |
