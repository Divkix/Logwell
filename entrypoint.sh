#!/bin/sh
set -e

echo "=== Logwell startup ==="

echo "Running database migrations..."
# Runs drizzle's migrator under a Postgres advisory lock so replicas booting together don't race.
./node_modules/.bin/tsx scripts/migrate.ts || { echo "Migration failed! Aborting startup."; exit 1; }

if [ -n "$ADMIN_PASSWORD" ]; then
  echo "Seeding admin user..."
  if ! ./node_modules/.bin/tsx scripts/seed-admin.ts; then
    echo "Seed step failed! Aborting startup."
    exit 1
  fi
else
  echo "⚠ ADMIN_PASSWORD not set, skipping admin seed"
fi

echo "=== Starting application ==="
exec node ./build/index.js
