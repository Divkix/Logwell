---
spec: keyboard-shortcuts
phase: tasks
total_tasks: 22
created: 2026-01-15
---

# Tasks: Keyboard Shortcuts for Log Viewer

## Execution Context (from interview)

- **Testing depth**: Standard - unit + integration tests for keyboard handlers
- **Deployment considerations**: Standard CI/CD pipeline (no feature flags)

## Phase 1: Make It Work (POC)

Focus: Validate the idea works end-to-end. Skip tests, accept hardcoded values.

- [x] 1.1 Create keyboard utilities module
  - **Do**:
    1. Create `src/lib/utils/keyboard.ts`
    2. Implement `shouldBlockShortcut(event: KeyboardEvent): boolean` function
       - Return `true` if `event.target.tagName` is INPUT/TEXTAREA/SELECT
       - Return `true` if `event.isComposing` is true
       - Return `true` if `event.ctrlKey || event.altKey || event.metaKey`
       - Return `false` otherwise
    3. Export `FORM_ELEMENTS` constant array
    4. Export `SHORTCUTS` array with key/description for all shortcuts (for help modal)
  - **Files**: `src/lib/utils/keyboard.ts`
  - **Done when**: File exists, exports `shouldBlockShortcut` and `SHORTCUTS`
  - **Verify**: `bun run check && bun run lint`
  - **Commit**: `feat(keyboard): add keyboard utilities module`
  - _Requirements: FR-5_
  - _Design: Keyboard Handler, shouldBlockShortcut function_

- [x] 1.2 Add selectedIndex state and j/k navigation to page
  - **Do**:
    1. In `src/routes/(app)/projects/[id]/+page.svelte`, add `let selectedIndex = $state(-1)`
    2. Add `<svelte:document onkeydown={handleKeyboardShortcut}>` before the template
    3. Implement `handleKeyboardShortcut(event: KeyboardEvent)`:
       - Import and call `shouldBlockShortcut(event)`, return if true
       - Check if any modal is open (`showDetailModal` or `showHelpModal`), return if true
       - Handle `j`: if `selectedIndex < allLogs.length - 1`, increment; else if -1, set to 0
       - Handle `k`: if `selectedIndex > 0`, decrement
       - Call `scrollSelectedIntoView()` after j/k
    4. Add `scrollSelectedIntoView()` function:
       - Find element with `[data-selected="true"]` selector
       - Call `element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })`
  - **Files**: `src/routes/(app)/projects/[id]/+page.svelte`
  - **Done when**: Pressing j/k changes `selectedIndex` value (verify in console)
  - **Verify**: `bun run check && bun run lint`
  - **Commit**: `feat(keyboard): add j/k navigation to log viewer`
  - _Requirements: FR-1, FR-2, FR-3, FR-4, AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-1.5_
  - _Design: Keyboard Handler (Page Level), Data Flow_

- [x] 1.3 Add selectedIndex prop to LogTable and pass to children
  - **Do**:
    1. In `src/lib/components/log-table.svelte`, add `selectedIndex?: number` to Props interface
    2. Destructure `selectedIndex = -1` from `$props()`
    3. In the desktop table `{#each sortedLogs}` loop, pass `isSelected={i === selectedIndex}` to LogRow
    4. In the mobile card `{#each sortedLogs}` loop, pass `isSelected={i === selectedIndex}` to LogCard
    5. In `+page.svelte`, pass `selectedIndex` prop to `<LogTable>`
  - **Files**: `src/lib/components/log-table.svelte`, `src/routes/(app)/projects/[id]/+page.svelte`
  - **Done when**: LogTable accepts selectedIndex and passes isSelected to children
  - **Verify**: `bun run check && bun run lint`
  - **Commit**: `feat(keyboard): pass selectedIndex through LogTable to children`
  - _Requirements: FR-13, FR-14_
  - _Design: LogTable Component, Interface Changes_

