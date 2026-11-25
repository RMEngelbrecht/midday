# Base image with Bun
FROM oven/bun:1.4.5 AS base

# Install turbo CLI globally
FROM base AS turbo-cli
RUN bun add -g turbo

# Builder stage - prune API workspace
FROM turbo-cli AS builder
WORKDIR /app
COPY . .
RUN turbo prune @midday/api --docker

# Build stage - full install (dev deps) only to build the mcp-apps HTML bundles
FROM base AS build
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY bunfig.toml .
RUN bun install
COPY --from=builder /app/out/full/ .
# Produces self-contained HTML files
RUN cd packages/mcp-apps && bun run build

# Production dependencies + sources. Bun runs the TS workspace packages directly,
# so no compile step is needed beyond the mcp-apps bundles.
FROM base AS prod
WORKDIR /app
COPY --from=builder /app/out/json/ .
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
COPY --from=builder /app/out/full/ .
COPY --from=build /app/packages/mcp-apps/dist ./packages/mcp-apps/dist

# Runner stage - slim image
FROM oven/bun:1.4.5-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy only what's needed at runtime
COPY --from=prod /app/node_modules ./node_modules
COPY --from=prod /app/apps/api ./apps/api
COPY --from=prod /app/packages ./packages
COPY --from=prod /app/package.json ./package.json
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
