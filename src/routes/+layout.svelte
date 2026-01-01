<script lang="ts">
import './layout.css';
import favicon from '$lib/assets/favicon.svg';
import { Toaster } from '$lib/components/ui/sonner';

const { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
<Toaster richColors closeButton position="top-right" />
