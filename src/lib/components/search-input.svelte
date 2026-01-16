<script lang="ts">
import { Search } from '@lucide/svelte';
import { Input } from '$lib/components/ui/input/index.js';

const DEBOUNCE_DELAY_MS = 300;

interface Props {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onsearch?: (value: string) => void;
  ref?: HTMLInputElement | null;
  onEscape?: () => void;
}

let {
  value = $bindable(''),
  placeholder = 'Search...',
  disabled = false,
  onsearch,
  ref = $bindable(null),
  onEscape,
}: Props = $props();

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    ref?.blur();
    onEscape?.();
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function clearDebounceTimer() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  value = target.value;

  clearDebounceTimer();

  debounceTimer = setTimeout(() => {
    onsearch?.(value.trim());
  }, DEBOUNCE_DELAY_MS);
}

// Cleanup on component destroy
$effect(() => {
  return () => {
    clearDebounceTimer();
  };
});
</script>

<div class="relative">
  <Search
    class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
    data-testid="search-icon"
  />
  <Input
    type="text"
    {placeholder}
    {disabled}
    {value}
    oninput={handleInput}
    onkeydown={handleKeydown}
    bind:ref
    class="pl-9"
  />
</div>