- [x] 1.4 Add visual selection highlight to LogRow
  - **Do**:
    1. In `src/lib/components/log-row.svelte`, add `isSelected?: boolean` to Props interface
    2. Destructure `isSelected = false` from `$props()`
    3. Add `data-selected={isSelected}` attribute to the `<tr>` element
    4. Add conditional class in `cn()`: when `isSelected`, add `bg-primary/10 ring-1 ring-primary/50`
    5. Add `aria-selected={isSelected}` for accessibility
  - **Files**: `src/lib/components/log-row.svelte`
  - **Done when**: Selected row has visible background highlight different from hover
  - **Verify**: `bun run check && bun run lint` then manually test j/k visually
  - **Commit**: `feat(keyboard): add visual selection highlight to LogRow`
  - _Requirements: FR-13, AC-1.7_
  - _Design: LogRow Component, Selected style_

- [x] 1.5 Add visual selection highlight to LogCard
  - **Do**:
    1. In `src/lib/components/log-card.svelte`, add `isSelected?: boolean` to Props interface
    2. Destructure `isSelected = false` from `$props()`
    3. Add `data-selected={isSelected}` attribute to the `<div>` element
    4. Add conditional class in `cn()`: when `isSelected`, add `bg-primary/10 ring-1 ring-primary/50`
    5. Add `aria-selected={isSelected}` for accessibility
  - **Files**: `src/lib/components/log-card.svelte`
  - **Done when**: Selected card has visible background highlight different from hover
  - **Verify**: `bun run check && bun run lint`
  - **Commit**: `feat(keyboard): add visual selection highlight to LogCard`
  - _Requirements: FR-14, AC-1.7_
  - _Design: LogCard Component, Selected style_

- [x] V1 [VERIFY] Quality checkpoint: `bun run lint && bun run check`
  - **Do**: Run quality commands and verify all pass
  - **Verify**: All commands exit 0
  - **Done when**: No lint errors, no type errors
  - **Commit**: `chore(keyboard): pass quality checkpoint` (only if fixes needed)

- [x] 1.6 Add Enter to open modal for selected log
  - **Do**:
    1. In `handleKeyboardShortcut`, add case for `Enter`:
       - If `selectedIndex >= 0 && selectedIndex < allLogs.length`:
         - Set `selectedLog = allLogs[selectedIndex]`
         - Set `showDetailModal = true`
       - Call `event.preventDefault()` to prevent form submission
  - **Files**: `src/routes/(app)/projects/[id]/+page.svelte`
  - **Done when**: Pressing Enter with selection opens LogDetailModal
  - **Verify**: `bun run check && bun run lint` then manually test Enter opens modal
  - **Commit**: `feat(keyboard): add Enter to open log detail modal`
  - _Requirements: FR-6, AC-2.1, AC-2.2_
  - _Design: Modal Open Flow_

- [x] 1.7 Verify Escape closes modal (existing behavior)
  - **Do**:
    1. Verify `LogDetailModal` already handles Escape via `<svelte:document onkeydown>`
    2. Test manually: open modal with Enter, close with Escape
    3. Verify selection is preserved after modal closes
    4. If focus not returning properly, ensure `triggerElement` prop passed or rely on existing `previouslyFocusedElement` logic
  - **Files**: None (verification only, may update `+page.svelte` if needed)
  - **Done when**: Escape closes modal, selection remains, focus returns to page
  - **Verify**: Manual test
  - **Commit**: `docs(keyboard): verify Escape modal close behavior` (if no code changes needed)
  - _Requirements: FR-7, AC-3.1, AC-3.2, AC-3.3_
  - _Design: Existing Patterns to Follow_

