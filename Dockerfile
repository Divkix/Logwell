# syntax=docker/dockerfile:1.4
# =============================================================================
# Logwell Production Dockerfile
# =============================================================================
# Multi-stage build optimized for production deployment
# Uses Bun runtime for fast performance
#
# Build: docker build -t logwell .
# Run:   docker run -p 3000:3000 --env-file .env logwell
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Base image with Bun runtime
# -----------------------------------------------------------------------------
# SECURITY: pinned to an exact version + digest for reproducible builds (matches CI's Bun 1.2.15)
FROM oven/bun:1.2.15-alpine@sha256:37b37b8cefbf88956d4cbecbc5b3ac4b3f1a9fb051f745c98a4bc6f5f285aacb AS base
WORKDIR /app

# Install curl for healthcheck (alpine minimal doesn't include it)
RUN apk add --no-cache curl

# -----------------------------------------------------------------------------
# Stage 2: Install production dependencies only
# -----------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app

# Copy package files for dependency installation
COPY package.json bun.lock ./

# Skip all browser binary downloads (Playwright, Puppeteer, etc.)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/dev/null

# Install production dependencies only (with Bun cache mount)
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

# -----------------------------------------------------------------------------
# Stage 3: Install all dependencies (including dev) for build and migrations
# -----------------------------------------------------------------------------
FROM base AS deps-dev
WORKDIR /app
COPY package.json bun.lock ./
# Skip all browser binary downloads (Playwright, Puppeteer, etc.)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/dev/null
# Install all dependencies (with Bun cache mount)
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts && bun run prepare

# -----------------------------------------------------------------------------
# Stage 4: Build the SvelteKit application
# -----------------------------------------------------------------------------
FROM deps-dev AS build
WORKDIR /app

# Copy files in order of change frequency (least to most) for optimal caching
# 1. Config files (rarely change) - package.json needed for release stage
COPY package.json svelte.config.js tsconfig.json vite.config.ts ./
COPY drizzle.config.ts ./

# 2. Static assets and migrations (change occasionally)
COPY static ./static
COPY drizzle ./drizzle

# 3. Scripts and entrypoint (rarely change)
COPY scripts ./scripts
COPY entrypoint.sh ./

# 4. Source code (changes most frequently - copy LAST)
COPY src ./src

# Set production environment for build optimizations
ENV NODE_ENV=production

# Build the SvelteKit app (creates /app/build directory)
# Dummy env vars satisfy build-time validation; real values provided at runtime
RUN DATABASE_URL=postgresql://build:build@localhost/build \
    BETTER_AUTH_SECRET=build-time-placeholder-secret-32chars \
    bun --bun run build

# -----------------------------------------------------------------------------
# Stage 5: Production runtime
# -----------------------------------------------------------------------------
FROM base AS release
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 logwell && \
    adduser --system --uid 1001 logwell

# Copy production dependencies
COPY --from=deps --chown=logwell:logwell /app/node_modules ./node_modules

# Copy drizzle-kit and its dependencies for migrations
# drizzle-kit is a devDependency, so we copy it from deps-dev
COPY --from=deps-dev --chown=logwell:logwell /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=deps-dev --chown=logwell:logwell /app/node_modules/.bin/drizzle-kit ./node_modules/.bin/drizzle-kit

# Copy built application
COPY --from=build --chown=logwell:logwell /app/build ./build
COPY --from=build --chown=logwell:logwell /app/package.json ./

# Copy files needed for migrations and seeding
COPY --from=build --chown=logwell:logwell /app/drizzle ./drizzle
COPY --from=build --chown=logwell:logwell /app/drizzle.config.ts ./
COPY --from=build --chown=logwell:logwell /app/scripts ./scripts
COPY --from=build --chown=logwell:logwell /app/src/lib/server ./src/lib/server

# Copy entrypoint script
COPY --chown=logwell:logwell entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Switch to non-root user
USER logwell

# Expose the application port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Health check configuration
# Checks /api/health endpoint every 30 seconds
# Allows 30 seconds for startup (migrations + seed), 10 second timeout per check
# Marks unhealthy after 3 consecutive failures
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start the application via entrypoint (runs migrations + seed first)
ENTRYPOINT ["./entrypoint.sh"]
