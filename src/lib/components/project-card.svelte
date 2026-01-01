<script lang="ts">
import { Button } from '$lib/components/ui/button/index.js';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '$lib/components/ui/card/index.js';
import { formatRelativeTime } from '$lib/utils/format';

interface Project {
  id: string;
  name: string;
  logCount: number;
  lastActivity: Date | null;
}

interface Props {
  project: Project;
}

const { project }: Props = $props();

const formattedLogCount = $derived(project.logCount.toLocaleString('en-US'));
const logLabel = $derived(project.logCount === 1 ? 'log' : 'logs');
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
    <Button variant="outline" href="/projects/{project.id}" class="w-full">
      View Logs
    </Button>
  </CardFooter>
</Card>
