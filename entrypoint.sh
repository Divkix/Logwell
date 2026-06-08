#!/bin/sh
set -e

echo "=== Logwell startup ==="

# Run database migrations
echo "Running database migrations..."
bun run drizzle-kit migrate || { echo "Migration failed! Aborting startup."; exit 1; }
echo "✓ Migrations completed successfully"

# Seed admin user (idempotent - skips if exists)
if [ -n "$ADMIN_PASSWORD" ]; then
  echo "Seeding admin user..."
  bun run db:seed || echo "Seed step failed (admin may already exist, continuing)"
else
  echo "⚠ ADMIN_PASSWORD not set, skipping admin seed"
fi

echo "=== Starting application ==="
exec bun run ./build/index.js
