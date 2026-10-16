<script lang="ts">
import './layout.css';
import { ModeWatcher } from 'mode-watcher';
import { Toaster } from '#lib/components/ui/sonner/index.js';

const { children } = $props();
</script>

<!-- app.html runs the initial-mode script itself, with the CSP nonce this injected copy lacks. -->
<ModeWatcher disableHeadScriptInjection />
{@render children()}
<Toaster richColors closeButton position="top-right" />
