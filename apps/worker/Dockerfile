# Base image with Bun
FROM oven/bun:1.3.11 AS base

# Install turbo CLI globally
FROM base AS turbo-cli
RUN bun add -g turbo

# Builder stage - prune worker workspace
FROM turbo-cli AS builder
WORKDIR /app
COPY . .
RUN turbo prune @midday/worker --docker --out-dir=out/worker

# Build stage - full install (dev deps) only to build the workbench UI
FROM base AS build
WORKDIR /app
COPY --from=builder /app/out/worker/json/ .
COPY bunfig.toml .
RUN bun install
COPY --from=builder /app/out/worker/full/ .
RUN cd packages/workbench && bun run build

# Production dependencies + sources (Bun runs TS workspace packages directly)
FROM base AS prod
WORKDIR /app
RUN apt-get update && apt-get install -y python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/out/worker/json/ .
COPY bunfig.toml .
# --production implies a frozen lockfile, which turbo's pruned lockfile fails.
# Reconcile it first: this keeps the pinned versions.
RUN set -e; bun install --lockfile-only; bun install --production; \
    find node_modules \( -name "*.map" -o -name "*.md" -o -name "*.d.ts" -o -name "*.d.mts" -o -name "*.d.cts" -o -name "__tests__" \) -prune -exec rm -rf {} +; \
    # Build/dev-only packages that bun pulls in as peers or workspace devDeps,
    # plus native binaries for other libc/arch variants.
    rm -rf node_modules/next node_modules/@next/swc-* node_modules/typescript node_modules/drizzle-kit \
        node_modules/@esbuild-kit node_modules/@biomejs node_modules/turbo node_modules/@turbo \
        node_modules/.cache; \
    find node_modules -maxdepth 3 -type d \( -name "*-musl" -o -name "*-musl-*" -o -name "*-win32-*" -o -name "*-darwin-*" -o -name "*-android-*" -o -name "*-freebsd-*" \) -prune -exec rm -rf {} +; \
    rm -rf /root/.bun/install/cache
COPY --from=builder /app/out/worker/full/ .
COPY --from=build /app/packages/workbench/dist ./packages/workbench/dist

# Runner stage - slim image
FROM oven/bun:1.3.11-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=prod /app/node_modules ./node_modules
COPY --from=prod /app/apps/worker ./apps/worker
COPY --from=prod /app/packages ./packages
COPY --from=prod /app/package.json ./package.json
# Root env schema; app/package schemas import it (`@import(../../)`).
COPY --from=builder /app/.env.schema ./.env.schema

# Release id stamped by CI (--build-arg GIT_COMMIT_SHA=...)
ARG GIT_COMMIT_SHA=""
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
COPY --from=builder /app/scripts/docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

WORKDIR /app/apps/worker

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
# varlock validates env against the schema and injects it before the app starts.
CMD ["bun", "/app/node_modules/varlock/bin/cli.js", "run", "--", "bun", "src/index.ts"]
