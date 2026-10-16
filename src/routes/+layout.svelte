<script lang="ts">
import './layout.css';
import { ModeWatcher } from 'mode-watcher';
import { Toaster } from '#lib/components/ui/sonner/index.js';

const { children } = $props();
</script>

<ModeWatcher />
{@render children()}
<Toaster richColors closeButton position="top-right" />
