# Base image with Bun
FROM oven/bun:1.3.11 AS base

# Install turbo CLI globally
FROM base AS turbo-cli
RUN bun add -g turbo

# Builder stage - prune API workspace
FROM turbo-cli AS builder
WORKDIR /app
COPY . .
RUN turbo prune @midday/api --docker

# Installer stage - install deps and build
FROM base AS installer
WORKDIR /app

# Install dependencies
COPY --from=builder /app/out/json/ .
COPY bunfig.toml .
RUN bun install

# Copy full source
COPY --from=builder /app/out/full/ .

# Build the mcp-apps package (produces self-contained HTML files)
RUN cd packages/mcp-apps && bun run build

# Runner stage - clean image
FROM oven/bun:1.3.11 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy only what's needed at runtime
COPY --from=installer /app/node_modules ./node_modules
COPY --from=installer /app/apps/api ./apps/api
COPY --from=installer /app/packages ./packages
COPY --from=installer /app/package.json ./package.json
# Root env schema; app/package schemas import it (`@import(../../)`).
COPY --from=builder /app/.env.schema ./.env.schema

# Release id stamped by CI (--build-arg GIT_COMMIT_SHA=...)
ARG GIT_COMMIT_SHA=""
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
COPY --from=builder /app/scripts/docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

WORKDIR /app/apps/api

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
# varlock validates env against the schema and injects it before the app starts.
CMD ["bun", "/app/node_modules/varlock/bin/cli.js", "run", "--", "bun", "src/index.ts"]
