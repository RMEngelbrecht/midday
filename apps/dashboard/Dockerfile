# Base image with Bun
FROM oven/bun:1.4.5 AS base

# Install turbo CLI globally using Bun
FROM base AS turbo-cli
RUN bun add -g turbo

# Builder stage - prune dashboard workspace
FROM turbo-cli AS builder
WORKDIR /app
# Copy all files
COPY . .
# Prune dashboard workspace
RUN turbo prune @midday/dashboard --docker

# Installer stage
FROM base AS installer
WORKDIR /app

# Install CA certificates so Sentry CLI can verify SSL during source map upload
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy package.json files from pruned workspace
COPY --from=builder /app/out/json/ .
COPY bunfig.toml .

# Install dependencies
RUN bun install

# Copy full source from pruned workspace
COPY --from=builder /app/out/full/ .

# No runtime config at build time: APP_URL, API_URL, feature keys etc. are read
# when the server starts (varlock) and passed to the browser via PublicConfig,
# so one image serves any deployment.

# Sentry source map upload (build-time only, optional)
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT

# Release id stamped by CI (--build-arg GIT_COMMIT_SHA=...).
ARG GIT_COMMIT_SHA=""

ENV CI=true
ENV NODE_ENV=production

# Build with GIT_COMMIT_SHA + SENTRY_RELEASE exported so next.config.ts and
# the Sentry webpack plugin can read them via process.env.
RUN export GIT_COMMIT_SHA SENTRY_RELEASE="$GIT_COMMIT_SHA"; \
    bunx turbo run build --filter=@midday/dashboard --only

# Collapse the dashboard's env schema import graph (root + packages) into a
# self-contained directory for the runner stage.
COPY --from=builder /app/.env.schema ./.env.schema
RUN cd apps/dashboard && bun ../../node_modules/varlock/bin/cli.js flatten --out-dir .env-flat

# Runner stage - clean bun image, no turbo
FROM oven/bun:1.4.5 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --no-log-init -g nodejs nextjs

# Copy standalone output
COPY --from=installer --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/dashboard/public ./apps/dashboard/public

# Env schema (validated at startup) and the varlock CLI (no dependencies).
COPY --from=installer --chown=nextjs:nodejs /app/apps/dashboard/.env-flat/ ./apps/dashboard/
COPY --from=installer /app/node_modules/varlock ./node_modules/varlock

# Carry the git SHA into the runtime container and use the shared entrypoint to
# set GIT_COMMIT_SHA / SENTRY_RELEASE when they aren't provided.
ARG GIT_COMMIT_SHA=""
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
COPY --from=builder /app/scripts/docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER nextjs

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
# varlock validates env against the schema and injects it before Next starts.
CMD ["bun", "node_modules/varlock/bin/cli.js", "run", "--path", "apps/dashboard/", "--", "bun", "apps/dashboard/server.js"]
