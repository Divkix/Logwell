<script lang="ts">
import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
import PlusIcon from '@lucide/svelte/icons/plus';
import { navigating } from '$app/stores';
import CreateProjectModal from '$lib/components/create-project-modal.svelte';
import DashboardSkeleton from '$lib/components/dashboard-skeleton.svelte';
import ProjectCard from '$lib/components/project-card.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { toastError, toastSuccess } from '$lib/utils/toast';
import type { PageData } from './$types';

const { data }: { data: PageData } = $props();

// Show skeleton when navigating TO this page
const isLoading = $derived(
  $navigating?.to?.url.pathname === '/' || $navigating?.to?.url.pathname === '',
);

// Create a local copy of projects for state management
// svelte-ignore state_referenced_locally
let projects = $state([...data.projects]);
let isCreateModalOpen = $state(false);

function openCreateModal() {
  isCreateModalOpen = true;
}

function closeCreateModal() {
  isCreateModalOpen = false;
}

async function handleCreateProject(name: string) {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  const result = await response.json();

  if (!response.ok) {
    toastError(result.message || 'Failed to create project');
    throw new Error(result.message || 'Failed to create project');
  }

  // Add new project to the list (at the beginning since we order by createdAt DESC)
  projects = [
    {
      id: result.id,
      name: result.name,
      logCount: 0,
      lastActivity: null,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    },
    ...projects,
  ];

  toastSuccess(`Project "${name}" created successfully`);
}
</script>

{#if isLoading}
  <DashboardSkeleton />
{:else}
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Dashboard</h1>
      <Button onclick={openCreateModal}>
        <PlusIcon class="mr-2 size-4" />
        Create Project
      </Button>
    </div>

    <!-- Content -->
    {#if projects.length === 0}
      <!-- Empty State -->
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <FolderPlusIcon class="size-16 text-muted-foreground/50 mb-4" />
        <h2 class="text-lg font-semibold mb-2">No projects yet</h2>
        <p class="text-muted-foreground mb-6 max-w-md">
          Create your first project to start collecting logs. Each project gets its own API key for
          log ingestion.
        </p>
        <Button onclick={openCreateModal}>
          <PlusIcon class="mr-2 size-4" />
          Create Project
        </Button>
      </div>
    {:else}
      <!-- Project Grid -->
      <div data-testid="project-grid" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {#each projects as project (project.id)}
          <a
            href="/projects/{project.id}"
            data-testid="project-card"
            class="block transition-transform hover:scale-[1.02] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ProjectCard
              project={{
                id: project.id,
                name: project.name,
                logCount: project.logCount,
                lastActivity: project.lastActivity ? new Date(project.lastActivity) : null,
              }}
            />
          </a>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<!-- Create Project Modal -->
<CreateProjectModal
  open={isCreateModalOpen}
  onClose={closeCreateModal}
  onCreate={handleCreateProject}
/>
