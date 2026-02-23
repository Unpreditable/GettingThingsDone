<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import Sortable from "sortablejs";
  import TaskItem from "./TaskItem.svelte";
  import type { TaskRecord } from "../core/TaskParser";
  import type { BucketConfig } from "../settings";
  import type { BucketGroup as BucketGroupData } from "../core/BucketManager";
  import { TO_REVIEW_ID } from "../core/BucketManager";

  export let bucketId: string;
  export let name: string;
  export let emoji: string = "";
  export let tasks: TaskRecord[];
  export let staleTaskIds: string[] = [];
  export let autoPlacedTaskIds: string[] = [];
  export let quickMoveTargets: BucketConfig[];
  export let showCompletedUntilMidnight: boolean = true;
  export let allTasksMap: Map<string, TaskRecord> = new Map();
  export let taskBucketMap: Map<string, string> = new Map();
  export let bucketGroups: BucketGroupData[] = [];

  const dispatch = createEventDispatcher<{
    move: { task: TaskRecord; targetBucketId: string | null };
    toggle: { task: TaskRecord };
    navigate: { task: TaskRecord };
    confirm: { task: TaskRecord; bucketId: string };
    drop: { taskId: string; sourceBucketId: string; targetBucketId: string };
  }>();

  let collapsed = false;
  let headerDragOver = false;
  let taskListEl: HTMLElement;
  let sortable: Sortable;

  $: staleSet = new Set(staleTaskIds);
  $: autoPlacedSet = new Set(autoPlacedTaskIds);
  $: visibleTasks = (() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return tasks.filter((t) => {
      if (!t.isCompleted) return true;
      if (!showCompletedUntilMidnight) return false;
      return !t.completedAt || t.completedAt >= midnight;
    });
  })();
  $: activeCount = tasks.filter((t) => !t.isCompleted).length;
  $: totalCount = visibleTasks.length;

  function toggleCollapsed() {
    collapsed = !collapsed;
  }

  function handleHeaderDragEnter(e: DragEvent) {
    if (!collapsed || bucketId === TO_REVIEW_ID) return;
    e.preventDefault();
    headerDragOver = true;
  }

  function handleHeaderDragOver(e: DragEvent) {
    if (!collapsed || bucketId === TO_REVIEW_ID) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }

  function handleHeaderDragLeave(e: DragEvent) {
    if (!collapsed || bucketId === TO_REVIEW_ID) return;
    headerDragOver = false;
  }

  function handleHeaderDrop(e: DragEvent) {
    if (!collapsed || bucketId === TO_REVIEW_ID) return;
    e.preventDefault();
    headerDragOver = false;
    const dragged = Sortable.dragged;
    if (!dragged) return;
    const taskId = dragged.dataset.taskId ?? "";
    const sourceBucketId =
      (dragged.parentElement as HTMLElement)?.dataset?.bucketId ?? "";
    if (!taskId || sourceBucketId === bucketId) return;
    dispatch("drop", { taskId, sourceBucketId, targetBucketId: bucketId });
  }

  /**
   * Returns the ID of the topmost ancestor of taskId whose bucket is this bucket.
   * Tasks with no in-bucket ancestor are their own group root.
   * This defines the "group" a task belongs to within this bucket.
   */
  function getGroupRoot(taskId: string): string {
    let cur = allTasksMap.get(taskId);
    let rootId = taskId;
    while (cur?.parentId && taskBucketMap.get(cur.parentId) === bucketId) {
      rootId = cur.parentId;
      cur = allTasksMap.get(cur.parentId);
    }
    return rootId;
  }

  /** IDs of all descendants of task that are currently in this bucket. */
  function getDescendantIdsInBucket(task: TaskRecord): Set<string> {
    const result = new Set<string>();
    const queue = [...task.childIds];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (taskBucketMap.get(id) === bucketId) {
        result.add(id);
        const child = allTasksMap.get(id);
        if (child) queue.push(...child.childIds);
      }
    }
    return result;
  }

  onMount(() => {
    if (!taskListEl) return;
    sortable = Sortable.create(taskListEl, {
      group: { name: "gtd-tasks", put: bucketId !== TO_REVIEW_ID },
      animation: 150,
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      dataIdAttr: "data-task-id",
      onMove(evt) {
        const draggedId = evt.dragged.dataset.taskId ?? "";
        const relatedId = (evt.related as HTMLElement).dataset.taskId ?? "";
        const draggedTask = allTasksMap.get(draggedId);
        if (!draggedTask) return true;

        const isCrossBucket = evt.to !== evt.from;

        // For cross-bucket drags, onMove fires on the SOURCE sortable, so our
        // `visibleTasks` is from the wrong bucket. Read the target's task order
        // from its DOM children instead (excluding the dragged ghost element).
        const currentIds = isCrossBucket
          ? Array.from(evt.to.children)
              .map((el) => (el as HTMLElement).dataset.taskId ?? "")
              .filter((id) => id && id !== draggedId)
          : visibleTasks.map((t) => t.id).filter((id) => id !== draggedId);

        const relatedIdx = currentIds.indexOf(relatedId);
        if (relatedIdx === -1) return true;

        const insertIdx = (evt.willInsertAfter ?? false) ? relatedIdx + 1 : relatedIdx;
        const beforeId = insertIdx > 0 ? currentIds[insertIdx - 1] : null;
        const afterId = insertIdx < currentIds.length ? currentIds[insertIdx] : null;

        // For cross-bucket drags the target bucket ID comes from the DOM container.
        const targetBucket = isCrossBucket
          ? (evt.to as HTMLElement).dataset.bucketId ?? bucketId
          : bucketId;

        // Group root within the TARGET bucket.
        function targetGroupRoot(taskId: string): string {
          let cur = allTasksMap.get(taskId);
          let rootId = taskId;
          while (cur?.parentId && taskBucketMap.get(cur.parentId) === targetBucket) {
            rootId = cur.parentId;
            cur = allTasksMap.get(cur.parentId);
          }
          return rootId;
        }

        const draggedRoot = targetGroupRoot(draggedId);

        // Constraint 1 (cross- and same-bucket): the insertion point must not lie
        // inside another task's group. If the elements immediately before AND after
        // share the same group root, only members of that group may be placed there.
        if (beforeId && afterId) {
          const beforeRoot = targetGroupRoot(beforeId);
          const afterRoot = targetGroupRoot(afterId);
          if (beforeRoot === afterRoot && draggedRoot !== beforeRoot) return false;
        }

        // Remaining constraints only apply within the same bucket.
        if (isCrossBucket) return true;

        const descIds = getDescendantIdsInBucket(draggedTask);

        // Constraint 2: A parent can't be placed below any of its same-bucket descendants.
        for (let i = 0; i < insertIdx; i++) {
          if (descIds.has(currentIds[i])) return false;
        }

        // Constraint 3: A subtask can't be placed above its parent, and must stay within
        // its group's contiguous range.
        const parentId = draggedTask.parentId;
        if (parentId && taskBucketMap.get(parentId) === bucketId) {
          const parentIdx = currentIds.indexOf(parentId);
          if (parentIdx !== -1 && insertIdx <= parentIdx) return false;

          const parentTask = allTasksMap.get(parentId);
          if (parentTask) {
            const groupIds = getDescendantIdsInBucket(parentTask);
            groupIds.add(parentId);
            let lastGroupIdx = -1;
            for (let i = 0; i < currentIds.length; i++) {
              if (groupIds.has(currentIds[i])) lastGroupIdx = i;
            }
            if (lastGroupIdx !== -1 && insertIdx > lastGroupIdx + 1) return false;
          }
        }

        // Constraint 4: A parent can't be placed where non-descendant tasks would appear
        // between it and its first same-bucket descendant (keeps the group contiguous).
        if (descIds.size > 0) {
          let firstDescIdx = currentIds.length;
          for (let i = 0; i < currentIds.length; i++) {
            if (descIds.has(currentIds[i])) { firstDescIdx = i; break; }
          }
          for (let i = insertIdx; i < firstDescIdx; i++) {
            if (!descIds.has(currentIds[i])) return false;
          }
        }

        return true;
      },
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
    class:drag-over={headerDragOver}
    on:click={toggleCollapsed}
    on:dragenter={handleHeaderDragEnter}
    on:dragover={handleHeaderDragOver}
    on:dragleave={handleHeaderDragLeave}
    on:drop={handleHeaderDrop}
  >
    <span class="gtd-collapse-icon">{collapsed ? "▶" : "▼"}</span>
    {#if emoji}
      <span class="gtd-bucket-emoji">{emoji}</span>
    {/if}
    <span class="gtd-bucket-name">{name}</span>
    <span class="gtd-bucket-count">
      {#if activeCount < totalCount}
        {activeCount}/{totalCount}
      {:else}
        {totalCount}
      {/if}
    </span>
  </div>

  <div
    class="gtd-bucket-tasks"
    class:collapsed
    bind:this={taskListEl}
    data-bucket-id={bucketId}
  >
    {#if !collapsed}
      {#each visibleTasks as task (task.id)}
        <TaskItem
          {task}
          {quickMoveTargets}
          isStale={staleSet.has(task.id)}
          isAutoPlaced={!task.isCompleted && autoPlacedSet.has(task.id)}
          showCompleted={task.isCompleted}
          {allTasksMap}
          {taskBucketMap}
          {bucketGroups}
          currentBucketId={bucketId}
          on:move={(e) => dispatch("move", e.detail)}
          on:toggle={(e) => dispatch("toggle", e.detail)}
          on:navigate={(e) => dispatch("navigate", e.detail)}
          on:confirm={(e) => dispatch("confirm", e.detail)}
        />
      {/each}
    {/if}
  </div>
</div>

<style>
  .gtd-collapse-icon {
    display: inline-block;
    width: 1em;
    height: 1em;
    text-align: center;
    line-height: 1;
    flex-shrink: 0;
  }

  .gtd-bucket-emoji {
    font-size: 14px;
    line-height: 1;
    flex-shrink: 0;
  }

  .gtd-bucket-header.collapsed > :global(*) {
    pointer-events: none;
  }

  .gtd-bucket-header.drag-over {
    background: var(--background-modifier-hover);
    outline: 2px dashed var(--interactive-accent);
    outline-offset: -2px;
  }

</style>
