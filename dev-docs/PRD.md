# sv-logger: Product Requirements Document

> A personal, high-performance logging platform with a clean, minimal interface.

---

## Table of Contents

1. [Overview](#overview)
2. [Design Philosophy](#design-philosophy)
3. [Core Features](#core-features)
4. [Database Schema](#database-schema)
5. [API Specification](#api-specification)
6. [UI/UX Specification](#uiux-specification)
7. [Real-time Architecture](#real-time-architecture)
8. [Full-Text Search](#full-text-search)
9. [Authentication & Security](#authentication--security)
10. [File Structure](#file-structure)
11. [Dependencies](#dependencies)
12. [Environment Variables](#environment-variables)
13. [Performance Considerations](#performance-considerations)

---

## Overview

**sv-logger** is a self-hosted logging platform designed for personal use across multiple projects. It provides:

- A simple HTTP API for log ingestion (single and batch)
- A real-time dashboard to monitor logs as they arrive
- Full-text search across all log fields
- Per-project organization with API key authentication
- Clean, minimal UI that prioritizes readability and speed

### Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | SvelteKit (adapter-node) |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Auth | better-auth |
| UI Components | shadcn-svelte |
| Styling | Tailwind CSS v4 |
| Real-time | Server-Sent Events (sveltekit-sse) |
| Runtime | Bun |

---

## Design Philosophy

### The Apple Standard

The UI must embody the design principles that Steve Jobs championed. This is not about copying Apple's aesthetic—it's about adopting the relentless focus on simplicity, clarity, and purposeful design.

#### Core Principles

**1. Simplicity Through Reduction**

Every element must justify its existence. If it doesn't serve a clear purpose, it doesn't belong.

- No decorative elements that don't aid comprehension
- No gratuitous animations or transitions (only functional ones)
- No feature bloat—do fewer things, but do them perfectly
- No visual noise: borders, shadows, and dividers used sparingly

**2. Typography as Interface**

Text is the primary interface element. It must be:

- Highly legible at all sizes
- Hierarchically clear (you instantly know what's most important)
- Generously spaced (whitespace is not wasted space)
- System font stack for native feel: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

**3. Invisible Complexity**

The system may be complex internally, but the user sees only simplicity.

- Advanced features accessible but not prominent
- Progressive disclosure: show basics first, details on demand
- Sensible defaults that rarely need changing
- Error states that guide, not blame

**4. Purposeful Color**

Color is information, not decoration.

- Monochromatic base (grays, near-blacks, whites)
- Color reserved for semantic meaning:
  - Log levels (debug=muted, info=blue, warn=amber, error=red, fatal=purple)
  - Interactive elements (primary actions)
  - Status indicators (success, failure)
- Dark mode as first-class citizen, not an afterthought

**5. Density Without Clutter**

Logs are data-dense by nature. The UI must handle density gracefully.

- Compact rows that don't feel cramped
- Consistent alignment creates visual rhythm
- Monospace for log content (data), proportional for UI chrome
- Horizontal space used efficiently—no excessive padding

**6. Instant Feedback**

Every interaction must feel immediate and responsive.

- Optimistic UI updates
- Loading states that appear instantly (skeleton, not spinner)
- Transitions under 200ms
- No layout shifts during loading

#### Visual Language

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Background (Dark)    : hsl(0, 0%, 4%)      — Near black       │
│   Background (Light)   : hsl(0, 0%, 100%)    — Pure white       │
│                                                                 │
│   Surface (Dark)       : hsl(0, 0%, 7%)      — Elevated         │
│   Surface (Light)      : hsl(0, 0%, 98%)     — Subtle gray      │
│                                                                 │
│   Border (Dark)        : hsl(0, 0%, 15%)     — Barely visible   │
│   Border (Light)       : hsl(0, 0%, 90%)     — Subtle           │
│                                                                 │
│   Text Primary (Dark)  : hsl(0, 0%, 95%)     — Almost white     │
│   Text Primary (Light) : hsl(0, 0%, 9%)      — Almost black     │
│                                                                 │
│   Text Muted (Dark)    : hsl(0, 0%, 55%)     — De-emphasized    │
│   Text Muted (Light)   : hsl(0, 0%, 45%)     — De-emphasized    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Spacing Scale

Use a consistent 4px base unit:

```
4px   — Micro (icon padding, badge padding)
8px   — Tight (related elements)
12px  — Base (standard gap)
16px  — Comfortable (section padding)
24px  — Loose (card padding)
32px  — Spacious (page margins)
48px  — Generous (section breaks)
```

#### Typography Scale

```
12px  — Caption (timestamps, metadata labels)
13px  — Small (secondary info, log metadata)
14px  — Body (log messages, form labels)
16px  — Large body (project names)
20px  — Heading 3 (section titles)
24px  — Heading 2 (page titles)
32px  — Heading 1 (rarely used, hero only)
```

#### Motion

- **Duration**: 150ms for micro-interactions, 200ms for transitions
- **Easing**: `cubic-bezier(0.4, 0, 0.2, 1)` (Material's standard easing)
- **What animates**: Opacity, transform (scale, translate). Never animate layout properties.
- **When to animate**: State changes (hover, focus, open/close). Never animate on load.

---

## Core Features

### Project Management

| Feature | Description |
|---------|-------------|
| Create project | Name (unique, user-chosen) → generates API key |
| List projects | Cards showing name, log count, last activity |
| Delete project | Confirmation required, cascades all logs |
| Regenerate API key | Invalidates old key immediately |
| Copy API key | One-click copy with toast confirmation |

### Log Ingestion

| Feature | Description |
|---------|-------------|
| OTLP/HTTP JSON | `POST /v1/logs` with OTLP JSON payload |
| Auto-timestamp | Server assigns `timestamp` if not provided |
| Validation | Level must be valid enum, message required |
| Rate handling | 300/s burst, 50-75/s sustained |

### Log Viewing

| Feature | Description |
|---------|-------------|
| Live stream | SSE-powered real-time updates (toggle on/off) |
| Manual refresh | Reload button when live mode is off |
| Log count selector | Choose 100, 200, 300, 400, or 500 logs |
| Level filter | Filter by debug/info/warn/error/fatal |
| Full-text search | Search message and metadata (pauses live mode) |
| Log detail modal | Click row to see all fields in formatted view |
| Timestamp display | Absolute format, local timezone |
| Relative filters | "Last 15 min", "Last hour", "Last 24h", "Last 7d" |

### Statistics

| Feature | Description |
|---------|-------------|
| Level distribution | Pie chart showing % of each log level |
| Per-project scope | Stats scoped to selected project |

### Authentication

| Feature | Description |
|---------|-------------|
| Admin login | Fixed username "admin", password from env |
| Session duration | 30 minutes |
| No registration | Single-user system |

---

## Database Schema

### Enum: log_level

```sql
CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error', 'fatal');
```

### Table: project

Stores project metadata and API credentials.

```sql
CREATE TABLE project (
  id          TEXT PRIMARY KEY,              -- nanoid, e.g., "proj_V1StGXR8_Z5j"
  name        TEXT NOT NULL UNIQUE,          -- user-chosen, e.g., "my-backend"
  api_key     TEXT NOT NULL UNIQUE,          -- "svl_" + nanoid(32)
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_project_api_key ON project (api_key);
```

### Table: log

Stores individual log entries with full-text search support.

```sql
CREATE TABLE log (
  id           TEXT PRIMARY KEY,             -- nanoid
  project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  level        log_level NOT NULL,
  message      TEXT NOT NULL,
  metadata     JSONB,                        -- free-form JSON
  source_file  TEXT,                         -- e.g., "src/api/users.ts"
  line_number  INTEGER,                      -- e.g., 142
  request_id   TEXT,                         -- e.g., "req_abc123"
  user_id      TEXT,                         -- app-specific user identifier
  ip_address   TEXT,                         -- e.g., "192.168.1.1"
  timestamp    TIMESTAMPTZ DEFAULT NOW(),

  -- Generated column for full-text search
  search       TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', message), 'A') ||
    setweight(to_tsvector('english', COALESCE(metadata::text, '')), 'B')
  ) STORED
);

-- Performance indexes
CREATE INDEX idx_log_project_id ON log (project_id);
CREATE INDEX idx_log_timestamp ON log (timestamp DESC);
CREATE INDEX idx_log_level ON log (level);
CREATE INDEX idx_log_project_timestamp ON log (project_id, timestamp DESC);
CREATE INDEX idx_log_search ON log USING GIN (search) WITH (fastupdate = on);
```

> **Note on `fastupdate`**: GIN indexes are powerful for reads but heavy for writes. At 300 logs/s burst, index updates could spike CPU. The `fastupdate` option buffers index entries and bulk-inserts them, significantly improving write performance.

### Tables: better-auth (auto-generated)

These tables are managed by better-auth and generated via CLI:

```sql
-- user: id, name, email, emailVerified, image, createdAt, updatedAt
-- session: id, expiresAt, ipAddress, userAgent, userId
-- account: id, accountId, providerId, userId, accessToken, refreshToken, idToken, expiresAt, password
-- verification: id, identifier, value, expiresAt
```

### Drizzle Schema (TypeScript)

```typescript
// src/lib/server/db/schema.ts

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  pgEnum,
  customType,
} from 'drizzle-orm/pg-core';

// Custom tsvector type
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// Log level enum
export const logLevelEnum = pgEnum('log_level', [
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]);

// Project table
export const project = pgTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  apiKey: text('api_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_project_api_key').on(table.apiKey),
]);

// Log table
export const log = pgTable('log', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  level: logLevelEnum('level').notNull(),
  message: text('message').notNull(),
  metadata: jsonb('metadata'),
  sourceFile: text('source_file'),
  lineNumber: integer('line_number'),
  requestId: text('request_id'),
  userId: text('user_id'),
  ipAddress: text('ip_address'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
  search: tsvector('search').generatedAlwaysAs(
    sql`setweight(to_tsvector('english', ${log.message}), 'A') || setweight(to_tsvector('english', COALESCE(${log.metadata}::text, '')), 'B')`
  ),
}, (table) => [
  index('idx_log_project_id').on(table.projectId),
  index('idx_log_timestamp').on(table.timestamp),
  index('idx_log_level').on(table.level),
  index('idx_log_project_timestamp').on(table.projectId, table.timestamp),
  index('idx_log_search').using('gin', table.search),
]);

// Type exports
export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;
export type Log = typeof log.$inferSelect;
export type NewLog = typeof log.$inferInsert;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
```

---

## API Specification

### Authentication

**Dashboard routes**: Session cookie (managed by better-auth)

**Log ingestion routes**: Bearer token in Authorization header

```
Authorization: Bearer svl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Endpoints

#### Log Ingestion (Public, API Key Auth)

##### POST /v1/logs

Ingest logs via OTLP/HTTP JSON (OpenTelemetry Protocol).

**Headers:**
```
Authorization: Bearer svl_xxxxx
Content-Type: application/json
```

**Request Body:**
```json
{
  "resourceLogs": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "my-service" } }
        ]
      },
      "scopeLogs": [
        {
          "scope": { "name": "sv-logger" },
          "logRecords": [
            {
              "severityNumber": 17,
              "severityText": "ERROR",
              "body": { "stringValue": "Database connection failed" },
              "attributes": [
                { "key": "request.id", "value": { "stringValue": "req_abc123" } }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

**Response (200 OK):**
```json
{}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "validation_error",
  "message": "resourceLogs must be an array."
}
```

**Error Response (401 Unauthorized):**
```json
{
  "error": "unauthorized",
  "message": "Invalid or missing API key"
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "validation_error",
  "message": "Batch size exceeds maximum of 100 logs"
}
```

---

#### Project Management (Dashboard Auth Required)

##### GET /api/projects

List all projects.

**Response (200 OK):**
```json
{
  "projects": [
    {
      "id": "proj_abc",
      "name": "my-backend",
      "api_key": "svl_xxxx...xxxx",
      "created_at": "2024-01-10T10:00:00Z",
      "updated_at": "2024-01-15T14:00:00Z",
      "log_count": 15420
    }
  ]
}
```

##### POST /api/projects

Create a new project.

**Request Body:**
```json
{
  "name": "my-new-project"
}
```

**Response (201 Created):**
```json
{
  "id": "proj_xyz",
  "name": "my-new-project",
  "api_key": "svl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "created_at": "2024-01-15T14:35:00Z"
}
```

##### GET /api/projects/[id]

Get project details.

**Response (200 OK):**
```json
{
  "id": "proj_abc",
  "name": "my-backend",
  "api_key": "svl_xxxx...xxxx",
  "created_at": "2024-01-10T10:00:00Z",
  "log_count": 15420,
  "level_counts": {
    "debug": 5000,
    "info": 8000,
    "warn": 1500,
    "error": 900,
    "fatal": 20
  }
}
```

##### DELETE /api/projects/[id]

Delete a project and all its logs.

**Response (204 No Content)**

##### POST /api/projects/[id]/regenerate

Regenerate the API key for a project.

**Response (200 OK):**
```json
{
  "api_key": "svl_new_key_xxxxxxxxxxxxxxxxxxxxxxxx"
}
```

---

#### Log Queries (Dashboard Auth Required)

##### GET /api/projects/[id]/logs

Query logs with pagination and filters.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| limit | number | 100 | Logs per page (100-500) |
| offset | number | 0 | Pagination offset |
| level | string | - | Filter by level (comma-separated) |
| search | string | - | Full-text search query |
| from | string | - | Start timestamp (ISO 8601) |
| to | string | - | End timestamp (ISO 8601) |

**Example:**
```
GET /api/projects/proj_abc/logs?limit=100&level=error,fatal&search=database&from=2024-01-15T00:00:00Z
```

**Response (200 OK):**
```json
{
  "logs": [
    {
      "id": "log_xyz",
      "level": "error",
      "message": "Database connection failed",
      "metadata": { "db": "users" },
      "source_file": "src/db.ts",
      "line_number": 45,
      "request_id": "req_123",
      "user_id": null,
      "ip_address": "10.0.0.1",
      "timestamp": "2024-01-15T14:32:05.123Z"
    }
  ],
  "total": 1520,
  "has_more": true
}
```

##### POST /api/projects/[id]/logs/stream

Server-Sent Events endpoint for real-time logs.

**Request Body:**
```json
{
  "level": ["error", "fatal"],
  "search": null
}
```

**SSE Response:**
```
event: log
data: {"id":"log_xyz","level":"error","message":"Connection timeout",...}

event: log
data: {"id":"log_abc","level":"fatal","message":"Out of memory",...}

event: heartbeat
data: {"timestamp":"2024-01-15T14:32:10Z"}
```

##### GET /api/projects/[id]/stats

Get log level distribution for charts.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| from | string | 24h ago | Start timestamp |
| to | string | now | End timestamp |

**Response (200 OK):**
```json
{
  "total": 15420,
  "levels": {
    "debug": { "count": 5000, "percentage": 32.4 },
    "info": { "count": 8000, "percentage": 51.9 },
    "warn": { "count": 1500, "percentage": 9.7 },
    "error": { "count": 900, "percentage": 5.8 },
    "fatal": { "count": 20, "percentage": 0.1 }
  }
}
```

---

## UI/UX Specification

### Pages

#### 1. Login Page (`/login`)

**Purpose:** Authenticate the admin user.

**Layout:**
- Centered card on a minimal background
- Logo/app name at top
- Username field (pre-filled with "admin", read-only)
- Password field (focus on load)
- "Sign in" button
- No "forgot password" (single-user, reset via env)

**States:**
- Default: Form ready
- Loading: Button shows spinner, inputs disabled
- Error: Inline error message below form (red text, no alert box)

**Behavior:**
- Enter key submits form
- Redirect to `/` on success
- No "remember me" for v1

---

#### 2. Dashboard / Project List (`/`)

**Purpose:** Overview of all projects, create new ones.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo] sv-logger                              [Theme] [Logout] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Projects                                      [+ New Project]  │
│                                                                 │
│  ┌─────────────────────────┐  ┌─────────────────────────┐       │
│  │  my-backend             │  │  payment-service        │       │
│  │                         │  │                         │       │
│  │  15,420 logs            │  │  3,201 logs             │       │
│  │  Last log: 2 min ago    │  │  Last log: 1 hour ago   │       │
│  │                         │  │                         │       │
│  │  [View Logs]            │  │  [View Logs]            │       │
│  └─────────────────────────┘  └─────────────────────────┘       │
│                                                                 │
│  ┌─────────────────────────┐                                    │
│  │  frontend-app           │                                    │
│  │                         │                                    │
│  │  892 logs               │                                    │
│  │  Last log: 3 days ago   │                                    │
│  │                         │                                    │
│  │  [View Logs]            │                                    │
│  └─────────────────────────┘                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- Header: Logo, theme toggle (sun/moon icon), logout button
- Section title with "New Project" button
- Project cards in responsive grid (1 col mobile, 2-3 cols desktop)
- Each card: name, log count, relative last activity, "View Logs" button
- Empty state: Illustration + "Create your first project" CTA

**Interactions:**
- Click card → navigate to `/projects/[id]`
- Click "New Project" → modal with name input
- Hover card → subtle elevation/border change

---

#### 3. Project Detail / Log Stream (`/projects/[id]`)

**Purpose:** View and search logs for a specific project.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  [<] Back    my-backend                    [Settings] [Logout]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ [Search logs...]                          [All Levels ▼]│    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Showing 100 ▼ logs    [15m] [1h] [24h] [7d]   [Live ●] [↻]    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ TIME         LEVEL   MESSAGE                            │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │ 14:32:05.123 ERROR   Database connection failed         │ ←  │
│  │ 14:32:04.892 INFO    Request completed in 45ms          │    │
│  │ 14:32:04.100 DEBUG   Cache hit for key user:123         │    │
│  │ 14:32:03.950 WARN    Rate limit approaching (80%)       │    │
│  │ 14:32:03.201 INFO    User user_456 logged in            │    │
│  │ 14:32:02.888 ERROR   Failed to send email               │    │
│  │ ...                                                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Showing 100 of 15,420 logs                    [Load More]      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**

1. **Header Bar**
   - Back button (←) to dashboard
   - Project name (h1)
   - Settings button (opens project settings modal)
   - Logout button

2. **Search & Filter Bar**
   - Search input (full-width, magnifying glass icon)
   - Level dropdown (multi-select: All, Debug, Info, Warn, Error, Fatal)

3. **Controls Bar**
   - Log count selector: dropdown with 100, 200, 300, 400, 500
   - Time range pills: 15m, 1h, 24h, 7d (quick filters)
   - Live toggle: Switch with green dot when active
   - Refresh button: Only visible when live is OFF

4. **Log Table**
   - Fixed header row
   - Timestamp column: `HH:mm:ss.SSS` format
   - Level column: Colored badge
   - Message column: Truncated with ellipsis, monospace font
   - Rows are clickable → opens detail modal
   - Alternating row backgrounds (subtle)
   - New logs animate in from top (fade + slide)

5. **Footer**
   - Total count: "Showing X of Y logs"
   - Load More button (infinite scroll alternative)

**States:**
- Loading: Skeleton rows (5-10 rows)
- Empty: "No logs yet" with project API key display
- Empty (filtered): "No logs match your filters"
- Live active: Green pulse on toggle, new logs slide in
- Search active: Live paused, "Live paused during search" notice

---

#### 4. Log Detail Modal

**Purpose:** Show all fields of a single log entry.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                            [×]  │
│  Log Details                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ID            log_V1StGXR8_Z5jdHi                       [📋]   │
│                                                                 │
│  Timestamp     January 15, 2024 at 14:32:05.123 PST             │
│                                                                 │
│  Level         ● ERROR                                          │
│                                                                 │
│  Message                                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Database connection failed after 3 retries              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Source        src/db/connection.ts:45                   [📋]   │
│                                                                 │
│  Request ID    req_abc123def456                          [📋]   │
│                                                                 │
│  User ID       user_789                                  [📋]   │
│                                                                 │
│  IP Address    192.168.1.100                             [📋]   │
│                                                                 │
│  Metadata                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ {                                                       │    │
│  │   "database": "users_db",                               │    │
│  │   "error_code": "ECONNREFUSED",                         │    │
│  │   "retry_count": 3,                                     │    │
│  │   "last_error": "Connection timed out"                  │    │
│  │ }                                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- Modal overlay (click outside or × to close)
- Field labels: muted color, small text
- Field values: primary color, regular text
- Copy buttons: clipboard icon, shows "Copied!" toast on click
- Message: Full text in bordered box, scrollable if long
- Metadata: Syntax-highlighted JSON in bordered box
- Empty fields: Show "—" (em dash) instead of hiding

**Behavior:**
- Escape key closes modal
- Copy buttons copy raw value (no formatting)
- JSON is pretty-printed with 2-space indent

---

#### 5. Project Settings Modal

**Purpose:** Manage project API key and danger zone.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  Project Settings                                          [×]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  API Key                                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ svl_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│  [📋 Copy]  [↻ Regenerate]                                      │
│                                                                 │
│  OTLP/HTTP Example                                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ curl -X POST https://your-domain.com/v1/logs \          │    │
│  │   -H "Authorization: Bearer svl_aBcD..." \              │    │
│  │   -H "Content-Type: application/json" \                 │    │
│  │   -d '{"resourceLogs":[{"scopeLogs":[{"logRecords":...}]}}]}'│    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  Danger Zone                                                    │
│                                                                 │
│  [Delete Project]                                               │
│  This will permanently delete the project and all 15,420 logs.  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Behavior:**
- Regenerate: Confirmation dialog, then shows new key
- Delete: Type project name to confirm, then redirect to dashboard
- Copy: Toast "Copied to clipboard"

---

#### 6. Charts / Stats Page (`/projects/[id]/stats`)

**Purpose:** Visual breakdown of log levels.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  [<] Back    my-backend › Stats                        [Logout] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Log Level Distribution                                         │
│  Last 24 hours    [15m] [1h] [24h] [7d] [All Time]             │
│                                                                 │
│         ┌─────────────────────────────────┐                     │
│         │                                 │                     │
│         │           ████████              │                     │
│         │        ████████████             │                     │
│         │      ██████████████████         │  ● Debug   32.4%    │
│         │    ████████████████████████     │  ● Info    51.9%    │
│         │   ██████████████████████████    │  ● Warn     9.7%    │
│         │    ████████████████████████     │  ● Error    5.8%    │
│         │      ██████████████████         │  ● Fatal    0.1%    │
│         │        ████████████             │                     │
│         │           ████████              │                     │
│         │                                 │                     │
│         └─────────────────────────────────┘                     │
│                                                                 │
│  Total logs: 15,420                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- Breadcrumb navigation
- Time range selector (pills)
- Donut chart with legend
- Total count below chart

**Chart Colors:**
- Debug: `hsl(215, 15%, 50%)` — muted blue-gray
- Info: `hsl(210, 100%, 50%)` — blue
- Warn: `hsl(45, 100%, 50%)` — amber
- Error: `hsl(0, 85%, 55%)` — red
- Fatal: `hsl(270, 70%, 55%)` — purple

---

### Responsive Behavior

#### Breakpoints

```
sm:  640px   — Mobile landscape
md:  768px   — Tablet portrait
lg:  1024px  — Tablet landscape / small desktop
xl:  1280px  — Desktop
2xl: 1536px  — Large desktop
```

#### Mobile Adaptations

- **Dashboard**: Single column project cards
- **Log Stream**:
  - Horizontal scroll on table OR
  - Card-based layout (each log as a card)
  - Filters collapse into a "Filters" button → sheet/drawer
- **Log Detail**: Full-screen modal instead of centered
- **Navigation**: Hamburger menu or bottom nav

---

## Real-time Architecture

### Overview

Real-time log streaming uses Server-Sent Events (SSE) for unidirectional server-to-client communication. This is simpler and more appropriate than WebSockets for this use case.

### Design Decision: In-Memory vs pg_notify

**Why NOT pg_notify for single-instance:**

The naive approach (INSERT → pg_notify trigger → SSE listener queries DB) has a critical flaw:
- Batch insert 100 logs → 100 `pg_notify` events fire
- Each event triggers a `findFirst` query to fetch the full log
- Result: You DDoS your own database during high-volume ingestion

**Solution: In-memory event bus for single-instance deployment.**

The API endpoint writes to the database AND pushes to an in-memory channel. SSE endpoints subscribe to that channel. Zero extra database queries for real-time.

> **Future multi-instance support**: If scaling to multiple server instances, introduce Redis Pub/Sub or PostgreSQL `pg_notify` (with full payload, not just ID) at that point.

### Flow (Single Instance)

```
┌─────────────┐                              ┌─────────────────┐
│   Client    │  POST /v1/logs               │   API Route     │
│  (Logger)   │ ────────────────────────────►│                 │
└─────────────┘                              └────────┬────────┘
                                                      │
                                    ┌─────────────────┼─────────────────┐
                                    │                 │                 │
                                    ▼                 ▼                 │
                           ┌─────────────┐   ┌───────────────┐          │
                           │  PostgreSQL │   │  In-Memory    │          │
                           │   INSERT    │   │  Event Bus    │          │
                           └─────────────┘   └───────┬───────┘          │
                                                     │                  │
                              emit('log', data)      │                  │
                    ┌────────────────────────────────┼──────────────────┤
                    │                                │                  │
                    ▼                                ▼                  ▼
           ┌─────────────────┐              ┌─────────────────┐  (other listeners)
           │  SSE Stream 1   │              │  SSE Stream 2   │
           │  (project: A)   │              │  (project: A)   │
           └─────────────────┘              └─────────────────┘
```

### Implementation

#### In-Memory Event Bus

```typescript
// src/lib/server/events.ts

import { EventEmitter } from 'events';
import type { Log } from './db/schema';

// Singleton event bus
class LogEventBus extends EventEmitter {
  private static instance: LogEventBus;

  private constructor() {
    super();
    // Increase max listeners for many SSE connections
    this.setMaxListeners(1000);
  }

  static getInstance(): LogEventBus {
    if (!LogEventBus.instance) {
      LogEventBus.instance = new LogEventBus();
    }
    return LogEventBus.instance;
  }

  emitLog(projectId: string, log: Log): void {
    this.emit(`log:${projectId}`, log);
  }

  onLog(projectId: string, callback: (log: Log) => void): () => void {
    const event = `log:${projectId}`;
    this.on(event, callback);
    return () => this.off(event, callback);
  }
}

export const logEventBus = LogEventBus.getInstance();
```

#### Log Ingestion (writes to DB + emits to bus)

```typescript
// src/routes/v1/logs/+server.ts

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { log } from '$lib/server/db/schema';
import { logEventBus } from '$lib/server/events';
import { validateApiKey } from '$lib/server/utils/api-key';
import { nanoid } from 'nanoid';

export async function POST({ request }) {
  const projectId = await validateApiKey(request); // throws on invalid

  const body = await request.json();

  const newLog = {
    id: nanoid(),
    projectId,
    level: body.level,
    message: body.message,
    metadata: body.metadata ?? null,
    sourceFile: body.source_file ?? null,
    lineNumber: body.line_number ?? null,
    requestId: body.request_id ?? null,
    userId: body.user_id ?? null,
    ipAddress: body.ip_address ?? null,
    timestamp: new Date(),
  };

  // Insert into database
  const [inserted] = await db.insert(log).values(newLog).returning();

  // Push to in-memory event bus (for SSE subscribers)
  logEventBus.emitLog(projectId, inserted);

  return json({ id: inserted.id, timestamp: inserted.timestamp }, { status: 201 });
}
```

#### SSE Endpoint

```typescript
// src/routes/api/projects/[id]/logs/stream/+server.ts

import { produce } from 'sveltekit-sse';
import { logEventBus } from '$lib/server/events';
import type { Log } from '$lib/server/db/schema';

export function POST({ params }) {
  const projectId = params.id;

  return produce(async function start({ emit, lock }) {
    // Buffer for batching (prevents UI thrashing at high volume)
    let batch: Log[] = [];
    let flushTimeout: NodeJS.Timeout | null = null;

    const flushBatch = () => {
      if (batch.length > 0) {
        const { error } = emit('logs', JSON.stringify(batch));
        if (error) {
          lock.set(false); // Close connection on error
        }
        batch = [];
      }
      flushTimeout = null;
    };

    // Subscribe to in-memory event bus
    const unsubscribe = logEventBus.onLog(projectId, (log: Log) => {
      batch.push(log);

      // Batch logs for 1.5 seconds before emitting
      if (!flushTimeout) {
        flushTimeout = setTimeout(flushBatch, 1500);
      }

      // Flush immediately if batch gets large
      if (batch.length >= 50) {
        if (flushTimeout) clearTimeout(flushTimeout);
        flushBatch();
      }
    });

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      const { error } = emit('heartbeat', JSON.stringify({ ts: Date.now() }));
      if (error) {
        lock.set(false);
      }
    }, 30000);

    // Cleanup on disconnect
    return () => {
      unsubscribe();
      clearInterval(heartbeat);
      if (flushTimeout) clearTimeout(flushTimeout);
    };
  });
}
```

#### Client Subscription (Svelte)

```svelte
<script lang="ts">
  import { source } from 'sveltekit-sse';
  import type { Log } from '$lib/server/db/schema';

  let { projectId, maxLogs = 100 } = $props();

  let liveEnabled = $state(true);
  let logs = $state<Log[]>([]);
  let lastEventId = $state<string | null>(null);

  // Create SSE connection
  const stream = source(`/api/projects/${projectId}/logs/stream`, {
    options: {
      headers: lastEventId ? { 'Last-Event-ID': lastEventId } : undefined,
    },
  });

  // Subscribe to batched logs
  const newLogs = stream.select('logs');

  $effect(() => {
    if (liveEnabled && $newLogs) {
      try {
        const incoming: Log[] = JSON.parse($newLogs);
        logs = [...incoming.reverse(), ...logs].slice(0, maxLogs);

        // Track last event for reconnection
        if (incoming.length > 0) {
          lastEventId = incoming[incoming.length - 1].id;
        }
      } catch (e) {
        console.error('Failed to parse logs:', e);
      }
    }
  });

  // Handle reconnection with missed logs recovery
  $effect(() => {
    if (!liveEnabled) {
      stream.close();
    }
  });
</script>
```

### Reconnection & Missed Logs

When a client disconnects and reconnects:

1. Client sends `Last-Event-ID` header with the last log ID it received
2. Server queries logs newer than that ID and sends them immediately
3. Then continues with live streaming

```typescript
// In SSE endpoint, before subscribing to event bus:
if (request.headers.get('Last-Event-ID')) {
  const lastId = request.headers.get('Last-Event-ID');
  const missedLogs = await db.query.log.findMany({
    where: and(
      eq(log.projectId, projectId),
      gt(log.timestamp, /* timestamp of lastId */)
    ),
    orderBy: asc(log.timestamp),
    limit: 500,
  });

  if (missedLogs.length > 0) {
    emit('logs', JSON.stringify(missedLogs));
  }
}
```

### Batching Strategy

To prevent UI thrashing during high log volume:

1. Server buffers logs for 1-2 seconds
2. Emits batch as single SSE event
3. Client appends all at once

```typescript
// Server-side batching
let batch: Log[] = [];
let timeout: NodeJS.Timeout | null = null;

function queueLog(log: Log) {
  batch.push(log);

  if (!timeout) {
    timeout = setTimeout(() => {
      emit('logs', JSON.stringify(batch));
      batch = [];
      timeout = null;
    }, 1500); // 1.5 second batch window
  }
}
```

---

## Full-Text Search

### Strategy

PostgreSQL's built-in full-text search with tsvector/tsquery is used. A generated column combines `message` and `metadata` into a searchable vector.

### Indexing

```sql
-- Generated column (defined in schema)
search TSVECTOR GENERATED ALWAYS AS (
  setweight(to_tsvector('english', message), 'A') ||
  setweight(to_tsvector('english', COALESCE(metadata::text, '')), 'B')
) STORED

-- GIN index for fast lookups
CREATE INDEX idx_log_search ON log USING GIN (search);
```

**Weights:**
- `A` (highest): message field — primary search target
- `B` (lower): metadata field — secondary, catches context

### Query Examples

**Simple search:**
```sql
SELECT * FROM log
WHERE search @@ to_tsquery('english', 'database')
ORDER BY timestamp DESC
LIMIT 100;
```

**Multi-term search (AND):**
```sql
SELECT * FROM log
WHERE search @@ to_tsquery('english', 'database & connection & failed')
ORDER BY timestamp DESC;
```

**Phrase search:**
```sql
SELECT * FROM log
WHERE search @@ phraseto_tsquery('english', 'connection failed')
ORDER BY timestamp DESC;
```

**With ranking:**
```sql
SELECT *, ts_rank(search, query) AS rank
FROM log, to_tsquery('english', 'database | connection') AS query
WHERE search @@ query
ORDER BY rank DESC, timestamp DESC
LIMIT 100;
```

### Drizzle Query

```typescript
import { sql, desc } from 'drizzle-orm';
import { log } from './schema';

async function searchLogs(projectId: string, searchTerm: string, limit: number) {
  const query = searchTerm
    .split(/\s+/)
    .filter(Boolean)
    .join(' & ');

  return db
    .select()
    .from(log)
    .where(
      sql`${log.projectId} = ${projectId} AND ${log.search} @@ to_tsquery('english', ${query})`
    )
    .orderBy(desc(log.timestamp))
    .limit(limit);
}
```

---

## Authentication & Security

### Dashboard Authentication (better-auth)

#### Configuration

```typescript
// src/lib/server/auth.ts

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
import { env } from '$env/dynamic/private';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 30, // 30 minutes
    updateAge: 60 * 5,  // Refresh every 5 minutes
  },
});
```

#### Server Hook

```typescript
// src/hooks.server.ts

import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';

export async function handle({ event, resolve }) {
  return svelteKitHandler({ event, resolve, auth });
}
```

#### Route Protection

```typescript
// src/routes/(app)/+layout.server.ts

import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';

export async function load({ request }) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    throw redirect(307, '/login');
  }

  return { user: session.user };
}
```

### API Key Authentication

#### Key Format

```
svl_[32 random alphanumeric characters]

Example: svl_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456
```

#### Generation & Validation with Caching

At 300 logs/s, hitting the database for every API key validation is wasteful. We use an in-memory cache with TTL to reduce database load by ~99.9%.

```typescript
// src/lib/server/utils/api-key.ts

import { nanoid } from 'nanoid';
import { db } from '$lib/server/db';
import { project } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';

// --- Key Generation ---

export function generateApiKey(): string {
  return `svl_${nanoid(32)}`;
}

export function validateApiKeyFormat(key: string): boolean {
  return /^svl_[A-Za-z0-9_-]{32}$/.test(key);
}

// --- API Key Cache ---

interface CacheEntry {
  projectId: string;
  expiresAt: number;
}

const API_KEY_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Validates an API key and returns the associated project ID.
 * Uses in-memory cache to avoid hitting DB on every request.
 * Throws 401 error if invalid.
 */
export async function validateApiKey(request: Request): Promise<string> {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw error(401, { message: 'Missing Authorization header' });
  }

  const apiKey = authHeader.slice(7);

  if (!validateApiKeyFormat(apiKey)) {
    throw error(401, { message: 'Invalid API key format' });
  }

  // Check cache first
  const cached = API_KEY_CACHE.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.projectId;
  }

  // Cache miss or expired - query database
  const proj = await db.query.project.findFirst({
    where: eq(project.apiKey, apiKey),
    columns: { id: true },
  });

  if (!proj) {
    // Remove from cache if it was there (key was invalidated)
    API_KEY_CACHE.delete(apiKey);
    throw error(401, { message: 'Invalid API key' });
  }

  // Update cache
  API_KEY_CACHE.set(apiKey, {
    projectId: proj.id,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return proj.id;
}

/**
 * Invalidates cache entry when API key is regenerated or project deleted.
 * Call this from project management endpoints.
 */
export function invalidateApiKeyCache(apiKey: string): void {
  API_KEY_CACHE.delete(apiKey);
}

/**
 * Clears entire cache. Useful for testing or when many keys change.
 */
export function clearApiKeyCache(): void {
  API_KEY_CACHE.clear();
}
```

#### Usage in API Routes

```typescript
// src/routes/v1/logs/+server.ts

import { json } from '@sveltejs/kit';
import { validateApiKey } from '$lib/server/utils/api-key';

export async function POST({ request }) {
  // Validates and returns projectId (throws 401 if invalid)
  const projectId = await validateApiKey(request);

  // Continue with log insertion...
}
```

> **Cache Invalidation**: When regenerating an API key or deleting a project, call `invalidateApiKeyCache(oldApiKey)` to prevent stale cache entries from granting access.

### Security Considerations

1. **API keys are secrets**: Never log them, always use HTTPS
2. **Rate limiting**: Consider implementing at reverse proxy level (nginx, Cloudflare)
3. **Input validation**: Validate all log fields, sanitize metadata
4. **SQL injection**: Drizzle ORM uses parameterized queries
5. **XSS**: Svelte auto-escapes output; use `{@html}` sparingly
6. **CSRF**: SvelteKit handles via origin checking

---

## File Structure

```
src/
├── lib/
│   ├── server/
│   │   ├── db/
│   │   │   ├── index.ts              # Drizzle client init
│   │   │   └── schema.ts             # All table definitions
│   │   ├── auth.ts                   # better-auth configuration
│   │   ├── events.ts                 # In-memory event bus for SSE
│   │   └── utils/
│   │       ├── api-key.ts            # API key generation/validation + caching
│   │       └── search.ts             # Full-text search helpers
│   │
│   ├── components/
│   │   ├── ui/                       # shadcn-svelte components
│   │   │   ├── button/
│   │   │   ├── input/
│   │   │   ├── dialog/
│   │   │   ├── sheet/
│   │   │   ├── select/
│   │   │   ├── table/
│   │   │   ├── badge/
│   │   │   ├── switch/
│   │   │   ├── card/
│   │   │   ├── skeleton/
│   │   │   ├── separator/
│   │   │   └── sonner/
│   │   │
│   │   ├── log-table.svelte          # Log stream table
│   │   ├── log-row.svelte            # Individual log row
│   │   ├── log-detail-modal.svelte   # Log detail overlay
│   │   ├── project-card.svelte       # Project card for dashboard
│   │   ├── project-settings.svelte   # Settings modal
│   │   ├── level-badge.svelte        # Colored level badge
│   │   ├── search-input.svelte       # Search with icon
│   │   ├── time-range-picker.svelte  # Quick time filters
│   │   ├── live-toggle.svelte        # Live mode switch
│   │   ├── level-chart.svelte        # Pie chart component
│   │   └── theme-toggle.svelte       # Dark/light mode switch
│   │
│   ├── stores/
│   │   ├── logs.svelte.ts            # Log stream state (Svelte 5 runes)
│   │   └── theme.svelte.ts           # Theme preference
│   │
│   ├── utils/
│   │   ├── format.ts                 # Date/time formatting
│   │   ├── colors.ts                 # Level color mappings
│   │   └── cn.ts                     # Class name utility
│   │
│   └── auth-client.ts                # better-auth client setup
│
├── routes/
│   ├── +layout.svelte                # Root layout (theme provider, fonts)
│   ├── +layout.server.ts             # Root server layout (optional)
│   │
│   ├── login/
│   │   ├── +page.svelte              # Login form
│   │   └── +page.server.ts           # Login action
│   │
│   ├── (app)/                        # Protected route group
│   │   ├── +layout.svelte            # App shell (header, nav)
│   │   ├── +layout.server.ts         # Auth guard, load session
│   │   │
│   │   ├── +page.svelte              # Dashboard (project list)
│   │   ├── +page.server.ts           # Load projects
│   │   │
│   │   └── projects/
│   │       └── [id]/
│   │           ├── +page.svelte      # Log stream view
│   │           ├── +page.server.ts   # Load project + initial logs
│   │           │
│   │           └── stats/
│   │               ├── +page.svelte  # Charts page
│   │               └── +page.server.ts
│   │
│   └── api/
│       ├── auth/
│       │   └── [...all]/
│       │       └── +server.ts        # better-auth handler
│       │
│       ├── v1/
│       │   └── logs/
│       │       ├── +server.ts        # POST single log
│       │       └── batch/
│       │           └── +server.ts    # POST batch logs
│       │
│       └── projects/
│           ├── +server.ts            # GET list, POST create
│           │
│           └── [id]/
│               ├── +server.ts        # GET detail, DELETE
│               ├── regenerate/
│               │   └── +server.ts    # POST regenerate key
│               ├── logs/
│               │   ├── +server.ts    # GET logs (paginated)
│               │   └── stream/
│               │       └── +server.ts # SSE endpoint
│               └── stats/
│                   └── +server.ts    # GET level stats
│
├── hooks.server.ts                   # Auth handler
├── app.html                          # HTML template
├── app.d.ts                          # Global type definitions
└── app.css                           # Global styles (Tailwind imports)
```

---

## Dependencies

### Production Dependencies

```json
{
  "dependencies": {
    "better-auth": "^1.0.0",
    "nanoid": "^5.0.0",
    "postgres": "^3.4.0",
    "sveltekit-sse": "^0.13.0"
  }
}
```

### Dev Dependencies (additions to existing)

```json
{
  "devDependencies": {
    "bits-ui": "^1.0.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0",
    "tailwind-variants": "^0.2.0",
    "mode-watcher": "^0.4.0"
  }
}
```

### Installation Commands

```bash
# Production deps
bun add better-auth nanoid sveltekit-sse

# shadcn-svelte setup
bunx shadcn-svelte@latest init

# Add components
bunx shadcn-svelte@latest add button input select dialog sheet card table badge switch separator skeleton sonner

# Generate better-auth schema
bunx @better-auth/cli@latest generate
```

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/svlogger

# Authentication
ADMIN_PASSWORD=your-secure-admin-password
BETTER_AUTH_SECRET=random-32-character-secret-string

# Optional: Base URL for production
ORIGIN=https://your-domain.com
```

### Generating Secrets

```bash
# Generate BETTER_AUTH_SECRET
openssl rand -base64 32
```

---

## Performance Considerations

### Database

1. **Composite Index**: `(project_id, timestamp DESC)` covers the most common query pattern
2. **GIN Index**: Full-text search index enables fast `@@` queries
3. **Partitioning** (future): If log volume grows, partition by month
4. **Connection Pooling**: Use PgBouncer in production for high concurrency

### API

1. **Batch Ingestion**: Accept up to 100 logs per request to reduce HTTP overhead
2. **Streaming Inserts**: Use `COPY` for very high volume (future optimization)
3. **Response Compression**: Enable gzip/brotli at reverse proxy

### Real-time

1. **SSE Batching**: Buffer logs for 1-2 seconds before emitting
2. **Heartbeats**: Send ping every 30s to keep connection alive
3. **Reconnection**: Client auto-reconnects with exponential backoff

### UI

1. **Virtual Scrolling** (future): For very long log lists, render only visible rows
2. **Skeleton Loading**: Show structure immediately, populate async
3. **Optimistic Updates**: Assume success, rollback on error
4. **Debounced Search**: Wait 300ms after typing before querying

### Caching

1. **Project List**: Cache for 60s (invalidate on create/delete)
2. **Stats**: Cache for 5 minutes (not real-time critical)
3. **Logs**: No caching (real-time is the point)

---

## Future Considerations (Out of Scope for v1)

- Log retention policies (auto-delete after X days)
- Log export (CSV, JSON download)
- Alerting (email/webhook on error threshold)
- Multiple users with roles
- Log sampling for high-volume projects
- Time-series charts (logs over time)
- Structured query language for advanced filtering
- Mobile app

---

*Document Version: 1.0*
*Last Updated: January 2025*
