# Operations: backups, restores, upgrades

Runbook for a self-hosted Logwell running from `compose.prod.yaml` (services `app` and `db`,
database and role `logwell`). On Fly, Render or a managed Postgres, run the same `pg_dump` /
`pg_restore` commands against `DATABASE_URL` from any machine with Postgres 18 client tools, and
use the provider's own backups as well.

All examples assume the variables `compose.prod.yaml` requires (`DB_PASSWORD`,
`BETTER_AUTH_SECRET`, `ADMIN_PASSWORD`, `ORIGIN`) are exported, and use this alias:

```bash
alias dc='docker compose -f compose.prod.yaml'
```

## What to back up

Everything lives in Postgres: logs, incidents, projects and their API key hashes, users and
sessions, and the `drizzle.__drizzle_migrations` table that records which migrations have run.
`pg_dump` of the `logwell` database captures all of it. The app container is stateless.

Keep `BETTER_AUTH_SECRET` with the backup, in a secret store and never in the dump's directory.
A restore with a different secret invalidates every session, so everyone signs in again.

## Backup

```bash
dc exec -T db pg_dump -U logwell -d logwell -Fc > "logwell-$(date +%F).dump"
```

- `-Fc` is the compressed custom format that `pg_restore` reads. `-T` disables the TTY so the
  binary output isn't mangled.
- It is an online, consistent snapshot, so you don't need to stop the app. Logs ingested after it
  starts are not in it.
- Schedule it from cron or a systemd timer, copy the file off the host, and prune old dumps.

## Restore

Into the running stack, replacing its contents:

```bash
dc stop app
dc exec -T db pg_restore -U logwell -d logwell --clean --if-exists --no-owner < logwell-YYYY-MM-DD.dump
dc start app
```

`--clean --if-exists` drops each object before recreating it, including the migrations table, so
the database ends up exactly at the dump's schema version. Run the image that matches that
version: see [Rollback](#rollback).

## Restore drill

Restore a backup into a throwaway container now and then. Until a backup has restored once, you
don't know that it works.

```bash
docker run -d --name logwell-restore-test -e POSTGRES_PASSWORD=drill postgres:18-alpine
sleep 5
docker exec logwell-restore-test createdb -U postgres logwell
docker cp logwell-YYYY-MM-DD.dump logwell-restore-test:/tmp/backup.dump
docker exec logwell-restore-test pg_restore -U postgres -d logwell --no-owner /tmp/backup.dump
docker exec logwell-restore-test psql -U postgres -d logwell \
  -c 'select count(*) from drizzle.__drizzle_migrations' \
  -c 'select count(*) from log' \
  -c 'select name from project'
docker rm -f logwell-restore-test
```

The counts should match production as of the dump.

## Upgrade

`compose.prod.yaml` pins the image to a release (`ghcr.io/divkix/logwell:${LOGWELL_VERSION:-vX.Y.Z}`).
Upgrading means choosing a newer tag. A plain `dc pull` never moves you to another release.

1. **Read the release notes** on GitHub Releases, and the SQL the release adds under `drizzle/`
   at that tag.
2. **Back up**, as in [Backup](#backup), and keep the dump until the new version has run cleanly
   for a while.
3. **Pre-create large indexes**, if the release adds an index on `log` (see
   [the next section](#pre-creating-large-indexes)).
4. **Migrate with the new image while the app is stopped:**

   ```bash
   export LOGWELL_VERSION=vX.Y.Z    # the new release
   dc stop app
   dc run --rm --no-deps --entrypoint ./node_modules/.bin/tsx app scripts/migrate.ts
   dc up -d app
   ```

   `scripts/migrate.ts` ships in releases **after v1.4.0**. If the target release is v1.4.0 or
   older, migrate with drizzle-kit instead, which takes no advisory lock:

   ```bash
   dc run --rm --no-deps --entrypoint ./node_modules/.bin/drizzle-kit app migrate
   ```

   Starting the container also migrates, so `dc up -d` on its own works too. Running the
   migration separately first means a long migration or a failure happens before anything
   restarts, not inside a restart loop or a health-check timeout. In releases after v1.4.0,
   `entrypoint.sh` runs `scripts/migrate.ts` before the server, under a Postgres advisory lock,
   so replicas starting together wait for each other instead of colliding. v1.4.0 and older run
   `drizzle-kit migrate` with no lock.

5. **Check** that `curl -fsS http://localhost:${PORT:-3000}/api/health` reports
   `"database":"connected"` and that the dashboard shows live logs. Then make the version
   permanent by setting `LOGWELL_VERSION` in your `.env` file or updating the default in your copy
   of `compose.prod.yaml`.

## Pre-creating large indexes

Drizzle applies all pending migrations in **one transaction**. A plain `CREATE INDEX` on a large
`log` table holds a lock that blocks ingest writes for as long as the build takes, and
`CREATE INDEX CONCURRENTLY` can't run inside a transaction at all. On a big table, build the index
online first:

```bash
dc exec db psql -U logwell -d logwell \
  -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_name" ON "log" USING btree ("project_id", "timestamp");'
```

- Copy the index name, method and columns **exactly** from the release's migration SQL.
- This only helps if that migration says `CREATE INDEX IF NOT EXISTS`. A bare `CREATE INDEX` then
  fails with "already exists", which aborts the whole migration transaction. If the migration
  lacks `IF NOT EXISTS`, schedule a maintenance window instead.
- A failed concurrent build leaves an `INVALID` index behind. Find it with
  `select indexrelid::regclass from pg_index where not indisvalid;`, then
  `DROP INDEX CONCURRENTLY` it and retry.

## Rollback

There are no down migrations, so **rollback means restore**:

1. `dc stop app`
2. Restore the dump taken before the upgrade (see [Restore](#restore)).
3. `export LOGWELL_VERSION=<previous tag>` and run `dc up -d app`.

Logs ingested between the backup and the rollback are lost. Don't run an older image against a
database that newer migrations have changed: nothing stops it from starting, but its queries
assume the old schema.

## Postgres major upgrades

Postgres data directories aren't compatible across major versions. Move between majors with
`pg_dump` and `pg_restore` (or `pg_upgrade`), never by changing the `db` image tag on an existing
volume. The volume note in `compose.prod.yaml` covers the PostgreSQL 18 volume layout.
