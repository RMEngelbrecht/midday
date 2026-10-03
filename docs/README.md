# Documentation

This directory contains the documentation for this self-hostable fork of Midday.

## Running it

- **[self-hosting.md](./self-hosting.md)** - Quickstart, requirements (URLs and cookies), optional services (SMTP, inbound email, S3, AI, bank data, OAuth integrations), desktop and CLI, backups and upgrades.
- **[env-reference.md](./env-reference.md)** - Every environment variable, generated from the Varlock `.env.schema` files (`bun run docs:env`).
- **[ai.md](./ai.md)** - Configuring the optional AI layer (OpenAI, Ollama and other OpenAI-compatible servers).

## Internals

- **[weekly-insights.md](./weekly-insights.md)** - Technical documentation of the AI-powered weekly insights system including content generation, metric selection, data consistency, and advanced projections (runway dates, quarter pace, payment anomalies).
- **[inbox-matching.md](./inbox-matching.md)** - Detailed documentation of the V2 deterministic inbox matching algorithm with team calibration, hard-negative memory, and read-only verification tooling.
- **[invoice-recurring.md](./invoice-recurring.md)** - Technical documentation of the recurring invoice system including architecture, state machine, generation flow, and key design decisions.
- **[document-processing.md](./document-processing.md)** - Technical documentation of the document processing pipeline including AI classification, graceful degradation, retry functionality, and error handling.

## About

This documentation provides in-depth technical details about core Midday features and algorithms. It's intended for developers working on the codebase who need to understand the implementation details, data flows, and architectural decisions.

Documents marked "Historical" describe the pre-fork architecture and are kept for reference.
