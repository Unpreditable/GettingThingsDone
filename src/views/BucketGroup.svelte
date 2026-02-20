<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import Sortable from "sortablejs";
  import TaskItem from "./TaskItem.svelte";
  import type { TaskRecord } from "../core/TaskParser";
  import type { BucketConfig } from "../settings";

  export let bucketId: string;
  export let name: string;
  export let emoji: string = "";
  export let tasks: TaskRecord[];
  export let staleTaskIds: string[] = [];
  export let autoPlacedTaskIds: string[] = [];
  export let quickMoveTargets: BucketConfig[];
  export let showCompletedUntilMidnight: boolean = true;

  const dispatch = createEventDispatcher<{
    move: { task: TaskRecord; targetBucketId: string | null };
    toggle: { task: TaskRecord };
    navigate: { task: TaskRecord };
    confirm: { task: TaskRecord; bucketId: string };
    drop: { taskId: string; sourceBucketId: string; targetBucketId: string };
  }>();

  let collapsed = false;
  let taskListEl: HTMLElement;
  let sortable: Sortable;

  $: staleSet = new Set(staleTaskIds);
  $: autoPlacedSet = new Set(autoPlacedTaskIds);
  $: activeTasks = tasks.filter((t) => !t.isCompleted);
  $: completedTasks = (() => {
    if (!showCompletedUntilMidnight) return [];
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return tasks.filter((t) => t.isCompleted && (!t.completedAt || t.completedAt >= midnight));
  })();
  $: totalCount = activeTasks.length + completedTasks.length;

  function toggleCollapsed() {
    collapsed = !collapsed;
  }

  onMount(() => {
    if (!taskListEl) return;
    sortable = Sortable.create(taskListEl, {
      group: "gtd-tasks",
      animation: 150,
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      dataIdAttr: "data-task-id",
      onAdd(evt) {
        const taskId = evt.item.dataset.taskId ?? "";
        const sourceBucketId = evt.from.dataset.bucketId ?? "";
        evt.from.appendChild(evt.item);
        dispatch("drop", { taskId, sourceBucketId, targetBucketId: bucketId });
      },
    });
  });

  onDestroy(() => {
    sortable?.destroy();
  });
</script>

<div class="gtd-bucket" data-bucket-id={bucketId}>
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div
    class="gtd-bucket-header"
    class:collapsed
    on:click={toggleCollapsed}
  >
    <span class="gtd-collapse-icon">{collapsed ? "▶" : "▼"}</span>
    {#if emoji}
      <span class="gtd-bucket-emoji">{emoji}</span>
    {/if}
    <span class="gtd-bucket-name">{name}</span>
    {#if totalCount > 0}
      <span class="gtd-bucket-count">
        {#if activeTasks.length < totalCount}
          {activeTasks.length}/{totalCount}
        {:else}
          {totalCount}
        {/if}
      </span>
    {/if}
  </div>

  {#if !collapsed}
    <div
      class="gtd-bucket-tasks"
      bind:this={taskListEl}
      data-bucket-id={bucketId}
    >
      <!-- Completed tasks (strikethrough) first -->
      {#each completedTasks as task (task.id)}
        <TaskItem
          {task}
          {quickMoveTargets}
          isStale={staleSet.has(task.id)}
          isAutoPlaced={false}
          showCompleted={true}
          on:move={(e) => dispatch("move", e.detail)}
          on:toggle={(e) => dispatch("toggle", e.detail)}
          on:navigate={(e) => dispatch("navigate", e.detail)}
          on:confirm={(e) => dispatch("confirm", e.detail)}
        />
      {/each}

      <!-- Active tasks (stale ones show ! indicator inline) -->
      {#each activeTasks as task (task.id)}
        <TaskItem
          {task}
          {quickMoveTargets}
          isStale={staleSet.has(task.id)}
          isAutoPlaced={autoPlacedSet.has(task.id)}
          on:move={(e) => dispatch("move", e.detail)}
          on:toggle={(e) => dispatch("toggle", e.detail)}
          on:navigate={(e) => dispatch("navigate", e.detail)}
          on:confirm={(e) => dispatch("confirm", e.detail)}
        />
      {/each}

      {#if totalCount === 0}
        <div class="gtd-empty-bucket">—</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .gtd-bucket-emoji {
    font-size: 14px;
    line-height: 1;
    flex-shrink: 0;
  }

  .gtd-empty-bucket {
    padding: 4px 12px;
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    font-style: italic;
  }
</style>
