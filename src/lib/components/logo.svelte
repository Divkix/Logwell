<script lang="ts">
interface Props {
  size?: number;
  class?: string;
}

const { size = 24, class: className = '' }: Props = $props();
</script>

<svg
  viewBox="0 0 512 512"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  class={className}
  aria-label="Logwell logo"
>
  <rect x="128" y="148" width="256" height="48" rx="24" class="fill-foreground" />
  <rect x="128" y="228" width="256" height="48" rx="24" class="fill-foreground/60" />
  <rect x="128" y="308" width="160" height="48" rx="24" class="fill-foreground/25" />
</svg>
