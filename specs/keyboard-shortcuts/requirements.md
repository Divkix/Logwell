---
spec: keyboard-shortcuts
phase: requirements
created: 2026-01-15
---

# Requirements: Keyboard Shortcuts for Log Viewer

## Goal

Enable power users to navigate and interact with the log viewer entirely via keyboard, improving efficiency for users who prefer mouse-free workflows while maintaining full accessibility.

## User Decisions

From the goal clarification interview:
- **Problem:** Power user efficiency - mouse-free navigation for faster log browsing
- **Constraints:** Must be discoverable AND must not conflict with browser/system shortcuts
- **Success criteria:** Tests pass and code works - basic functionality verified
- **Primary users:** Both developers and end users (anyone using the log viewer)
- **Priority tradeoffs:** Feature completeness - all shortcuts with full polish

## Open Questions Resolution

Based on "feature completeness" priority:

1. **Should j/k wrap around at list boundaries?** No. Gmail-style behavior - stop at boundaries. Wrapping is disorienting and inconsistent with power user expectations.

2. **Should selection reset when filters change?** Yes. Reset `selectedIndex` to -1 (no selection) when filters change. The log list content changes, so maintaining index would point to wrong/different log.

3. **Show ? for help modal or simpler tooltip?** Yes, implement `?` shortcut for help modal. Power users expect discoverable help (Gmail, GitHub pattern). Display all shortcuts with their descriptions.

## User Stories

### US-1: Navigate Logs with j/k Keys

**As a** power user
**I want to** press j to move down and k to move up through the log list
**So that** I can quickly browse logs without reaching for the mouse

**Acceptance Criteria:**
- [ ] AC-1.1: Pressing `j` moves selection to next log (visually highlighted)
- [ ] AC-1.2: Pressing `k` moves selection to previous log
- [ ] AC-1.3: First `j` press selects the first log when nothing is selected
- [ ] AC-1.4: Navigation stops at list boundaries (no wrap)
- [ ] AC-1.5: Selected log auto-scrolls into view if off-screen
- [ ] AC-1.6: Shortcuts are disabled when focus is in INPUT/TEXTAREA/SELECT
- [ ] AC-1.7: Visual selection indicator is clearly visible on both LogRow (desktop) and LogCard (mobile)

### US-2: Open Log Detail with Enter

**As a** user viewing the log list
**I want to** press Enter to open the detail modal for the selected log
**So that** I can view full log details without clicking

**Acceptance Criteria:**
- [ ] AC-2.1: Pressing `Enter` opens LogDetailModal for currently selected log
- [ ] AC-2.2: Enter does nothing when no log is selected
- [ ] AC-2.3: Modal opens with focus trapped inside (existing behavior)

### US-3: Close Modal with Escape

**As a** user viewing a log detail modal
**I want to** press Escape to close the modal
**So that** I can quickly return to the log list

**Acceptance Criteria:**
- [ ] AC-3.1: Pressing `Esc` closes the LogDetailModal
- [ ] AC-3.2: Focus returns to the log list after modal closes
- [ ] AC-3.3: Selection is preserved after modal closes

### US-4: Focus Search with Slash

**As a** power user
**I want to** press `/` to focus the search input
**So that** I can quickly filter logs by text

**Acceptance Criteria:**
- [ ] AC-4.1: Pressing `/` focuses the SearchInput field
- [ ] AC-4.2: `/` keystroke is prevented from being typed into the input
- [ ] AC-4.3: Works regardless of current scroll position
- [ ] AC-4.4: Pressing `Esc` while in search input blurs it and returns focus to list

### US-5: Toggle Live Mode with l

**As a** user monitoring logs
**I want to** press `l` to toggle live streaming on/off
**So that** I can pause/resume the stream without mouse interaction

**Acceptance Criteria:**
- [ ] AC-5.1: Pressing `l` toggles the `liveEnabled` state
- [ ] AC-5.2: Visual feedback matches toggle switch state
- [ ] AC-5.3: Toggle is disabled when live is paused due to search (existing behavior preserved)
- [ ] AC-5.4: Shortcut is disabled when focus is in INPUT/TEXTAREA/SELECT

### US-6: View Keyboard Help

**As a** new or returning user
**I want to** press `?` to see available keyboard shortcuts
**So that** I can discover and remember the shortcuts

**Acceptance Criteria:**
- [ ] AC-6.1: Pressing `?` opens a help modal/dialog listing all shortcuts
- [ ] AC-6.2: Help modal can be closed with `Esc`
- [ ] AC-6.3: Shortcuts are displayed in a clear, scannable format
- [ ] AC-6.4: Help modal does not interfere with other modals

### US-7: Reset Selection on Filter Change