- [x] 1.8 Add / to focus search and Escape to blur
  - **Do**:
    1. In `src/lib/components/search-input.svelte`:
       - Add `ref` bindable prop: `let { ref = $bindable() }: Props & { ref?: HTMLInputElement | null } = $props()`
       - Add `onEscape?: () => void` to Props
       - Bind the Input's `ref` prop or add internal ref
       - Add `onkeydown` handler to Input: if `event.key === 'Escape'`, call `ref?.blur()` and `onEscape?.()`
    2. In `+page.svelte`:
       - Add `let searchInputRef = $state<HTMLInputElement | null>(null)`
       - Pass `bind:ref={searchInputRef}` and `onEscape` to SearchInput
       - In `handleKeyboardShortcut`, add case for `/`:
         - Call `event.preventDefault()` (prevent `/` from typing)
         - Call `searchInputRef?.focus()`
  - **Files**: `src/lib/components/search-input.svelte`, `src/routes/(app)/projects/[id]/+page.svelte`
  - **Done when**: Pressing `/` focuses search, pressing Escape in search blurs it
  - **Verify**: `bun run check && bun run lint` then manually test
  - **Commit**: `feat(keyboard): add / to focus search and Escape to blur`
  - _Requirements: FR-8, FR-9, FR-15, AC-4.1, AC-4.2, AC-4.3, AC-4.4_
  - _Design: SearchInput Component, Interface Changes_

