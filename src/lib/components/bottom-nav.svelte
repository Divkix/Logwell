<script lang="ts">
import ChartPieIcon from '@lucide/svelte/icons/chart-pie';
import HomeIcon from '@lucide/svelte/icons/home';
import ListIcon from '@lucide/svelte/icons/list';
import SettingsIcon from '@lucide/svelte/icons/settings';
import { page } from '$app/stores';
import { cn } from '$lib/utils';

interface Props {
  /**
   * Project ID for project-specific navigation (logs, stats, settings)
   */
  projectId?: string;
  /**
   * Callback when settings button is clicked
   */
  onSettingsClick?: () => void;
}

const { projectId, onSettingsClick }: Props = $props();

// Determine active page
const currentPath = $derived($page.url.pathname);
const isHomePage = $derived(currentPath === '/');
const isLogsPage = $derived(projectId && currentPath === `/projects/${projectId}`);
const isStatsPage = $derived(projectId && currentPath === `/projects/${projectId}/stats`);

const navItemClass = 'flex flex-col items-center gap-1 py-2 px-3 text-xs transition-colors';
const activeClass = 'text-primary';
const inactiveClass = 'text-muted-foreground hover:text-foreground';
</script>

<!-- Bottom navigation - mobile only (< 640px) -->
<nav
  data-testid="bottom-nav"
  class="fixed bottom-0 left-0 right-0 z-50 bg-background border-t sm:hidden"
  aria-label="Main navigation"
>
  <div class="flex items-center justify-around py-1">
    <!-- Home/Dashboard -->
    <a
      href="/"
      data-testid="nav-home"
      data-active={isHomePage}
      class={cn(navItemClass, isHomePage ? activeClass : inactiveClass)}
      aria-current={isHomePage ? 'page' : undefined}
    >
      <HomeIcon class="size-5" />
      <span>Home</span>
    </a>

    {#if projectId}
      <!-- Logs -->
      <a
        href="/projects/{projectId}"
        data-testid="nav-logs"
        data-active={isLogsPage}
        class={cn(navItemClass, isLogsPage ? activeClass : inactiveClass)}
        aria-current={isLogsPage ? 'page' : undefined}
      >
        <ListIcon class="size-5" />
        <span>Logs</span>
      </a>

      <!-- Stats -->
      <a
        href="/projects/{projectId}/stats"
        data-testid="nav-stats"
        data-active={isStatsPage}
        class={cn(navItemClass, isStatsPage ? activeClass : inactiveClass)}
        aria-current={isStatsPage ? 'page' : undefined}
      >
        <ChartPieIcon class="size-5" />
        <span>Stats</span>
      </a>

      <!-- Settings -->
      <button
        data-testid="nav-settings"
        type="button"
        class={cn(navItemClass, inactiveClass)}
        onclick={onSettingsClick}
        aria-label="Settings"
      >
        <SettingsIcon class="size-5" />
        <span>Settings</span>
      </button>
    {/if}
  </div>
</nav>
