# syntax=docker/dockerfile:1.4

# SECURITY: pinned to an exact version + digest for reproducible builds (Bun 1.4.2; matches the
# app runtime). Bun serves the built output and runs the TypeScript scripts; pnpm only installs
# dependencies (see packageManager).
FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS base
WORKDIR /app

# Install curl for healthcheck (alpine minimal doesn't include it)
RUN apk add --no-cache curl

# pnpm 12 ships a self-contained musl binary and needs no Node.js. Pinned to an exact release
# and per-architecture sha256, same policy as the base image.
ARG PNPM_VERSION=12.5.1
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
      amd64) asset="pnpm-linux-x64-musl.tar.gz";  sha256="9b1910e07dac85bb7a2f5e0d1eb15da49b9e6220e0862b339877f8729bfb467a" ;; \
      arm64) asset="pnpm-linux-arm64-musl.tar.gz"; sha256="41d24fdc91360b431d667c54720f62b2d32e14ba71b09b2d0a63a8c859dcc4e3" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/pnpm.tgz \
      "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/${asset}" \
 && echo "${sha256}  /tmp/pnpm.tgz" | sha256sum -c - \
 && tar -xzf /tmp/pnpm.tgz -C /usr/local/bin pnpm \
 && rm /tmp/pnpm.tgz \
 && pnpm --version

FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY sdks/typescript/package.json ./sdks/typescript/package.json

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/dev/null

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm --filter logwell-app install --frozen-lockfile --prod --ignore-scripts

FROM base AS deps-dev
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY sdks/typescript/package.json ./sdks/typescript/package.json
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/dev/null
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm --filter logwell-app install --frozen-lockfile --ignore-scripts && bun run prepare

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

# pnpm's top-level entries are relative symlinks into node_modules/.pnpm, so the whole tree
# travels together.
COPY --from=deps --chown=logwell:logwell /app/node_modules ./node_modules

COPY --from=build --chown=logwell:logwell /app/build ./build
COPY --from=build --chown=logwell:logwell /app/package.json ./

COPY --from=build --chown=logwell:logwell /app/drizzle ./drizzle
COPY --from=build --chown=logwell:logwell /app/drizzle.config.ts ./
COPY --from=build --chown=logwell:logwell /app/scripts ./scripts
COPY --from=build --chown=logwell:logwell /app/src/lib/server ./src/lib/server
COPY --from=build --chown=logwell:logwell /app/src/lib/shared ./src/lib/shared

# entrypoint.sh runs these scripts against production dependencies alone; fail the build here
# instead of at container start if one of their imports is a devDependency. $env/* is a
# SvelteKit virtual module (injected at build time), not something node_modules provides.
RUN bun build ./scripts/seed-admin.ts ./scripts/backfill-incidents.ts --target=bun \
    --external '$env/*' --outdir /tmp/scripts-check && \
    rm -rf /tmp/scripts-check

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
