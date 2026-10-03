![hero](github.png)

<p align="center">
	<h1 align="center"><b>Midday</b></h1>
<p align="center">
    Self-hostable business assistant: invoicing, banking, receipts, time tracking
    <br />
    <br />
    <a href="docs/self-hosting.md">Self-hosting guide</a>
    ·
    <a href="docs/env-reference.md">Configuration</a>
    ·
    <a href="docs/README.md">Docs</a>
  </p>
</p>

## About this fork

[Midday](https://github.com/midday-ai/midday) was a hosted product for freelancers, contractors and small companies. The original service has been sunset, and this repository is a hard fork of it that you can run yourself. The hosted-only parts (Supabase, Trigger.dev, Railway/Vercel/Cloudflare, Polar billing, Plain, the marketing website) are gone. What is left is one stack that runs on a single machine:

```
Caddy ── app.example.com → dashboard (Next.js)
      └─ api.example.com → api (Hono: REST, tRPC, MCP, auth, realtime)
api + worker (BullMQ) ── Postgres (pgvector) · Valkey · local volume or S3
```

```sh
cd deploy && cp .env.example .env && ./generate-secrets.sh && $EDITOR .env
docker compose up -d
```

Start with **[docs/self-hosting.md](docs/self-hosting.md)**. With no configuration you get email + password login, local file storage, manual accounts and statement import (OFX, CAMT.053, MT940, QIF, CSV), invoices, inbox, vault, export and time tracking. Everything else is switched on by environment variables: SMTP mail, S3 storage, AI (any OpenAI-compatible endpoint, including Ollama), bank connections (SimpleFIN, Enable Banking, Plaid, Teller), and OAuth integrations. Bank and OAuth providers need your own developer accounts.

## Features

**Invoicing**: web-based invoices with a public link, PDF and email delivery, recurring invoices.<br/>
**Magic Inbox**: receipts and invoices, by upload or inbound email, matched to the right transactions.<br/>
**Banking**: manual accounts, statement import, and optional bank connections.<br/>
**Vault**: secure storage for contracts and documents.<br/>
**Time tracking**: live tracking of projects.<br/>
**Export**: all your data as a ZIP, or CSV for your accountant.<br/>
**Assistant** (optional AI): insights, categorisation and document extraction.<br/>
**Desktop and CLI**: a Tauri app and a command-line client that connect to your own server.<br/>

## Architecture

- Monorepo (Bun, Turborepo), TypeScript
- `apps/dashboard`: Next.js, one prebuilt image for any domain (runtime config)
- `apps/api`: Hono, better-auth at `/auth`, SSE at `/realtime`
- `apps/worker`: BullMQ jobs and schedulers
- `apps/desktop`: Tauri shell; `packages/cli`: command-line client
- Configuration: [Varlock](https://varlock.dev) `.env.schema` files, documented in [docs/env-reference.md](docs/env-reference.md)

## Development

```sh
bun install
bun run env:codegen     # typed env from the .env.schema files
bun run typecheck && bun run lint && bun run test
```

`e2e/` is a Playwright smoke suite for a running compose stack (see the self-hosting guide). It runs nightly in CI.

## License

This project is licensed under the **[AGPL-3.0](https://opensource.org/licenses/AGPL-3.0)** for non-commercial use. 

### Commercial Use

For commercial use or deployments requiring a setup fee, please contact us
for a commercial license at [engineer@midday.ai](mailto:engineer@midday.ai).

By using this software, you agree to the terms of the license.
