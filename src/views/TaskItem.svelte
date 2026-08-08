<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { TaskRecord, TaskPriority } from "../core/TaskParser";
  import { stripWikilinks, parseWikilinks } from "../core/TaskParser";
  import type { BucketConfig, PriorityDisplay } from "../settings";
  import type { BucketGroup as BucketGroupData } from "../core/BucketManager";
  import type { DueStatus } from "../core/DueStatus";
  import { t } from "../i18n/i18n";
  import { isRecurring } from "../core/TaskOrder";
  import { isDragging } from "./dragState";
  import { formatTasksFields } from "../core/TasksFieldText";

  export let task: TaskRecord;
  export let quickMoveTargets: BucketConfig[];
  export let dueStatus: DueStatus | null = null;
  export let showDueFlags: boolean = true;
  export let priorityDisplay: PriorityDisplay = "all";
  export let showRecurrenceBadge: boolean = true;
  export let showTasksFieldsInPopover: boolean = true;

  $: showOverdueBadge = showDueFlags && dueStatus?.kind === "overdue";
  $: showMisfiledBadge = showDueFlags && dueStatus?.kind === "misfiled";
  // The row glyphs obey their settings; the popover always tells the truth,
  // so it is gated only by its own toggle.
  $: fieldRows = showTasksFieldsInPopover ? formatTasksFields(task, dueStatus) : [];
  $: isRecurringTask = isRecurring(task);

  const PRIORITY_EMOJI: Record<TaskPriority, string> = {
    highest: "🔺", high: "⏫", medium: "🔼", low: "🔽", lowest: "⏬",
  };
  /** Levels each dropdown entry admits, highest first. */
  const PRIORITY_VISIBLE: Record<PriorityDisplay, TaskPriority[]> = {
    all: ["highest", "high", "medium", "low", "lowest"],
    "medium-up": ["highest", "high", "medium"],
    "high-up": ["highest", "high"],
    hidden: [],
  };
  $: priorityEmoji =
    task.priority && PRIORITY_VISIBLE[priorityDisplay].includes(task.priority)
      ? PRIORITY_EMOJI[task.priority]
      : null;
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
    dismiss: { task: TaskRecord };
  }>();

  $: parentTask = task.parentId ? allTasksMap.get(task.parentId) ?? null : null;
  $: parentBucketId = task.parentId ? (taskBucketMap.get(task.parentId) ?? null) : null;
  $: showParentArrow = task.parentId !== null && parentBucketId !== currentBucketId;
  $: parentBucketName = (() => {
    if (!parentBucketId) return null;
    const group = bucketGroups.find((g) => g.bucketId === parentBucketId);
    return group ? `${group.emoji} ${group.name}` : null;
  })();
  $: parentTooltip = parentTask
    ? `Subtask of: ${parentTask.text}${parentBucketName ? ` (in ${parentBucketName})` : ""}`
    : null;

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

  $: showPopover = showTooltip;
  // A drag reflows sibling rows under the still-stationary cursor (possibly
  // in a different bucket, for a cross-bucket drag), which fires a genuine
  // mouseenter on whichever row lands there. Cancel/hide immediately so that
  // reflow can't pop up this task's tooltip mid-drag.
  $: if ($isDragging) {
    clearTimeout(tooltipTimer);
    showTooltip = false;
  }
  $: sourceFile = task.filePath.split("/").pop() ?? task.filePath;
  $: displayLineNumber = task.lineNumber + 1;

  let showTooltip = false;
  let tooltipTimer: ReturnType<typeof setTimeout>;

  function onMouseEnter() {
    if ($isDragging) return;
    tooltipTimer = setTimeout(() => (showTooltip = true), 800);
  }

  function onMouseLeave() {
    clearTimeout(tooltipTimer);
    showTooltip = false;
  }

  // Hides on mousedown, not just via the isDragging store reactive block:
  // a drag's native drag-image is a DOM snapshot taken essentially at
  // dragstart, which fires shortly after mousedown but before SortableJS's
  // onStart callback runs. If the tooltip was already visible, it would
  // still be in the DOM at snapshot time and get dragged along (faint,
  // since browsers render native drag images at reduced opacity) unless
  // it's already gone by mousedown.
  function onMouseDown() {
    clearTimeout(tooltipTimer);
    showTooltip = false;
  }

  /**
   * The file is the source of truth, so undo the browser's own optimistic
   * flip and let the re-render after the write set the real state. Without
   * this the DOM can keep a tick Svelte never clears: `checked` is one-way,
   * so if this row is reused for a task whose isCompleted is unchanged
   * (a 🔁 recurrence puts a NEW open occurrence on the completed task's
   * line), Svelte sees no value change and leaves the user's tick in place.
   */
  function onCheckboxChange(e: Event) {
    (e.currentTarget as HTMLInputElement).checked = task.isCompleted;
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

  function onDismissClick(e: MouseEvent) {
    e.stopPropagation();
    dispatch("dismiss", { task });
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
  style="padding-left: {12 + visualIndentLevel * 16}px"
  on:mouseenter={onMouseEnter}
  on:mouseleave={onMouseLeave}
  on:mousedown={onMouseDown}
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

  {#if priorityEmoji}
    <span class="gtd-priority-badge">{priorityEmoji}</span>
  {/if}

  {#if isRecurringTask && showRecurrenceBadge}
    <span class="gtd-recurring-badge">🔁</span>
  {/if}

  {#if showOverdueBadge}
    <span class="gtd-overdue-badge">❢</span>
  {/if}

  {#if showMisfiledBadge}
    <span class="gtd-misfiled-badge">⚑</span>
  {/if}

  {#if isAutoPlaced}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <span
      class="gtd-auto-badge"
      title={t("task.autoPlacedTooltip")}
      on:click={onConfirmClick}
    >👁</span>
  {/if}

  {#if showParentArrow}
    <span class="gtd-parent-badge" title={parentTooltip ?? t("task.subtaskTooltip")}>↖</span>
  {/if}

  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <span
    class="gtd-task-text"
    on:click={onTextClick}
  >
    {#if task.text}
      {#each parseWikilinks(task.text) as seg}
        {#if seg.type === "wikilink" || seg.type === "bold"}<strong>{seg.content}</strong
        >{:else if seg.type === "mdlink"}<span class="gtd-md-link">{seg.content}</span
        >{:else if seg.type === "italic"}<em>{seg.content}</em
        >{:else if seg.type === "strike"}<s>{seg.content}</s
        >{:else if seg.type === "code"}<code class="gtd-inline-code">{seg.content}</code
        >{:else if seg.type === "highlight"}<mark class="gtd-highlight">{seg.content}</mark
        >{:else}{seg.content}{/if}
      {/each}
    {:else}{t("task.emptyTask")}{/if}
  </span>

  {#if activeDescendantCount > 0}
    <span class="gtd-subtask-badge">({activeDescendantCount})</span>
  {/if}

  {#if showPopover}
    <div class="gtd-tooltip">
      {#if fieldRows.length > 0}
        <div class="gtd-tooltip-fields">
          {#each fieldRows as row}
            <div class="gtd-tooltip-field">
              <span
                class="gtd-tooltip-field-emoji"
                class:is-overdue={row.emoji === "❢"}
                class:is-misfiled={row.emoji === "⚑"}
              >{row.emoji}</span>
              <span class="gtd-tooltip-field-text">{row.text}</span>
            </div>
          {/each}
        </div>
        <hr class="gtd-tooltip-divider" />
      {/if}
      {#if task.text.length > 40}
        <div class="gtd-tooltip-text">{stripWikilinks(task.text)}</div>
      {/if}
      {#if activeDescendantCount > 0}
        {#if task.text.length > 40}
          <hr class="gtd-tooltip-divider" />
        {/if}
        <div class="gtd-tooltip-subtask-header">{t("task.activeSubtasks", { count: activeDescendantCount })}</div>
      {/if}
      {#if task.text.length > 40 || activeDescendantCount > 0}
        <hr class="gtd-tooltip-divider" />
      {/if}
      <div class="gtd-tooltip-source">@ {sourceFile} (L{displayLineNumber})</div>
    </div>
  {/if}

  <div class="gtd-task-actions">
    {#if task.isCompleted && showCompleted}
      <button
        class="gtd-task-move-btn"
        title={t("task.dismiss")}
        on:click={onDismissClick}
      >🧹</button>
    {:else}
      {#each quickMoveTargets as bucket}
        <button
          class="gtd-task-move-btn"
          title={t("task.moveTo", { name: bucket.name })}
          on:click={(e) => onMoveClick(e, bucket.id)}
        >
          {bucket.emoji}
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .gtd-overdue-badge {
    flex-shrink: 0;
    color: var(--text-error);
    font-weight: 700;
    font-size: 13px;
    line-height: 1;
    padding-right: 2px;
  }

  .gtd-misfiled-badge {
    flex-shrink: 0;
    color: var(--text-warning);
    font-weight: 700;
    font-size: 13px;
    line-height: 1;
    padding-right: 2px;
  }

  .gtd-priority-badge {
    flex-shrink: 0;
    font-size: 13px;
    line-height: 1;
    padding-right: 2px;
    cursor: default;
  }

  .gtd-recurring-badge {
    flex-shrink: 0;
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
    font-size: 13px;
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

  div.gtd-tooltip-field {
    display: flex;
    gap: 4px;
    align-items: baseline;
    color: var(--text-normal);
  }

  .gtd-tooltip-field-emoji {
    flex-shrink: 0;
  }

  .gtd-tooltip-field-emoji.is-overdue {
    color: var(--text-error);
    font-weight: 700;
  }

  .gtd-tooltip-field-emoji.is-misfiled {
    color: var(--text-warning);
    font-weight: 700;
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

  .gtd-tooltip-source {
    color: var(--text-faint);
    opacity: 0.65;
  }



  :global(.gtd-task) {
    position: relative;
  }
</style>
