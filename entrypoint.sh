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
  # ADMIN_PASSWORD was provided, so a seed failure is a real error — fail fast
  # rather than booting with partially-initialized auth state.
  if ! bun run db:seed; then
    echo "Seed step failed! Aborting startup."
    exit 1
  fi
else
  echo "⚠ ADMIN_PASSWORD not set, skipping admin seed"
fi

echo "=== Starting application ==="
exec bun run ./build/index.js
