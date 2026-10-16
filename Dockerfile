# syntax=docker/dockerfile:1.4

# SECURITY: pinned to an exact version + digest for reproducible builds (Node.js 24 LTS). Node
# serves the built output and runs the TypeScript scripts through tsx; pnpm only installs
# dependencies (see packageManager).
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
WORKDIR /app

# Install curl for healthcheck (alpine minimal doesn't include it)
RUN apk add --no-cache curl

# pnpm 12 ships a self-contained musl binary. Pinned to an exact release
# and per-architecture sha256, same policy as the base image.
ARG PNPM_VERSION=12.6.0
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
      amd64) asset="pnpm-linux-x64-musl.tar.gz";  sha256="bf23d242a6c7a4d42b21bf1d93bff9d6a473cf8b6a7a990c6ed3094228513048" ;; \
      arm64) asset="pnpm-linux-arm64-musl.tar.gz"; sha256="61e5a2b9aa8c1ebb73ea22203021531f88b8aff9499b68be03f695d9377928c1" ;; \
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
    pnpm --filter logwell-app install --frozen-lockfile --ignore-scripts && pnpm run prepare

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
    pnpm run build

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
# instead of at container start if one of their imports is a devDependency. ESM links the whole
# import graph before evaluating anything, so reaching the DATABASE_URL check (unset here) proves
# every import resolved; a missing package fails earlier with ERR_MODULE_NOT_FOUND.
RUN for script in seed-admin backfill-incidents; do \
      out=$(./node_modules/.bin/tsx "scripts/${script}.ts" 2>&1) || true; \
      echo "$out" | grep -q "DATABASE_URL" || { echo "$out"; exit 1; }; \
    done

COPY --chown=logwell:logwell entrypoint.sh ./
RUN chmod +x entrypoint.sh

USER logwell

EXPOSE 3000

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
# Seconds before shutdown force-closes open connections (adapter default 30). Live SSE streams never
# end on their own, so keep this under Docker's 10s stop grace period or SIGKILL lands first and
# the app's shutdown hook (DB pool close) never runs.
ENV SHUTDOWN_TIMEOUT=8
# Max request body (adapter default 512K) — bounds ingest batches, which can exceed 512K
ENV BODY_SIZE_LIMIT=1M

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
