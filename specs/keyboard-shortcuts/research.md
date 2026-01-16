---
spec: keyboard-shortcuts
phase: research
created: 2026-01-15
---

# Research: keyboard-shortcuts

## Executive Summary

The Logwell codebase already has patterns for keyboard handling using Svelte 5's `<svelte:document>` for global key events and individual component `onkeydown` handlers. The proposed j/k navigation shortcuts align with established web app conventions (Gmail, GitHub) and the chosen keys avoid browser conflicts. Implementation requires minimal code changes: a single keyboard handler at the page level with state for selected log index.

## External Research

### Best Practices

- **Single-key shortcuts for navigation are safe**: j/k (vim-style navigation), / (search focus), l (toggle) do not conflict with browser shortcuts since they are single lowercase letters without modifiers. Browser shortcuts use Ctrl/Cmd modifiers. [Source: xjavascript.com](https://www.xjavascript.com/blog/available-keyboard-shortcuts-for-web-applications/)
- **Must ignore shortcuts when focus is in form fields**: User typing in search input should not trigger j/k navigation. Standard pattern: check `event.target.tagName` for INPUT, TEXTAREA, SELECT. [Source: golsteyn.com](https://golsteyn.com/writing/designing-keyboard-shortcuts/)
- **Use `event.key` not deprecated `keyCode`**: Modern standard for keyboard event handling. [Source: xjavascript.com](https://www.xjavascript.com/blog/available-keyboard-shortcuts-for-web-applications/)
- **Discoverability is critical**: Shortcuts are useless if users do not know they exist. Options: help modal (? key), tooltips, keyboard shortcut reference. [Source: golsteyn.com](https://golsteyn.com/writing/designing-keyboard-shortcuts/)

### Prior Art

| Application | j/k Navigation | / Search | Esc Close | Other |
|-------------|---------------|----------|-----------|-------|
| Gmail | Yes | Yes | Yes | - |
| GitHub | Yes | Yes | Yes | - |
| YouTube | - | / | Esc | ? for help |
| VS Code | - | Ctrl+F | Esc | Cmd+K palette |
| Datadog | Yes | / | Esc | l for live |

The proposed shortcuts match established patterns in log viewers and productivity apps.

### Pitfalls to Avoid

1. **Not checking `event.target`**: j/k will trigger when typing in search box unless explicitly guarded
2. **Not using `event.preventDefault()`**: / key would type "/" in some browsers without prevention
3. **Forgetting `isComposing`**: For international keyboards with IME, ignore shortcuts during composition
4. **Modal state conflicts**: When modal is open, j/k should not navigate behind it

## Codebase Analysis

### Existing Patterns

| Component | Keyboard Pattern | File |
|-----------|-----------------|------|
| `log-detail-modal.svelte` | `<svelte:document onkeydown={handleKeyDown}>` for Escape | `/src/lib/components/log-detail-modal.svelte` |
| `create-project-modal.svelte` | Same pattern for Escape | `/src/lib/components/create-project-modal.svelte` |
| `filter-panel.svelte` | `window.addEventListener('keydown', ...)` in $effect | `/src/lib/components/filter-panel.svelte` |
| `log-row.svelte` | Local `onkeydown` for Enter/Space activation | `/src/lib/components/log-row.svelte` |
| `log-card.svelte` | Same as log-row | `/src/lib/components/log-card.svelte` |
| `focus-trap.ts` | Tab key trapping for modals | `/src/lib/utils/focus-trap.ts` |

**Key finding**: The codebase uses `<svelte:document onkeydown={handler}>` for global shortcuts (modals). This is the recommended Svelte 5 pattern - it handles SSR safely and cleans up automatically.

### Component State Analysis

The log viewer page (`/src/routes/(app)/projects/[id]/+page.svelte`) already has:

| State Variable | Type | Current Location | Notes |
|---------------|------|------------------|-------|
| `allLogs` | `Log[]` | Derived from `streamedLogs` + `data.logs` + `loadedMoreLogs` | Array to navigate |
| `selectedLog` | `Log \| null` | Page state | Currently used for modal |
| `showDetailModal` | `boolean` | Page state | Modal open state |
| `liveEnabled` | `boolean` | Page state | Toggle target for 'l' key |
| `searchValue` | `string` | Page state | Search input value |

**Missing state**: `selectedIndex` - Need to add this to track which log is "focused" for j/k navigation.

### Search Input Analysis

`SearchInput` component uses shadcn-svelte `Input` which exposes `ref` bindable. The Input component:
- Has `bind:this={ref}` available
- No existing `id` attribute set in search-input.svelte
- Can be focused via `inputRef.focus()`

**Approach for / shortcut**: Add `ref` binding to SearchInput and expose a `focus()` method or pass ref up to parent.

### Live Toggle Analysis

`LiveToggle` component uses `bind:enabled`. The parent page already has:
```ts
let liveEnabled = $state(true);
<LiveToggle bind:enabled={liveEnabled} ... />
```

**Approach for l shortcut**: Simply toggle `liveEnabled = !liveEnabled` in the page-level handler.

### Log Table / Row Analysis

`LogTable` renders `LogRow` components in a `<tbody>`. Each row:
- Has `tabindex="0"` for keyboard accessibility
- Handles Enter/Space for activation
- Receives `onclick` callback

**Challenge**: Rows are in a table, not a flat list. Need to scroll selected row into view.

**Approach**:
1. Track `selectedIndex` in page state
2. Pass `selectedIndex` to `LogTable`
3. Apply visual highlight class to selected row
4. Call `scrollIntoView()` on navigation

### Dependencies

No new dependencies needed. All required patterns exist:
- `<svelte:document>` for global events
- `$state` for selected index
- `scrollIntoView` is native browser API
- `focus()` is native

### Constraints

1. **Mobile view uses cards, not table**: `LogCard` component on `sm:hidden`. Navigation must work on both.
2. **Empty state**: When `logs.length === 0`, j/k should do nothing
3. **Loading state**: When `loading === true`, j/k should do nothing
4. **Modal open**: When `showDetailModal === true`, j/k should not navigate (handled by existing Escape listener)
5. **Live streaming**: New logs prepend to list. Navigation should handle index shift.

## Feasibility Assessment

| Aspect | Assessment | Notes |
|--------|------------|-------|
| Technical Viability | High | All patterns already exist in codebase |
| Effort Estimate | S | Single file change + minor child prop updates |
| Risk Level | Low | No external dependencies, no API changes |

## Recommendations for Requirements

1. **Use existing `<svelte:document>` pattern** - Consistent with modal handling
2. **Add `selectedIndex` state to page** - Simple number, -1 when nothing selected
3. **Guard against form focus** - Check `event.target` is not INPUT/TEXTAREA/SELECT
4. **Scroll into view on navigation** - Use `scrollIntoView({ block: 'nearest', behavior: 'smooth' })`
5. **Visual highlight for selected log** - Add class when `index === selectedIndex`
6. **Help discoverability via ? key** - Show shortcuts modal (matches YouTube pattern)
7. **Screen reader announcement** - Use existing `announceToScreenReader` utility on navigation

## Open Questions

1. **Should j/k wrap around?** - Go from last to first and vice versa? Gmail does not wrap.
2. **Should selection persist across filter changes?** - Probably reset to -1 (no selection)
3. **Should ? show a dedicated shortcuts help modal or a tooltip/toast?** - Modal is more discoverable but adds a component.

## Quality Commands

| Type | Command | Source |
|------|---------|--------|
| Lint | `bun run lint` | package.json scripts.lint |
| TypeCheck | `bun run check` | package.json scripts.check |
| Unit Test | `bun run test:unit` | package.json scripts.test:unit |
| Integration Test | `bun run test:integration` | package.json scripts.test:integration |
| E2E Test | `bun run test:e2e` | package.json scripts.test:e2e |
| Component Test | `bun run test:component` | package.json scripts.test:component |
| Build | `bun run build` | package.json scripts.build |
| Knip | `bun run knip` | package.json scripts.knip |

**Local CI**: `bun run lint && bun run check && bun run test:unit && bun run test:component && bun run build`

## Related Specs

No other specs found in `./specs/` directory besides current `keyboard-shortcuts`.

## Sources

- [xjavascript.com - Safe Keyboard Shortcuts](https://www.xjavascript.com/blog/available-keyboard-shortcuts-for-web-applications/)
- [golsteyn.com - Designing Keyboard Shortcuts](https://golsteyn.com/writing/designing-keyboard-shortcuts/)
- [knock.app - Design Great Keyboard Shortcuts](https://knock.app/blog/how-to-design-great-keyboard-shortcuts)
- [Svelte Docs - svelte:document](https://github.com/sveltejs/svelte/blob/main/documentation/docs/05-special-elements/03-svelte-document.md)
- [Svelte Docs - svelte:window](https://github.com/sveltejs/svelte/blob/main/documentation/docs/05-special-elements/02-svelte-window.md)
- `/src/lib/components/log-detail-modal.svelte` - Existing Escape key pattern
- `/src/routes/(app)/projects/[id]/+page.svelte` - Main log viewer page