**As a** user navigating logs
**I want to** have selection cleared when I apply filters
**So that** I don't accidentally act on a log that's no longer visible or relevant

**Acceptance Criteria:**
- [ ] AC-7.1: `selectedIndex` resets to -1 when search value changes
- [ ] AC-7.2: `selectedIndex` resets to -1 when level filter changes
- [ ] AC-7.3: `selectedIndex` resets to -1 when time range changes
- [ ] AC-7.4: Selection visual indicator is removed from all logs

## Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-1 | Implement `j` key to select next log | P0 | AC-1.1, AC-1.3, AC-1.4 |
| FR-2 | Implement `k` key to select previous log | P0 | AC-1.2, AC-1.4 |
| FR-3 | Add `selectedIndex` state to track keyboard selection | P0 | Index tracks position in `allLogs` array |
| FR-4 | Auto-scroll selected log into view | P0 | AC-1.5 - use `scrollIntoView({ block: 'nearest' })` |
| FR-5 | Guard shortcuts against form field focus | P0 | AC-1.6 - check `event.target.tagName` |
| FR-6 | Implement `Enter` key to open detail modal | P0 | AC-2.1, AC-2.2 |
| FR-7 | Implement `Esc` key to close modal | P0 | AC-3.1, AC-3.2, AC-3.3 |
| FR-8 | Implement `/` key to focus search input | P1 | AC-4.1, AC-4.2 |
| FR-9 | Implement `Esc` in search to blur and return focus | P1 | AC-4.4 |
| FR-10 | Implement `l` key to toggle live mode | P1 | AC-5.1, AC-5.2, AC-5.3, AC-5.4 |
| FR-11 | Implement `?` key to show help modal | P1 | AC-6.1, AC-6.2, AC-6.3 |
| FR-12 | Reset selection when filters change | P1 | AC-7.1, AC-7.2, AC-7.3, AC-7.4 |
| FR-13 | Add visual selection highlight to LogRow | P0 | Distinct from hover state, visible on focus |
| FR-14 | Add visual selection highlight to LogCard | P0 | Same pattern as LogRow for mobile |
| FR-15 | Expose SearchInput ref for programmatic focus | P1 | Add `ref` bindable prop to SearchInput |

## Non-Functional Requirements

| ID | Requirement | Metric | Target |
|----|-------------|--------|--------|
| NFR-1 | Keyboard response time | Time from keypress to visual update | < 16ms (single frame) |
| NFR-2 | Accessibility | Screen reader announcements | Announce selected log position (e.g., "Log 5 of 42") |
| NFR-3 | Test coverage | Unit + component tests | 95%+ coverage for keyboard handler logic |
| NFR-4 | Browser compatibility | Shortcut conflicts | No conflicts with Chrome, Firefox, Safari, Edge |
| NFR-5 | Code maintainability | Keyboard handler location | Single handler function, not scattered |

## Glossary

- **selectedIndex**: Zero-based index tracking which log in `allLogs` is currently keyboard-selected (-1 means no selection)
- **Form field focus guard**: Logic that disables single-key shortcuts when user is typing in INPUT, TEXTAREA, or SELECT elements
- **Boundary behavior**: What happens when user presses j at last log or k at first log (stop, not wrap)
- **Live mode**: SSE streaming of new logs in real-time
- **Power user**: User who prefers keyboard navigation and memorizes shortcuts for efficiency

## Out of Scope

- Vim-style command mode (`:` prefix commands)
- Customizable keybindings
- Multi-select with Shift+j/k
- Keyboard shortcuts for filter controls (level, time range)
- Keyboard shortcuts for export functionality
- Mobile-specific gesture shortcuts
- Keyboard macro recording/playback
- Persistent user preference for keyboard hints visibility

## Dependencies

- SearchInput component must expose a `ref` bindable for programmatic focus (modification required)
- Existing `announceToScreenReader` utility in `focus-trap.ts` for accessibility
- LogRow and LogCard components must accept selection state prop (modification required)
- LogDetailModal already handles Esc via focus trap (verify existing behavior)

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Conflict with browser shortcuts | High | j/k/l are safe; verified no browser conflicts |
| Accessibility regression | Medium | Use existing `announceToScreenReader`, add ARIA labels |
| Performance with large log lists | Low | Selection is index-based, no DOM traversal needed |
| Mobile keyboard (external) | Low | Same shortcuts work; primarily desktop feature |

## Success Criteria

1. All P0 shortcuts (j/k/Enter/Esc) work correctly on the log viewer page
2. All P1 shortcuts (//l/?) work correctly
3. Unit tests pass for keyboard handler logic
4. Component tests verify shortcut behavior
5. E2E test confirms full keyboard-only workflow
6. No regressions in existing functionality (modal, search, live toggle)
7. Screen reader announces selected log position
