# syntax=docker/dockerfile:1.4

# SECURITY: pinned to an exact version + digest for reproducible builds (Bun 1.4.2; matches CI + packageManager)
FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS base
WORKDIR /app

# Install curl for healthcheck (alpine minimal doesn't include it)
RUN apk add --no-cache curl

FROM base AS deps
WORKDIR /app

COPY package.json bun.lock ./

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/dev/null

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

FROM base AS deps-dev
WORKDIR /app
COPY package.json bun.lock ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/dev/null
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts && bun run prepare

FROM deps-dev AS build
WORKDIR /app

COPY package.json svelte.config.js tsconfig.json vite.config.ts ./
COPY drizzle.config.ts ./

COPY static ./static
COPY drizzle ./drizzle

COPY scripts ./scripts
COPY entrypoint.sh ./

COPY src ./src

ENV NODE_ENV=production

RUN DATABASE_URL=postgresql://build:build@localhost/build \
    BETTER_AUTH_SECRET=build-time-placeholder-secret-32chars \
    bun run build

FROM base AS release
WORKDIR /app

RUN addgroup --system --gid 1001 logwell && \
    adduser --system --uid 1001 logwell

COPY --from=deps --chown=logwell:logwell /app/node_modules ./node_modules

COPY --from=deps-dev --chown=logwell:logwell /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=deps-dev --chown=logwell:logwell /app/node_modules/.bin/drizzle-kit ./node_modules/.bin/drizzle-kit

COPY --from=build --chown=logwell:logwell /app/build ./build
COPY --from=build --chown=logwell:logwell /app/package.json ./

COPY --from=build --chown=logwell:logwell /app/drizzle ./drizzle
COPY --from=build --chown=logwell:logwell /app/drizzle.config.ts ./
COPY --from=build --chown=logwell:logwell /app/scripts ./scripts
COPY --from=build --chown=logwell:logwell /app/src/lib/server ./src/lib/server
COPY --from=build --chown=logwell:logwell /app/src/lib/shared ./src/lib/shared

COPY --chown=logwell:logwell entrypoint.sh ./
RUN chmod +x entrypoint.sh

USER logwell

EXPOSE 3000

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
# Bun.serve idle timeout (s) — MUST stay above the SSE heartbeat (capped at half this value)
ENV IDLE_TIMEOUT=120
# Max request body (adapter default 512K) — bounds ingest batches, which can exceed 512K
ENV BODY_SIZE_LIMIT=1M

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
