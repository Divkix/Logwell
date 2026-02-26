# Codebase Concerns

**Analysis Date:** 2026-02-26

## Tech Debt

**Error Handler Redundancy:**
- Issue: `src/lib/server/error-handler.ts` lines 50-52 sanitize error messages, but the logic is not fully applied. Variable `clientMessage` always equals `message` regardless of status code (line 52: `const clientMessage = status >= 500 ? message : message;`)
- Files: `src/lib/server/error-handler.ts`
- Impact: 5xx errors could leak internal details to clients if not sanitized elsewhere. Security concern if error messages are passed through without additional scrubbing.
- Fix approach: Implement proper sanitization: `const clientMessage = status >= 500 ? 'An error occurred' : message;` or similar strategy to hide internal details in production errors

**Silent JSON Parse Failures:**
- Issue: In `src/lib/hooks/use-log-stream.svelte.ts` line 126, malformed SSE JSON is silently ignored with empty catch block. Failed log batches are dropped without logging or alerting.
- Files: `src/lib/hooks/use-log-stream.svelte.ts`
- Impact: Loss of real-time logs without user visibility. Debugging malformed data from servers is impossible. Silent failures hide network/encoding issues.
- Fix approach: Implement structured logging with unique request IDs. Log JSON parse failures with context (batch ID, project ID, attempt count) to separate logger or error tracker.

**Incident Auto-Resolve Inconsistency:**
- Issue: Incident status determination uses auto-resolve threshold (`INCIDENT_CONFIG.AUTO_RESOLVE_MINUTES`), but there's no mechanism to automatically update incident status in the database when the threshold is exceeded. Status only changes when a new log arrives. Old incidents remain marked as "open" indefinitely in stale projects.
- Files: `src/lib/server/utils/incidents.ts` (lines 176-183), `src/lib/server/jobs/cleanup-scheduler.ts`
- Impact: Incidents appear active in UI even when no logs have been received. Dashboard shows inflated "open incident" counts for idle projects.
- Fix approach: Add a periodic job to query and update incident statuses based on `lastSeen` timestamp and auto-resolve threshold (similar to `cleanupOldLogs` pattern).

**Unvalidated Project Name Uniqueness:**
- Issue: Project `name` field has a unique constraint in database (`src/lib/server/db/schema.ts` line 20), but if two users create projects simultaneously with the same name, the second request will fail with a database error (constraint violation) rather than a user-friendly message.
- Files: `src/lib/server/db/schema.ts`, `src/routes/api/projects/+server.ts`
- Impact: Confusing error responses to users. Database constraint errors are not caught or translated to client messages.
- Fix approach: Pre-check name uniqueness in the API handler before insert, or catch database unique constraint errors and return meaningful 400 response.

## Known Bugs

**Pagination Cursor State Reset Not Atomic:**
- Bug: When filters change in `src/routes/(app)/projects/[id]/+page.svelte` (line 178), `streamedLogs` is cleared but `loadedMoreLogs` state persists into the effect handler. If a user applies a filter while pagination load is in-flight, the new filter's logs will be mixed with the old pagination data.
- Symptoms: Wrong logs appear in the table after filtering with an active "Load More" pending request
- Files: `src/routes/(app)/projects/[id]/+page.svelte`
- Trigger: 1) Open a large project, 2) Click "Load More" to start fetching more logs, 3) Change a filter (search/level/time) while request is in-flight
- Workaround: Refresh the page to reset state
- Fix approach: Abort any pending `loadMore` fetch when `updateFilters()` is called. Set `isLoadingMore = false` and clear `loadedMoreLogs = []` to ensure clean state.

**New Log Highlight Timeout Leak:**
- Bug: In `src/routes/(app)/projects/[id]/+page.svelte` lines 114-116, highlight timeout is created but never cancelled when component unmounts or filters change. Multiple timeouts accumulate.
- Symptoms: Memory leak with timeout handlers. After viewing many logs, page becomes sluggish.
- Files: `src/routes/(app)/projects/[id]/+page.svelte`
- Trigger: Receive multiple log batches while on the logs page, then navigate away or change filters
- Workaround: Manual page refresh clears all pending timeouts
- Fix approach: Collect timeout IDs in a Set and clear all pending timeouts in the $effect cleanup function when `handleIncomingLogs` changes or component unmounts.

