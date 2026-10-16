<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#lib/components/ui/card/index.js';
import { formatLogCount, formatRelativeTime } from '#lib/utils/format.js';

interface Project {
  id: string;
  name: string;
  logCount: number;
  /** True when logCount is the server's count ceiling, not an exact total. */
  logCountCapped?: boolean;
  lastActivity: Date | null;
}

interface Props {
  project: Project;
}

const { project }: Props = $props();

const formattedLogCount = $derived(formatLogCount(project.logCount, project.logCountCapped));

const logLabel = $derived(project.logCount === 1 && !project.logCountCapped ? 'log' : 'logs');

const lastActivityText = $derived(
  project.lastActivity ? `Last log: ${formatRelativeTime(project.lastActivity)}` : 'No logs yet',
);
</script>

<Card class="flex flex-col">
  <CardHeader>
    <CardTitle class="text-lg">{project.name}</CardTitle>
  </CardHeader>
  <CardContent class="flex-1">
    <p class="text-sm text-muted-foreground">{formattedLogCount} {logLabel}</p>
    <p class="text-sm text-muted-foreground">{lastActivityText}</p>
  </CardContent>
  <CardFooter>
    <Button variant="outline" class="w-full">
      View Logs
    </Button>
  </CardFooter>
</Card>
