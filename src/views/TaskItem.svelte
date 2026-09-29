<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { TaskRecord, TaskPriority } from "../core/TaskParser";
  import { stripWikilinks, parseWikilinks, statusSymbol } from "../core/TaskParser";
  import type { BucketConfig, PriorityDisplay } from "../settings";
  import type { BucketGroup as BucketGroupData } from "../core/BucketManager";
  import type { DueStatus } from "../core/DueStatus";
  import { t } from "../i18n/i18n";
  import { isRecurring } from "../core/TaskOrder";
  import { isDragging } from "./dragState";
  import { formatTasksFields, PRIORITY_EMOJI } from "../core/TasksFieldText";
  import { placeRow } from "../core/RowPlacement";
  import { icon } from "./icon";

  export let task: TaskRecord;
  export let quickMoveTargets: BucketConfig[];
  export let dueStatus: DueStatus | null = null;
  export let showDueFlags: boolean = true;
  export let priorityDisplay: PriorityDisplay = "all";
  export let showRecurrenceBadge: boolean = true;
  export let showTasksFieldsInPopover: boolean = true;
  /** Which date field placed this task, or null when it is pinned or dateless. */
  export let autoPlacedFrom: "due" | "scheduled" | null = null;
  /** Set when the task is filed later than its planning date warrants. */
  export let misfiledIn: BucketConfig | null = null;
  /** The bucket this task is pinned to, or null when it follows its dates. */
  export let pinnedIn: BucketConfig | null = null;

  // Both can be true at once. The row has space for one signal, so the more
  // serious wins; the popover below carries both.
  $: showOverdueBadge = showDueFlags && dueStatus?.kind === "overdue";
  $: showMisfiledBadge = showDueFlags && misfiledIn !== null && !showOverdueBadge;
  // The row glyphs obey their settings; the popover always tells the truth,
  // so it is gated only by its own toggle.
  $: fieldRows = showTasksFieldsInPopover
    ? formatTasksFields(task, dueStatus, { autoPlacedFrom, pinnedIn, misfiledIn })
    : [];
  $: isRecurringTask = isRecurring(task);

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
  /** True when the task is completed and visible until midnight. */
  export let showCompleted: boolean = false;
  export let allTasksMap: Map<string, TaskRecord> = new Map();
  export let taskBucketMap: Map<string, string> = new Map();
  /** Ids of the rows this bucket is rendering, which is not every task it holds. */
  export let visibleIds: ReadonlySet<string> = new Set();
  export let bucketGroups: BucketGroupData[] = [];
  export let currentBucketId: string = "";

  const dispatch = createEventDispatcher<{
    move: { task: TaskRecord; targetBucketId: string | null };
    toggle: { task: TaskRecord };
    navigate: { task: TaskRecord };
    dismiss: { task: TaskRecord };
  }>();

  $: placement = placeRow(task, {
    allTasks: allTasksMap,
    taskBucket: taskBucketMap,
    bucketId: currentBucketId,
    visibleIds,
  });
  $: visualIndentLevel = placement.indentLevel;
  $: showParentArrow = placement.detachedParent;

  $: parentTask = task.parentId ? allTasksMap.get(task.parentId) ?? null : null;
  $: parentBucketId = task.parentId ? (taskBucketMap.get(task.parentId) ?? null) : null;
  $: parentBucketName = (() => {
    if (!parentBucketId) return null;
    const group = bucketGroups.find((g) => g.bucketId === parentBucketId);
    return group ? `${group.emoji} ${group.name}` : null;
  })();
  // Each case is a whole sentence of its own rather than a stem plus a clause:
  // the parenthetical cannot be translated apart from what it qualifies.
  $: parentTooltip = (() => {
    if (!parentTask) return null;
    const text = parentTask.text;
    if (parentBucketId !== currentBucketId && parentBucketName) {
      return t("task.subtaskOfInBucket", { text, bucket: parentBucketName });
    }
    if (parentTask.isCompleted) return t("task.subtaskOfCompleted", { text });
    return t("task.subtaskOf", { text });
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

  // Mirrors how Obsidian renders a task in a note, so theme rules keyed on
  // `data-task` and `is-checked` style this row too: any symbol but a space
  // is checked, whether or not it closes the task.
  $: symbol = statusSymbol(task.rawLine);
  $: checkboxChecked = symbol !== " ";

  /**
   * The file is the source of truth, so undo the browser's own optimistic
   * flip and let the re-render after the write set the real state. Without
   * this the DOM can keep a tick Svelte never clears: `checked` is one-way,
   * so if this row is reused for a task whose checkbox state is unchanged
   * (a 🔁 recurrence puts a NEW open occurrence on the completed task's
   * line), Svelte sees no value change and leaves the user's tick in place.
   */
  function onCheckboxChange(e: Event) {
    (e.currentTarget as HTMLInputElement).checked = checkboxChecked;
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

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    dispatch("move", { task, targetBucketId: "__context_menu__" });
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="gtd-task task-list-item"
  class:is-checked={checkboxChecked}
  class:is-completed={task.isCompleted && showCompleted}
  data-task={symbol}
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
    class="gtd-task-checkbox task-list-item-checkbox"
    data-task={symbol}
    checked={checkboxChecked}
    on:change={onCheckboxChange}
  />

  <!-- Flags lead: they are the reason to look at this row at all, whereas
       priority and recurrence are standing attributes of the task. -->
  {#if showOverdueBadge}
    <span class="gtd-overdue-badge" use:icon={"alert-triangle"}></span>
  {/if}

  {#if showMisfiledBadge}
    <span class="gtd-misfiled-badge" use:icon={"flag"}></span>
  {/if}

  {#if priorityEmoji}
    <span class="gtd-priority-badge">{priorityEmoji}</span>
  {/if}

  {#if isRecurringTask && showRecurrenceBadge}
    <span class="gtd-recurring-badge">🔁</span>
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
              {#if row.icon}
                <span
                  class="gtd-tooltip-field-emoji"
                  class:is-overdue={row.tone === "overdue"}
                  class:is-misfiled={row.tone === "misfiled"}
                  use:icon={row.icon}
                ></span>
              {:else}
                <span class="gtd-tooltip-field-emoji">{row.emoji}</span>
              {/if}
              <span class="gtd-tooltip-field-text">{row.text}</span>
              {#if row.marker}
                <span
                  class="gtd-tooltip-field-marker"
                  title={t("task.autoPlacedMarker")}
                  use:icon={row.marker}
                ></span>
              {/if}
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
  /* Sizing lives in styles.css: the injected SVG carries no Svelte scope class
     and is out of reach here. This block owns the span around it. */
  .gtd-overdue-badge,
  .gtd-misfiled-badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    font-size: 13px;
    line-height: 1;
    padding-right: 2px;
  }

  .gtd-overdue-badge {
    color: var(--gtd-flag-overdue);
  }

  .gtd-misfiled-badge {
    color: var(--gtd-flag-misfiled);
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
    /* Centred, not baseline: an SVG has no baseline to align a glyph row
       against, and rows lead with either kind. */
    align-items: center;
    color: var(--text-normal);
  }

  .gtd-tooltip-field-emoji {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* Fixed width so glyph rows and icon rows share one left rail. */
    width: 1.15em;
    height: 1.15em;
  }

  .gtd-tooltip-field-emoji.is-overdue {
    color: var(--gtd-flag-overdue);
  }

  .gtd-tooltip-field-emoji.is-misfiled {
    color: var(--gtd-flag-misfiled);
  }

  .gtd-tooltip-field-marker {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    --icon-size: 12px;
    color: var(--text-accent);
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
