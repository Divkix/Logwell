# =============================================================================
# sv-logger Production Dockerfile
# =============================================================================
# Multi-stage build optimized for production deployment
# Uses Bun runtime for fast performance
#
# Build: docker build -t sv-logger .
# Run:   docker run -p 3000:3000 --env-file .env sv-logger
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Base image with Bun runtime
# -----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install curl for healthcheck (alpine minimal doesn't include it)
RUN apk add --no-cache curl

# -----------------------------------------------------------------------------
# Stage 2: Install dependencies
# -----------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app

# Copy package files for dependency installation
COPY package.json bun.lock ./

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Install all dependencies for build stage
FROM base AS deps-dev
WORKDIR /app
COPY package.json bun.lock ./
# Skip all browser binary downloads (Playwright, Puppeteer, etc.)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/dev/null
RUN bun install --frozen-lockfile --ignore-scripts && bun run prepare

# -----------------------------------------------------------------------------
# Stage 3: Build the SvelteKit application
# -----------------------------------------------------------------------------
FROM deps-dev AS build
WORKDIR /app

# Copy source code
COPY . .

# Set production environment for build optimizations
ENV NODE_ENV=production

# Build the SvelteKit app (creates /app/build directory)
# Dummy env vars satisfy build-time validation; real values provided at runtime
RUN DATABASE_URL=postgresql://build:build@localhost/build \
    BETTER_AUTH_SECRET=build-time-placeholder-secret-32chars \
    bun --bun run build

# -----------------------------------------------------------------------------
# Stage 4: Production runtime
# -----------------------------------------------------------------------------
FROM base AS release
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 svlogger && \
    adduser --system --uid 1001 svlogger

# Copy production dependencies and built application with correct ownership
COPY --from=deps --chown=svlogger:svlogger /app/node_modules ./node_modules
COPY --from=build --chown=svlogger:svlogger /app/build ./build
COPY --from=build --chown=svlogger:svlogger /app/package.json ./

# Switch to non-root user
USER svlogger

# Expose the application port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Health check configuration
# Checks /api/health endpoint every 30 seconds
# Allows 5 seconds for startup, 10 second timeout per check
# Marks unhealthy after 3 consecutive failures
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start the application
ENTRYPOINT ["bun", "run", "./build/index.js"]
