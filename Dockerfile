# Use the official Bun image
FROM oven/bun:alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build the SvelteKit app
FROM install AS build
COPY . .
ENV NODE_ENV=production
RUN bun run build

# Final runtime image
FROM base AS release
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./

USER bun
EXPOSE 3000
ENTRYPOINT ["bun", "./build/index.js"]
