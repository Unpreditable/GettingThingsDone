<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { TaskRecord } from "../core/TaskParser";
  import type { BucketConfig } from "../settings";

  export let task: TaskRecord;
  export let quickMoveTargets: BucketConfig[];
  export let isStale: boolean = false;
  export let isAutoPlaced: boolean = false;
  /** True when the task is completed and visible until midnight. */
  export let showCompleted: boolean = false;

  const dispatch = createEventDispatcher<{
    move: { task: TaskRecord; targetBucketId: string | null };
    toggle: { task: TaskRecord };
    navigate: { task: TaskRecord };
    confirm: { task: TaskRecord; bucketId: string };
  }>();

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

  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <span
    class="gtd-task-text"
    on:click={onTextClick}
  >
    {task.text || "(empty task)"}
  </span>

  {#if showTooltip && task.text.length > 40}
    <div class="gtd-tooltip">{task.text}</div>
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

  .gtd-tooltip {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 100%;
    z-index: 100;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: var(--font-ui-smaller);
    box-shadow: var(--shadow-s);
    pointer-events: none;
    word-break: break-word;
    white-space: normal;
  }

  :global(.gtd-task) {
    position: relative;
  }
</style>
