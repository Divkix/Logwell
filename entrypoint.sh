#!/bin/sh
set -e

echo "=== sv-logger startup ==="

# Run database migrations
echo "Running database migrations..."
if bun run drizzle-kit migrate 2>&1; then
  echo "✓ Migrations completed successfully"
else
  echo "✗ Migration failed, but continuing (tables may already exist)"
fi

# Seed admin user (idempotent - skips if exists)
if [ -n "$ADMIN_PASSWORD" ]; then
  echo "Seeding admin user..."
  if bun run scripts/seed-admin.ts 2>&1; then
    echo "✓ Admin seeding completed"
  else
    echo "✗ Admin seeding failed (user may already exist)"
  fi
else
  echo "⚠ ADMIN_PASSWORD not set, skipping admin seed"
fi

echo "=== Starting application ==="
exec bun run ./build/index.js
