<script lang="ts">
import type { LogLevel } from '$lib/server/db/schema';
import { cn } from '$lib/utils';
import { getLevelColor } from '$lib/utils/colors';

interface LevelData {
  levelCounts: Partial<Record<LogLevel, number>>;
  levelPercentages: Partial<Record<LogLevel, number>>;
}

interface Props {
  data: LevelData;
  class?: string;
}

const { data, class: className }: Props = $props();

// Ordered log levels for consistent rendering
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

// Chart dimensions
const SIZE = 200;
const CENTER = SIZE / 2;
const OUTER_RADIUS = 80;
const INNER_RADIUS = 50;

// Active levels with count > 0
const activeLevels = $derived(LOG_LEVELS.filter((level) => (data.levelCounts[level] ?? 0) > 0));

// Total log count
const totalCount = $derived(
  Object.values(data.levelCounts).reduce((sum, count) => sum + (count ?? 0), 0),
);

// Convert polar coordinates to cartesian
function polarToCartesian(radius: number, angleInDegrees: number): { x: number; y: number } {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(angleInRadians),
    y: CENTER + radius * Math.sin(angleInRadians),
  };
}

// Generate SVG arc path for donut segment
function describeArc(startAngle: number, endAngle: number): string {
  const startOuter = polarToCartesian(OUTER_RADIUS, startAngle);
  const endOuter = polarToCartesian(OUTER_RADIUS, endAngle);
  const startInner = polarToCartesian(INNER_RADIUS, endAngle);
  const endInner = polarToCartesian(INNER_RADIUS, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;

  return [
    'M',
    startOuter.x,
    startOuter.y,
    'A',
    OUTER_RADIUS,
    OUTER_RADIUS,
    0,
    largeArcFlag,
    1,
    endOuter.x,
    endOuter.y,
    'L',
    startInner.x,
    startInner.y,
    'A',
    INNER_RADIUS,
    INNER_RADIUS,
    0,
    largeArcFlag,
    0,
    endInner.x,
    endInner.y,
    'Z',
  ].join(' ');
}

// Segment data with calculated SVG paths
interface Segment {
  level: LogLevel;
  paths: string[];
  color: string;
}

const segments = $derived.by(() => {
  let currentAngle = 0;
  const result: Segment[] = [];

  for (const level of activeLevels) {
    const percentage = data.levelPercentages[level] ?? 0;
    const sweepAngle = (percentage / 100) * 360;
    const endAngle = currentAngle + sweepAngle;
    const color = getLevelColor(level);

    if (sweepAngle >= 360) {
      // Full circle requires two half-arcs for SVG rendering
      result.push({
        level,
        paths: [describeArc(0, 179.99), describeArc(180, 359.99)],
        color,
      });
    } else if (sweepAngle > 0) {
      result.push({
        level,
        paths: [describeArc(currentAngle, endAngle)],
        color,
      });
    }

    currentAngle = endAngle;
  }

  return result;
});

// Format percentage with minimal decimal places
function formatPercentage(value: number): string {
  const formatted = value.toFixed(1);
  return formatted.endsWith('.0') ? Math.round(value).toString() : formatted;
}
</script>

<div
  data-testid="level-chart-container"
  class={cn('flex flex-col gap-4', className)}
  role="figure"
  aria-label="Log level distribution chart"
>
  {#if activeLevels.length === 0}
    <div
      data-testid="level-chart-empty"
      class="flex h-[200px] w-[200px] items-center justify-center rounded-full bg-muted"
    >
      <span class="text-muted-foreground">No data</span>
    </div>
  {:else}
    <div class="relative">
      <svg
        data-testid="level-chart-svg"
        width={SIZE}
        height={SIZE}
        viewBox="0 0 {SIZE} {SIZE}"
        class="overflow-visible"
        role="img"
        aria-label="Donut chart showing log level distribution"
      >
        {#each segments as segment}
          <g data-testid="chart-segment-{segment.level}" fill={segment.color}>
            {#each segment.paths as path}
              <path d={path} />
            {/each}
          </g>
        {/each}
      </svg>
      <div
        data-testid="chart-total"
        class="absolute inset-0 flex flex-col items-center justify-center"
      >
        <span class="text-2xl font-bold">{totalCount}</span>
        <span class="text-xs text-muted-foreground">Total</span>
      </div>
    </div>
  {/if}

  <div
    data-testid="level-chart-legend"
    class="flex flex-col gap-2"
    role="list"
    aria-label="Log level legend"
  >
    {#each activeLevels as level}
      <div
        data-testid="legend-item-{level}"
        class="flex items-center gap-2"
        role="listitem"
      >
        <div
          data-testid="legend-color-{level}"
          class="h-3 w-3 rounded-sm"
          style="background-color: {getLevelColor(level)}"
          aria-hidden="true"
        ></div>
        <span class="text-sm font-medium">{level.toUpperCase()}</span>
        <span class="text-sm text-muted-foreground">{data.levelCounts[level]}</span>
        <span class="text-sm text-muted-foreground">{formatPercentage(data.levelPercentages[level] ?? 0)}%</span>
      </div>
    {/each}
  </div>
</div>