**SSE Listener Memory Leak on Disconnect:**
- Bug: In `src/lib/server/events.ts`, the event bus stores listeners in Map/Set structures. Listeners are only removed if explicitly unsubscribed. If a client disconnects without calling the unsubscribe function (network drop, browser crash), the listener remains in memory indefinitely.
- Symptoms: Memory grows over time in production. After many client connects/disconnects, listener count grows (visible via `getListenerCount`).
- Files: `src/lib/server/events.ts`, `src/routes/api/projects/[id]/logs/stream/+server.ts`
- Trigger: Open SSE stream and close browser tab abruptly without graceful disconnect
- Workaround: Server restart clears all listeners
- Fix approach: Add a timeout-based cleanup mechanism. Mark listeners with timestamp, and periodically remove stale listeners that haven't emitted or been confirmed active for >5 minutes.

## Security Considerations

**API Key Exposed in Project Name:**
- Risk: Project API key is included in paginated API responses for authenticated users (e.g., `GET /api/projects/[id]`). If a user's API key is leaked, they cannot rotate it without updating all downstream services immediately (API key regeneration happens, but logs old key).
- Files: `src/routes/(app)/projects/[id]/+page.svelte` (line 61), `src/routes/api/projects/[id]/+server.ts`
- Current mitigation: API key is not shown in plaintext UI after initial generation
- Recommendations:
  1. Never return full API key in GET responses. Return only a masked version (`lw_xxx...last4chars`).
  2. Only return full key once on initial generation, then require users to regenerate if lost.
  3. Add audit logging to track API key access and regeneration.

**Missing CORS Validation for Ingest Endpoints:**
- Risk: OTLP and simple ingest endpoints (`/v1/logs`, `/v1/ingest`) accept POST from any origin if the API key is valid. CORS headers not checked. A malicious website can POST logs to any project if it obtains the API key (stored in client code).
- Files: `src/routes/v1/ingest/+server.ts`, `src/routes/v1/logs/+server.ts`
- Current mitigation: API key is required, but key may be embedded in client SDKs or public dashboards
- Recommendations:
  1. Add CORS origin whitelist validation based on project settings
  2. Implement request origin logging for audit trails
  3. Add rate limiting per API key

**Incident Fingerprint Collision Risk:**
- Risk: Incident fingerprinting (`src/lib/server/utils/incident-fingerprint.unit.test.ts`) may generate collisions for very similar error messages across different services. If `serviceName` is null, two completely unrelated errors could match the same fingerprint.
- Files: `src/lib/server/utils/incident-fingerprint.ts` (not shown in reads, but referenced)
- Impact: Unrelated errors grouped under the same incident. Misleading root cause analysis.
- Recommendations:
  1. Include sourceFile + lineNumber in fingerprint calculation with stronger weighting
  2. Add fallback to content hash if service name is missing
  3. Implement incident merge/split functionality for users to manually correct grouping

## Performance Bottlenecks

**In-Memory Event Bus Unbounded Growth:**
- Problem: `src/lib/server/events.ts` stores all listeners in memory with no eviction. High-traffic projects with continuous SSE connections accumulate listener references.
- Files: `src/lib/server/events.ts`
- Cause: Listeners are only removed on explicit disconnect. Network interruptions or client crashes leave stale listeners.
- Improvement path:
  1. Add timestamp tracking to listeners
  2. Implement periodic cleanup (every 5 minutes) to remove listeners not accessed in >2 minutes
  3. Add metrics to track listener growth (log warnings when exceeding thresholds)

**Database Query N+1 Risk in Incident Updates:**
- Problem: `src/lib/server/utils/incidents.ts` lines 213-217 fetch all existing incidents by fingerprint, then upsert each one individually in a loop (lines 223-269). For 1000 new incidents, this is 1 SELECT + 1000 UPDATE queries.
- Files: `src/lib/server/utils/incidents.ts`
- Cause: Batch incident creation was not implemented. Current loop pattern works but scales poorly.
- Improvement path:
  1. Use PostgreSQL UPSERT (`INSERT ... ON CONFLICT ... DO UPDATE`) in a single batch query
  2. Reduce from 1001 queries to 2 queries (SELECT to check existence, single UPSERT)
  3. Benchmark: expect 100x improvement for large log batches