- [x] 1.9 Add l to toggle live mode
  - **Do**:
    1. In `handleKeyboardShortcut`, add case for `l`:
       - If `isLivePaused`, return (don't toggle when paused due to search)
       - Toggle: `liveEnabled = !liveEnabled`
  - **Files**: `src/routes/(app)/projects/[id]/+page.svelte`
  - **Done when**: Pressing `l` toggles LiveToggle state
  - **Verify**: `bun run check && bun run lint` then manually test
  - **Commit**: `feat(keyboard): add l to toggle live mode`
  - _Requirements: FR-10, AC-5.1, AC-5.2, AC-5.3, AC-5.4_
  - _Design: Live Toggle Analysis_

- [x] V2 [VERIFY] Quality checkpoint: `bun run lint && bun run check`
  - **Do**: Run quality commands and verify all pass
  - **Verify**: All commands exit 0
  - **Done when**: No lint errors, no type errors
  - **Commit**: `chore(keyboard): pass quality checkpoint` (only if fixes needed)

- [x] 1.10 Create KeyboardHelpModal component
  - **Do**:
    1. Create `src/lib/components/keyboard-help-modal.svelte`
    2. Follow same pattern as `log-detail-modal.svelte`:
       - Accept `open: boolean` and `onClose: () => void` props
       - Use `<svelte:document onkeydown>` for Escape handling
       - Use `focusTrap` action on dialog
       - Add backdrop overlay with click to close
    3. Import `SHORTCUTS` from `$lib/utils/keyboard`
    4. Render shortcuts in groups:
       - Navigation: j (next), k (previous), Enter (open)
       - Search & Filters: / (focus search), Esc (blur search)
       - Other: l (toggle live), ? (help)
    5. Style with consistent table/list layout
  - **Files**: `src/lib/components/keyboard-help-modal.svelte`
  - **Done when**: Component renders shortcuts list when `open=true`
  - **Verify**: `bun run check && bun run lint`
  - **Commit**: `feat(keyboard): create KeyboardHelpModal component`
  - _Requirements: FR-11, AC-6.1, AC-6.2, AC-6.3, AC-6.4_
  - _Design: KeyboardHelpModal Component (NEW)_

- [x] 1.11 Add ? shortcut to open help modal
  - **Do**:
    1. In `+page.svelte`, add `let showHelpModal = $state(false)`
    2. In `handleKeyboardShortcut`, add case for `?`:
       - Set `showHelpModal = true`
       - Call `event.preventDefault()`
    3. Import and render `<KeyboardHelpModal open={showHelpModal} onClose={() => showHelpModal = false} />`
    4. Update the modal open guard to include `showHelpModal`
  - **Files**: `src/routes/(app)/projects/[id]/+page.svelte`
  - **Done when**: Pressing `?` opens KeyboardHelpModal
  - **Verify**: `bun run check && bun run lint` then manually test
  - **Commit**: `feat(keyboard): add ? shortcut to open help modal`
  - _Requirements: FR-11, AC-6.1, AC-6.2_
  - _Design: Architecture diagram (HM state)_

- [x] 1.12 POC Checkpoint - End-to-end verification
  - **Do**:
    1. Start dev server: `bun run dev`
    2. Navigate to a project with logs
    3. Test full keyboard workflow:
       - Press `j` to select first log, continue to navigate down
       - Press `k` to navigate up
       - Verify selected log scrolls into view
       - Press `Enter` to open detail modal
       - Press `Escape` to close modal
       - Press `/` to focus search
       - Press `Escape` to blur search
       - Press `l` to toggle live mode
       - Press `?` to open help modal
       - Press `Escape` to close help modal
       - Type in search input, verify j/k are disabled
    4. Test on mobile viewport (resize browser)
  - **Files**: None (verification only)
  - **Done when**: All shortcuts work as expected, feature is demonstrable
  - **Verify**: Manual test of full workflow
  - **Commit**: `feat(keyboard): complete POC for keyboard shortcuts`
  - _Requirements: All P0 and P1_
  - _Design: All sections_

## Phase 2: Refactoring

After POC validated, clean up code and add polish.

- [x] 2.1 Add selection reset on filter changes
  - **Do**:
    1. In `handleSearch`, add `selectedIndex = -1` after setting `searchValue`
    2. In `handleLevelChange`, add `selectedIndex = -1` after setting `selectedLevels`
    3. In `handleTimeRangeChange`, add `selectedIndex = -1` after setting `selectedRange`
    4. In `clearFilters`, add `selectedIndex = -1`
  - **Files**: `src/routes/(app)/projects/[id]/+page.svelte`
  - **Done when**: Selection clears when any filter changes
  - **Verify**: `bun run check && bun run lint` then manually test filter changes reset selection
  - **Commit**: `refactor(keyboard): reset selection on filter changes`
  - _Requirements: FR-12, AC-7.1, AC-7.2, AC-7.3, AC-7.4_
  - _Design: Filter Change Reset Flow_

- [x] 2.2 Add screen reader announcements for navigation
  - **Do**:
    1. Import `announceToScreenReader` from `$lib/utils/focus-trap`
    2. After j/k navigation changes `selectedIndex`, call:
       ```ts
       announceToScreenReader(`Log ${selectedIndex + 1} of ${allLogs.length}`)
       ```
    3. Ensure announcement only happens when selection actually changes
  - **Files**: `src/routes/(app)/projects/[id]/+page.svelte`
  - **Done when**: Screen reader announces position on j/k navigation
  - **Verify**: `bun run check && bun run lint`
  - **Commit**: `feat(keyboard): add screen reader announcements for navigation`
  - _Requirements: NFR-2_
  - _Design: Accessibility Considerations_

- [x] 2.3 Code review and cleanup
  - **Do**:
    1. Review `handleKeyboardShortcut` for readability
    2. Consider extracting shortcut handlers into separate functions if too long
    3. Ensure all edge cases handled:
       - Empty log list (j/k do nothing)
       - Loading state (j/k do nothing)
       - Modal open (j/k/l disabled)
       - IME composition (all disabled)
    4. Add JSDoc comments to keyboard utilities
    5. Remove any console.log statements
  - **Files**: `src/routes/(app)/projects/[id]/+page.svelte`, `src/lib/utils/keyboard.ts`
  - **Done when**: Code is clean, readable, and follows project patterns
  - **Verify**: `bun run check && bun run lint && bun run knip`
  - **Commit**: `refactor(keyboard): clean up and document keyboard handling`
  - _Design: Code maintainability (NFR-5)_

- [x] V3 [VERIFY] Quality checkpoint: `bun run lint && bun run check && bun run knip`
  - **Do**: Run all quality commands including knip for unused exports
  - **Verify**: All commands exit 0
  - **Done when**: No lint errors, no type errors, no unused exports
  - **Commit**: `chore(keyboard): pass quality checkpoint` (only if fixes needed)

## Phase 3: Testing

- [x] 3.1 Unit tests for keyboard utilities
  - **Do**:
    1. Create `src/lib/utils/keyboard.test.ts`
    2. Test `shouldBlockShortcut`:
       - Returns true when target is INPUT element
       - Returns true when target is TEXTAREA element
       - Returns true when target is SELECT element
       - Returns true when `event.isComposing` is true
       - Returns true when `ctrlKey` is pressed
       - Returns true when `altKey` is pressed
       - Returns true when `metaKey` is pressed
       - Returns false for regular DIV target
       - Returns false for TABLE target
    3. Test `SHORTCUTS` array contains expected entries
  - **Files**: `src/lib/utils/keyboard.test.ts`
  - **Done when**: All unit tests pass with good coverage
  - **Verify**: `bun run test:unit src/lib/utils/keyboard.test.ts`
  - **Commit**: `test(keyboard): add unit tests for keyboard utilities`
  - _Requirements: NFR-3_
  - _Design: Test Strategy - Unit Tests_

- [x] 3.2 Component tests for LogRow isSelected
  - **Do**:
    1. Add tests to existing `src/lib/components/log-row.test.ts` (or create if missing)
    2. Test:
       - Renders without isSelected prop (default false)
       - Applies selected class when isSelected=true
       - Does not apply selected class when isSelected=false
       - Has `data-selected="true"` when selected
       - Has `aria-selected="true"` when selected
  - **Files**: `src/lib/components/log-row.test.ts`
  - **Done when**: Component tests pass for LogRow selection
  - **Verify**: `bun run test:component src/lib/components/log-row.test.ts`
  - **Commit**: `test(keyboard): add component tests for LogRow isSelected`
  - _Design: Test Strategy - Component Tests_

- [ ] 3.3 Component tests for LogCard isSelected
  - **Do**:
    1. Add tests to existing `src/lib/components/log-card.test.ts` (or create if missing)
    2. Test:
       - Renders without isSelected prop (default false)
       - Applies selected class when isSelected=true
       - Has `data-selected="true"` when selected
       - Has `aria-selected="true"` when selected
  - **Files**: `src/lib/components/log-card.test.ts`
  - **Done when**: Component tests pass for LogCard selection
  - **Verify**: `bun run test:component src/lib/components/log-card.test.ts`
  - **Commit**: `test(keyboard): add component tests for LogCard isSelected`
  - _Design: Test Strategy - Component Tests_

- [ ] 3.4 Component tests for SearchInput ref and onEscape
  - **Do**:
    1. Add tests to existing `src/lib/components/search-input.test.ts` (or create if missing)
    2. Test:
       - Exposes ref bindable prop
       - Calls onEscape when Escape pressed while focused
       - Does not call onEscape when other keys pressed
  - **Files**: `src/lib/components/search-input.test.ts`
  - **Done when**: Component tests pass for SearchInput
  - **Verify**: `bun run test:component src/lib/components/search-input.test.ts`
  - **Commit**: `test(keyboard): add component tests for SearchInput ref/onEscape`
  - _Design: Test Strategy - Component Tests_

- [ ] 3.5 Component tests for KeyboardHelpModal
  - **Do**:
    1. Create `src/lib/components/keyboard-help-modal.test.ts`
    2. Test:
       - Renders when open=true
       - Does not render when open=false
       - Displays all shortcuts from SHORTCUTS array
       - Calls onClose when Escape pressed
       - Calls onClose when backdrop clicked
  - **Files**: `src/lib/components/keyboard-help-modal.test.ts`
  - **Done when**: Component tests pass for KeyboardHelpModal
  - **Verify**: `bun run test:component src/lib/components/keyboard-help-modal.test.ts`
  - **Commit**: `test(keyboard): add component tests for KeyboardHelpModal`
  - _Design: Test Strategy - Component Tests_

- [ ] V4 [VERIFY] Quality checkpoint: `bun run lint && bun run check && bun run test:unit && bun run test:component`
  - **Do**: Run full quality suite including tests
  - **Verify**: All commands exit 0
  - **Done when**: All lint, type, and test checks pass
  - **Commit**: `chore(keyboard): pass quality checkpoint` (only if fixes needed)

## Phase 4: Quality Gates

- [ ] 4.1 [VERIFY] Full local CI: `bun run lint && bun run check && bun run test:unit && bun run test:component && bun run build`
  - **Do**: Run complete local CI suite
  - **Verify**: All commands pass
  - **Done when**: Build succeeds, all tests pass
  - **Commit**: `chore(keyboard): pass local CI` (if fixes needed)

- [ ] 4.2 [VERIFY] Create PR and verify CI pipeline
  - **Do**:
    1. Verify current branch is a feature branch: `git branch --show-current`
    2. If on main, STOP and alert user
    3. Push branch: `git push -u origin <branch-name>`
    4. Create PR: `gh pr create --title "feat(keyboard): add keyboard shortcuts for log viewer" --body "..."`
    5. Verify CI passes: `gh pr checks --watch`
  - **Verify**: Use `gh pr checks` to verify all checks pass
  - **Done when**: All CI checks green, PR ready for review
  - **If CI fails**: Read failure details, fix locally, push fixes, re-verify
  - **Commit**: None (PR creation)

- [ ] 4.3 [VERIFY] Acceptance criteria checklist
  - **Do**: Read requirements.md, verify each AC is satisfied:
    - [ ] AC-1.1: j moves selection to next log
    - [ ] AC-1.2: k moves selection to previous log
    - [ ] AC-1.3: First j selects first log
    - [ ] AC-1.4: Navigation stops at boundaries
    - [ ] AC-1.5: Selected log scrolls into view
    - [ ] AC-1.6: Shortcuts disabled in form fields
    - [ ] AC-1.7: Visual selection on LogRow and LogCard
    - [ ] AC-2.1: Enter opens modal for selected log
    - [ ] AC-2.2: Enter does nothing without selection
    - [ ] AC-2.3: Modal has focus trap
    - [ ] AC-3.1: Escape closes modal
    - [ ] AC-3.2: Focus returns after modal close
    - [ ] AC-3.3: Selection preserved after modal close
    - [ ] AC-4.1: / focuses search
    - [ ] AC-4.2: / prevented from typing
    - [ ] AC-4.3: Works regardless of scroll
    - [ ] AC-4.4: Escape in search blurs it
    - [ ] AC-5.1: l toggles liveEnabled
    - [ ] AC-5.2: Visual feedback matches toggle
    - [ ] AC-5.3: Toggle disabled when search active
    - [ ] AC-5.4: Shortcut disabled in form fields
    - [ ] AC-6.1: ? opens help modal
    - [ ] AC-6.2: Help modal closes with Escape
    - [ ] AC-6.3: Shortcuts displayed in scannable format
    - [ ] AC-6.4: Help modal doesn't interfere with other modals
    - [ ] AC-7.1: Selection resets on search change
    - [ ] AC-7.2: Selection resets on level filter change
    - [ ] AC-7.3: Selection resets on time range change
    - [ ] AC-7.4: Selection visual removed on reset
  - **Verify**: Manual review against implementation
  - **Done when**: All acceptance criteria confirmed met
  - **Commit**: None (verification only)

## Notes

- **POC shortcuts taken**:
  - Skipped unit/integration/e2e tests in Phase 1
  - Used inline conditional classes instead of extracting to constants
  - Minimal error handling beyond boundary checks

- **Production TODOs addressed in Phase 2+**:
  - Screen reader announcements
  - Filter reset logic
  - Code cleanup and documentation
  - Full test coverage

- **Files created**:
  - `src/lib/utils/keyboard.ts` - Keyboard guard utilities
  - `src/lib/components/keyboard-help-modal.svelte` - Help modal component
  - `src/lib/utils/keyboard.test.ts` - Unit tests
  - `src/lib/components/keyboard-help-modal.test.ts` - Component tests

- **Files modified**:
  - `src/routes/(app)/projects/[id]/+page.svelte` - Main keyboard handler
  - `src/lib/components/log-table.svelte` - Accept selectedIndex
  - `src/lib/components/log-row.svelte` - Accept isSelected, add styles
  - `src/lib/components/log-card.svelte` - Accept isSelected, add styles
  - `src/lib/components/search-input.svelte` - Expose ref, add onEscape
