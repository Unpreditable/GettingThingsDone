<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { TaskRecord } from "../core/TaskParser";
  import type { BucketConfig } from "../settings";
  import type { BucketGroup as BucketGroupData } from "../core/BucketManager";

  export let task: TaskRecord;
  export let quickMoveTargets: BucketConfig[];
  export let isStale: boolean = false;
  export let isAutoPlaced: boolean = false;
  /** True when the task is completed and visible until midnight. */
  export let showCompleted: boolean = false;
  export let allTasksMap: Map<string, TaskRecord> = new Map();
  export let taskBucketMap: Map<string, string> = new Map();
  export let bucketGroups: BucketGroupData[] = [];
  export let currentBucketId: string = "";

  const dispatch = createEventDispatcher<{
    move: { task: TaskRecord; targetBucketId: string | null };
    toggle: { task: TaskRecord };
    navigate: { task: TaskRecord };
    confirm: { task: TaskRecord; bucketId: string };
  }>();

  // Parent indicator
  $: parentTask = task.parentId ? allTasksMap.get(task.parentId) ?? null : null;
  $: parentBucketId = task.parentId ? (taskBucketMap.get(task.parentId) ?? null) : null;
  // Arrow shown only when the direct parent lives in a different bucket
  $: showParentArrow = task.parentId !== null && parentBucketId !== currentBucketId;
  $: parentBucketName = (() => {
    if (!parentBucketId) return null;
    const group = bucketGroups.find((g) => g.bucketId === parentBucketId);
    return group ? `${group.emoji} ${group.name}` : null;
  })();
  $: parentTooltip = parentTask
    ? `Subtask of: ${parentTask.text}${parentBucketName ? ` (in ${parentBucketName})` : ""}`
    : null;

  // Visual indent: count how many ancestors are in the same bucket
  // (so depth resets to 0 when the chain crosses a bucket boundary)
  $: visualIndentLevel = (() => {
    if (!task.parentId) return 0;
    let level = 0;
    let cur: TaskRecord | undefined = task;
    while (cur?.parentId) {
      const parent = allTasksMap.get(cur.parentId);
      if (!parent) break;
      if (taskBucketMap.get(parent.id) === currentBucketId) level++;
      cur = parent;
    }
    return level;
  })();

  // Subtask count badge: count active descendants
  $: activeDescendantCount = (() => {
    if (task.childIds.length === 0) return 0;
    let count = 0;
    const queue = [...task.childIds];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const child = allTasksMap.get(id);
      if (child) {
        if (!child.isCompleted) count++;
        queue.push(...child.childIds);
      }
    }
    return count;
  })();

  $: showPopover = showTooltip && (task.text.length > 40 || activeDescendantCount > 0);

  let showTooltip = false;
  let tooltipTimer: ReturnType<typeof setTimeout>;

  function onMouseEnter() {
    tooltipTimer = setTimeout(() => (showTooltip = true), 400);
  }

  function onMouseLeave() {
    clearTimeout(tooltipTimer);
    showTooltip = false;
  }

  function onCheckboxChange() {
    dispatch("toggle", { task });
  }

  function onTextClick(e: MouseEvent) {
    e.stopPropagation();
    dispatch("navigate", { task });
  }

  function onMoveClick(e: MouseEvent, bucketId: string | null) {
    e.stopPropagation();
    dispatch("move", { task, targetBucketId: bucketId });
  }

  function onConfirmClick(e: MouseEvent) {
    e.stopPropagation();
    const bucketEl = (e.target as HTMLElement).closest("[data-bucket-id]");
    const bucketId = (bucketEl as HTMLElement | null)?.dataset.bucketId ?? "";
    if (bucketId) dispatch("confirm", { task, bucketId });
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    dispatch("move", { task, targetBucketId: "__context_menu__" });
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="gtd-task"
  class:is-completed={task.isCompleted && showCompleted}
  class:is-stale={isStale}
  style="padding-left: {12 + visualIndentLevel * 16}px"
  on:mouseenter={onMouseEnter}
  on:mouseleave={onMouseLeave}
  on:contextmenu={onContextMenu}
  data-task-id={task.id}
  data-file-path={task.filePath}
  data-line-number={task.lineNumber}
>
  <input
    type="checkbox"
    class="gtd-task-checkbox"
    checked={task.isCompleted}
    on:change={onCheckboxChange}
  />

  {#if isStale}
    <span class="gtd-stale-badge" title="Past scheduled window">!</span>
  {/if}

  {#if isAutoPlaced}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <span
      class="gtd-auto-badge"
      title="Auto-placed from due date — click to confirm placement"
      on:click={onConfirmClick}
    >👁</span>
  {/if}

  {#if showParentArrow}
    <span class="gtd-parent-badge" title={parentTooltip ?? "Subtask"}>↖</span>
  {/if}

  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <span
    class="gtd-task-text"
    on:click={onTextClick}
  >
    {task.text || "(empty task)"}
  </span>

  {#if activeDescendantCount > 0}
    <span class="gtd-subtask-badge">({activeDescendantCount})</span>
  {/if}

  {#if showPopover}
    <div class="gtd-tooltip">
      {#if task.text.length > 40}
        <div class="gtd-tooltip-text">{task.text}</div>
      {/if}
      {#if activeDescendantCount > 0}
        {#if task.text.length > 40}
          <hr class="gtd-tooltip-divider" />
        {/if}
        <div class="gtd-tooltip-subtask-header">{activeDescendantCount} active subtask{activeDescendantCount === 1 ? "" : "s"}</div>
      {/if}
    </div>
  {/if}

  <div class="gtd-task-actions">
    {#each quickMoveTargets as bucket}
      <button
        class="gtd-task-move-btn"
        title="Move to {bucket.name}"
        on:click={(e) => onMoveClick(e, bucket.id)}
      >
        {bucket.emoji}
      </button>
    {/each}
  </div>
</div>

<style>
  .gtd-stale-badge {
    flex-shrink: 0;
    color: var(--text-error);
    font-weight: 700;
    font-size: 13px;
    line-height: 1;
    padding-right: 2px;
  }

  .gtd-auto-badge {
    flex-shrink: 0;
    font-size: 13px;
    line-height: 1;
    padding-right: 2px;
    cursor: pointer;
    opacity: 0.7;
  }

  .gtd-auto-badge:hover {
    opacity: 1;
  }

  .gtd-parent-badge {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 1;
    padding-right: 2px;
    color: var(--text-muted);
    cursor: default;
  }

  .gtd-subtask-badge {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 1;
    padding-left: 4px;
    color: var(--text-muted);
    white-space: nowrap;
    cursor: default;
  }

  .gtd-tooltip {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 100%;
    z-index: 100;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: var(--font-ui-smaller);
    box-shadow: var(--shadow-s);
    pointer-events: none;
    word-break: break-word;
    white-space: normal;
  }

  .gtd-tooltip-text {
    color: var(--text-normal);
  }

  .gtd-tooltip-divider {
    border: none;
    border-top: 1px solid var(--background-modifier-border);
    margin: 5px 0;
  }

  .gtd-tooltip-subtask-header {
    color: var(--text-muted);
    font-weight: 600;
    margin-bottom: 2px;
  }


  :global(.gtd-task) {
    position: relative;
  }
</style>