**Unindexed Metadata Search:**
- Problem: Log metadata is stored as JSONB (`src/lib/server/db/schema.ts` line 99) but has no GIN or GIST index. Full-text search queries may scan entire log table.
- Files: `src/lib/server/db/schema.ts`
- Cause: Metadata structure is dynamic and user-defined, making indexing complex. No @> or @@ operator indexes defined.
- Improvement path:
  1. Add `index('idx_log_metadata').on(table.metadata)` using default BTREE (limited benefit)
  2. For better search, migrate metadata to separate normalized table (breaking change)
  3. Add PostgreSQL generated column for frequently-searched metadata keys

**Full-Text Search on Message Field Only:**
- Problem: `src/lib/server/utils/search.ts` only searches the `message` field using tsvector. Metadata, service names, and other fields are not searchable. Users cannot find logs by traceId or other metadata.
- Files: `src/lib/server/utils/search.ts`
- Cause: tsvector is generated for message only. No composite index across multiple fields.
- Improvement path:
  1. Extend tsvector generation to include metadata keys (if feasible) or service name
  2. Add separate indexed columns for common metadata (traceId, userId, etc.)
  3. Document search limitations for users

## Fragile Areas

**SSE Stream Parsing State Machine:**
- Files: `src/lib/hooks/use-log-stream.svelte.ts`
- Why fragile: The SSE event parser (lines 91-115) uses a stateful line-by-line parser with manual event/data field tracking. If multi-line data payloads are sent or CRLF line endings are used instead of LF, the parser may split events incorrectly or lose data.
- Safe modification:
  1. Add unit tests for edge cases (CRLF, empty lines, malformed headers)
  2. Use a battle-tested SSE parser library instead of custom implementation
  3. Add fuzzing tests with malformed SSE data
- Test coverage: No test for SSE parser logic currently visible in codebase

**Concurrent Filter Updates and Stream State:**
- Files: `src/routes/(app)/projects/[id]/+page.svelte`
- Why fragile: Multiple state updates happen when filters change (clear streamed logs, reset pagination, update URL). If a new log arrives during filter update, it may be added to the wrong state tree or lost.
- Safe modification:
  1. Use a queue to buffer incoming logs during filter transitions
  2. Disable stream updates during navigation with `isNavigating` check
  3. Add invariant checks in tests to ensure log deduplication
- Test coverage: E2E tests needed for race condition scenarios

**Incident Status Computation with Stale Data:**
- Files: `src/lib/server/utils/incidents.ts`
- Why fragile: `getIncidentStatus()` is called at query time but relies on `lastSeen` timestamp. If a project hasn't ingested logs in weeks, all incidents will be marked as "resolved" even though they should be "auto-resolved" pending status update.
- Safe modification:
  1. Add migration job to backfill incident `status` column (currently missing from schema)
  2. Implement background job to update status before returning to API
  3. Add database-computed status column using generated column feature
- Test coverage: Unit tests exist but don't cover stale incident scenarios

## Scaling Limits

**In-Memory Log Cache Per Browser:**
- Current capacity: `DEFAULT_MAX_LOGS = 1000` per tab/client (`src/lib/stores/logs.svelte.ts` line 34)
- Limit: Browser memory exhaustion if user views very active project (1000 logs * ~1KB per log = ~1MB per tab). Multiple tabs multiply this.
- Scaling path:
  1. Add virtual scrolling to render only visible logs (use Svelte component like `svelte-window`)
  2. Reduce `maxLogs` default to 500 or make user-configurable
  3. Implement periodic pruning of oldest logs beyond viewport

**PostgreSQL Connection Pool Exhaustion:**
- Current capacity: Determined by `postgres-js` default pool size (not visible in codebase, likely 10-25 connections)
- Limit: High-concurrency deployments may exhaust connections during log ingestion + SSE + dashboard queries simultaneously
- Scaling path:
  1. Explicit configure pool size in `src/lib/server/db/index.ts`
  2. Add connection metrics/monitoring (via Prometheus or datadog)
  3. Implement query queue or circuit breaker for ingest during peaks

**SSE Listener Count per Project:**
- Current capacity: Unbounded (Map/Set in memory)
- Limit: With 10,000 concurrent users on one project, 10,000 listener callbacks fire on every log. Event loop becomes blocked.
- Scaling path:
  1. Batch emit with microtask queue to prevent blocking
  2. Implement selective listener subscription (e.g., subscribe only to logs matching a filter)
  3. Switch to external event bus (Redis pub/sub) for multi-server deployments

