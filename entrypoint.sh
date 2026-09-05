#!/bin/sh
set -e

echo "=== Logwell startup ==="

echo "Running database migrations..."
bun run drizzle-kit migrate || { echo "Migration failed! Aborting startup."; exit 1; }
echo "✓ Migrations completed successfully"

if [ -n "$ADMIN_PASSWORD" ]; then
  echo "Seeding admin user..."
  if ! bun run db:seed; then
    echo "Seed step failed! Aborting startup."
    exit 1
  fi
else
  echo "⚠ ADMIN_PASSWORD not set, skipping admin seed"
fi

echo "=== Starting application ==="
exec bun run ./build/index.js
