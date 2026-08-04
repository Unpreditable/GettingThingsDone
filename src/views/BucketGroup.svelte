<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import Sortable from "sortablejs";
  import TaskItem from "./TaskItem.svelte";
  import type { TaskRecord } from "../core/TaskParser";
  import type { BucketConfig } from "../settings";
  import type { BucketGroup as BucketGroupData } from "../core/BucketManager";
  import { TO_REVIEW_ID } from "../core/BucketManager";
  import { isDragging } from "./dragState";

  export let bucketId: string;
  export let name: string;
  export let emoji: string = "";
  export let tasks: TaskRecord[];
  export let staleTaskIds: string[] = [];
  export let autoPlacedTaskIds: string[] = [];
  export let agedCompletedTaskIds: string[] = [];
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
    drop: {
      taskId: string;
      sourceBucketId: string;
      targetBucketId: string;
      orderedTaskIds: string[] | null;
    };
    reorder: { bucketId: string; orderedTaskIds: string[] };
  }>();

  let dismissedIds = new Set<string>();

  let collapsed = false;
  let headerDragOver = false;
  let taskListEl: HTMLElement;
  let sortable: Sortable;

  $: staleSet = new Set(staleTaskIds);
  $: autoPlacedSet = new Set(autoPlacedTaskIds);
  $: agedSet = new Set(agedCompletedTaskIds);
  $: {
    // When a task is unchecked, remove it from dismissedIds so it reappears
    let changed = false;
    for (const t of tasks) {
      if (!t.isCompleted && dismissedIds.has(t.id)) {
        dismissedIds.delete(t.id);
        changed = true;
      }
    }
    if (changed) dismissedIds = dismissedIds;
  }
  $: visibleTasks = tasks.filter((t) => {
    if (dismissedIds.has(t.id)) return false;
    if (!t.isCompleted) return true;
    if (!showCompletedUntilMidnight) return false;
    return !agedSet.has(t.id);
  });
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
    dispatch("drop", { taskId, sourceBucketId, targetBucketId: bucketId, orderedTaskIds: null });
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

  /** Same as getDescendantIdsInBucket, but scoped to an arbitrary bucket ID
   * rather than this component's own bucketId — needed because onMove's
   * Constraint 2 must check descendants in the DROP TARGET bucket, which
   * during a cross-bucket drag is not this component's bucketId (onMove
   * fires on the source sortable; see the targetBucket comment below). */
  function getDescendantIdsInBucketId(task: TaskRecord, targetBucketId: string): Set<string> {
    const result = new Set<string>();
    const queue = [...task.childIds];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (taskBucketMap.get(id) === targetBucketId) {
        result.add(id);
        const child = allTasksMap.get(id);
        if (child) queue.push(...child.childIds);
      }
    }
    return result;
  }

  /**
   * A drag only ever moves the one row you grabbed — a dragged parent's
   * same-bucket children are still sitting wherever they physically were.
   * This moves them (preserving their own relative order) to immediately
   * after draggedId in the raw captured order, so same-bucket drags are
   * correct at the moment of capture rather than relying on a later
   * render-time pass. For a cross-bucket drop this can only catch children
   * that already independently lived in the target bucket — an
   * auto-inheriting child isn't part of orderedIds yet at all, since it
   * only appears in this bucket after the file write is reindexed.
   */
  function reattachDescendants(orderedIds: string[], draggedId: string): string[] {
    const draggedTask = allTasksMap.get(draggedId);
    if (!draggedTask) return orderedIds;
    const descIds = getDescendantIdsInBucket(draggedTask);
    if (descIds.size === 0) return orderedIds;

    const descendantsInOrder = orderedIds.filter((id) => descIds.has(id));
    const result: string[] = [];
    for (const id of orderedIds) {
      if (descIds.has(id)) continue;
      result.push(id);
      if (id === draggedId) result.push(...descendantsInOrder);
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
      onStart() {
        isDragging.set(true);
      },
      onEnd() {
        isDragging.set(false);
      },
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
        // share the same group root, only members of that group may be placed there
        // — including the case where the dragged task IS that group's own root: a
        // parent can't be dropped in between two of its own children either.
        if (beforeId && afterId) {
          const beforeRoot = targetGroupRoot(beforeId);
          const afterRoot = targetGroupRoot(afterId);
          if (beforeRoot === afterRoot) {
            if (draggedRoot !== beforeRoot) return false;
            if (draggedId === beforeRoot) return false;
          }
        }

        // Constraint 2: A subtask can't be placed above its parent, and must stay within
        // its group's contiguous range — checked against the TARGET bucket (not this
        // component's own bucketId, which during a cross-bucket drag is the SOURCE), so
        // this applies whether the parent already lives in the target bucket via a
        // same-bucket reorder or a cross-bucket drop. (A dragged PARENT has no
        // equivalent restriction here — onAdd/onUpdate above already reattach a moved
        // parent's same-bucket children to follow it wherever it's dropped, and
        // BucketManager's regroupByHierarchy is a render-time backstop for the rest —
        // so the parent is free to move to any top-level position, just never literally
        // in between its own children per Constraint 1 above.)
        const parentId = draggedTask.parentId;
        if (parentId && taskBucketMap.get(parentId) === targetBucket) {
          const parentIdx = currentIds.indexOf(parentId);
          if (parentIdx !== -1 && insertIdx <= parentIdx) return false;

          const parentTask = allTasksMap.get(parentId);
          if (parentTask) {
            const groupIds = getDescendantIdsInBucketId(parentTask, targetBucket);
            groupIds.add(parentId);
            let lastGroupIdx = -1;
            for (let i = 0; i < currentIds.length; i++) {
              if (groupIds.has(currentIds[i])) lastGroupIdx = i;
            }
            if (lastGroupIdx !== -1 && insertIdx > lastGroupIdx + 1) return false;
          }
        }

        return true;
      },
      onAdd(evt) {
        const taskId = evt.item.dataset.taskId ?? "";
        const sourceBucketId = evt.from.dataset.bucketId ?? "";
        const rawOrderedTaskIds = Array.from(evt.to.children)
          .map((el) => (el as HTMLElement).dataset.taskId ?? "")
          .filter(Boolean);
        const orderedTaskIds = reattachDescendants(rawOrderedTaskIds, taskId);
        // SortableJS already moved evt.item into evt.to's DOM at the drop
        // position (that's what triggered onAdd) — read it above, then
        // revert the manual DOM move so Svelte's keyed {#each} in the
        // *source* bucket doesn't lose track of a node it still thinks it
        // owns. The real re-render happens once the drop/reorder handlers
        // persist the new order and the store refreshes.
        evt.from.appendChild(evt.item);
        dispatch("drop", { taskId, sourceBucketId, targetBucketId: bucketId, orderedTaskIds });
      },
      onUpdate(evt) {
        const taskId = evt.item.dataset.taskId ?? "";
        const rawOrderedTaskIds = Array.from(evt.to.children)
          .map((el) => (el as HTMLElement).dataset.taskId ?? "")
          .filter(Boolean);
        const orderedTaskIds = reattachDescendants(rawOrderedTaskIds, taskId);
        evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex ?? 0] ?? null);
        dispatch("reorder", { bucketId, orderedTaskIds });
      },
    });
  });

  onDestroy(() => {
    sortable?.destroy();
  });

  export function dismissAllVisible() {
    const completed = visibleTasks.filter((t) => t.isCompleted);
    for (const t of completed) dismissedIds.add(t.id);
    if (completed.length > 0) dismissedIds = dismissedIds;
  }
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
          on:dismiss={(e) => { dismissedIds.add(e.detail.task.id); dismissedIds = dismissedIds; }}
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