**Log Retention Without Partitioning:**
- Current capacity: Single `log` table with no partitioning. Scanning a project with 1M+ logs becomes slow.
- Limit: Query performance degrades as table grows. Full-text search on large projects becomes O(n).
- Scaling path:
  1. Implement table partitioning by `projectId` + time range (monthly partitions)
  2. Archive old logs to cold storage (S3) with retention policy
  3. Add materialized views for project-level stats (log count per level)

## Dependencies at Risk

**Better-Auth (Planned but Not Integrated):**
- Risk: CLAUDE.md mentions "better-auth (planned)" but authentication is implemented with custom session logic. If better-auth integration begins, custom session code in `src/lib/server/session.ts` and `hooks.server.ts` may have conflicts or duplicate logic.
- Impact: Code duplication, maintenance burden, security inconsistencies
- Migration plan:
  1. Document current auth flow in session.ts
  2. Audit better-auth before integration to ensure no breaking changes
  3. Plan gradual migration with feature flags

**Drizzle ORM Query Type Safety Gaps:**
- Risk: Some queries use `sql` template strings (`src/lib/server/db/schema.ts` line 1) which bypass type checking. Type-unsafe queries could break at runtime.
- Impact: Runtime SQL errors not caught by TypeScript
- Migration plan:
  1. Audit all `sql()` usages for type safety
  2. Replace with Drizzle query builder where possible
  3. Add test coverage for dynamic query generation

## Missing Critical Features

**No Audit Logging:**
- Problem: No tracking of who accessed which projects or when API keys were regenerated. Compliance/security audits are not possible.
- Blocks: Security incident investigation, compliance reporting (SOC 2, etc.)
- Recommendation: Implement audit table with user action tracking (project access, API key regeneration, retention settings changes)

**No Incident Assignment or Escalation:**
- Problem: Incidents are auto-grouped but have no owner, priority, or escalation mechanism. No integration with PagerDuty, Slack, etc.
- Blocks: Operational use of incidents for alert management
- Recommendation: Add incident owner field and webhook integration for external notifications

**No Multi-Project Log Export:**
- Problem: Export only works per-project. Users cannot correlate logs across projects or get unified reports.
- Blocks: Debugging distributed system issues
- Recommendation: Add bulk export with project filtering, or unified search across all user projects

## Test Coverage Gaps

**SSE Event Parsing Edge Cases:**
- What's not tested: Malformed SSE (multiline payloads, CRLF vs LF, missing event/data pairs)
- Files: `src/lib/hooks/use-log-stream.svelte.ts`
- Risk: Silent data loss if SSE server sends non-standard formatting
- Priority: Medium

**Concurrent Filter Changes During SSE Stream:**
- What's not tested: Applying filters while SSE logs are arriving. Race condition scenarios.
- Files: `src/routes/(app)/projects/[id]/+page.svelte`
- Risk: Logs from old filter state mixed with new results. Data corruption in UI state.
- Priority: High (affects critical user path)

**API Key Exposure in Errors:**
- What's not tested: Error responses don't accidentally include API keys or sensitive header values
- Files: `src/lib/server/error-handler.ts`, `src/routes/api/**`
- Risk: Secrets leaked in error logs or responses
- Priority: High (security)

**Incident Fingerprint Uniqueness Across Services:**
- What's not tested: Different services/source files producing identical fingerprints
- Files: `src/lib/server/utils/incident-fingerprint.unit.test.ts` (exists but coverage unknown)
- Risk: False incident grouping
- Priority: Medium

**Log Cleanup Job Robustness:**
- What's not tested: Cleanup job behavior during concurrent log ingestion. Database constraint violations if old logs are referenced by incidents.
- Files: `src/lib/server/jobs/log-cleanup.ts`, `src/lib/server/jobs/cleanup-scheduler.ts`
- Risk: Data loss or cleanup failures
- Priority: Medium (data integrity)

**Memory Leak in Event Bus Under Load:**
- What's not tested: Listener accumulation under sustained high concurrency (10k+ concurrent users)
- Files: `src/lib/server/events.ts`
- Risk: Memory exhaustion and server crash
- Priority: High (affects production stability)

---

*Concerns audit: 2026-02-26*
