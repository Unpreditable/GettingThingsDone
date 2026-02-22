<script lang="ts">
  import { onMount } from "svelte";
  import { Menu } from "obsidian";
  import BucketGroup from "./BucketGroup.svelte";
  import Celebration from "./Celebration.svelte";
  import type { BucketGroup as BucketGroupData } from "../core/BucketManager";
  import type { TaskRecord } from "../core/TaskParser";
  import { getTagValue, getInlineFieldValue } from "../core/TaskParser";
  import type { BucketConfig, PluginSettings } from "../settings";
  import { TO_REVIEW_ID } from "../core/BucketManager";

  export let bucketGroups: BucketGroupData[] = [];
  export let settings: PluginSettings;
  export let onMove: (task: TaskRecord, targetBucketId: string | null) => Promise<void>;
  export let onToggle: (task: TaskRecord) => Promise<void>;
  export let onNavigate: (task: TaskRecord) => void;
  export let onConfirm: (task: TaskRecord, bucketId: string) => Promise<void>;
  export let onOpenSettings: () => void;
  export let celebrationImageUrls: string[] = [];

  $: bucketConfigMap = new Map<string, BucketConfig>(
    settings.buckets.map((b) => [b.id, b])
  );

  // Maps for hierarchy look-ups used by TaskItem
  $: allTasksMap = new Map<string, TaskRecord>(
    bucketGroups.flatMap((g) => g.tasks).map((t) => [t.id, t])
  );
  $: taskBucketMap = new Map<string, string>(
    bucketGroups.flatMap((g) => g.tasks.map((t) => [t.id, g.bucketId]))
  );

  function getQuickMoveTargets(bucketId: string): BucketConfig[] {
    const targetIds =
      bucketId === TO_REVIEW_ID
        ? settings.toReviewQuickMoveTargets
        : bucketConfigMap.get(bucketId)?.quickMoveTargets ?? [];

    return targetIds
      .filter(Boolean)
      .map((id) => {
        if (id === TO_REVIEW_ID) {
          // Synthesize a BucketConfig for the To Review system bucket
          return {
            id: TO_REVIEW_ID,
            name: "To Review",
            emoji: settings.toReviewEmoji,
            dateRangeRule: null,
            quickMoveTargets: [] as [string?, string?],
          };
        }
        return bucketConfigMap.get(id!);
      })
      .filter(Boolean) as BucketConfig[];
  }

  /** Returns true if the task has an explicit storage-mode bucket marker. */
  function hasExplicitAssignment(task: TaskRecord): boolean {
    const { storageMode, tagPrefix, buckets } = settings;
    if (storageMode === "inline-tag") {
      const val = getTagValue(task.rawLine, tagPrefix);
      return val !== null && buckets.some((b) => b.id === val);
    } else if (storageMode === "inline-field") {
      const val = getInlineFieldValue(task.rawLine, tagPrefix);
      return val !== null && buckets.some((b) => b.id === val);
    }
    return false;
  }

  /** Recursively collect all descendant TaskRecords for a given task. */
  function getDescendants(task: TaskRecord): TaskRecord[] {
    const result: TaskRecord[] = [];
    const queue = [...task.childIds];
    while (queue.length > 0) {
      const childId = queue.shift()!;
      const child = allTasksMap.get(childId);
      if (child) {
        result.push(child);
        queue.push(...child.childIds);
      }
    }
    return result;
  }

  async function handleMove(task: TaskRecord, targetBucketId: string | null) {
    if (targetBucketId === "__context_menu__") {
      showContextMenu(task);
      return;
    }

    const descendants = getDescendants(task);
    const explicitChildren = descendants.filter((t) => hasExplicitAssignment(t));

    // If any descendants have their own explicit assignment, prompt before moving them
    let moveExplicit = false;
    if (explicitChildren.length > 0) {
      moveExplicit = confirm(
        `${explicitChildren.length} subtask(s) have their own bucket assigned. Move them too?`
      );
    }

    // Move the parent (implicit children follow via inheritance on next re-index)
    await onMove(task, targetBucketId);

    // Optionally move explicitly-assigned children
    if (moveExplicit) {
      for (const child of explicitChildren) {
        await onMove(child, targetBucketId);
      }
    }
  }

  function showContextMenu(task: TaskRecord) {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle(`${settings.toReviewEmoji} Move to: To Review`)
        .setIcon("inbox")
        .onClick(() => onMove(task, null))
    );

    menu.addSeparator();

    for (const bucket of settings.buckets) {
      const b = bucket;
      menu.addItem((item) =>
        item
          .setTitle(`${b.emoji} Move to: ${b.name}`)
          .onClick(() => onMove(task, b.id))
      );
    }

    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Open file")
        .setIcon("file-text")
        .onClick(() => onNavigate(task))
    );

    menu.showAtMouseEvent(lastContextMenuEvent ?? new MouseEvent("click"));
  }

  let lastContextMenuEvent: MouseEvent | null = null;
  onMount(() => {
    const handler = (e: MouseEvent) => { lastContextMenuEvent = e; };
    document.addEventListener("contextmenu", handler, true);
    return () => document.removeEventListener("contextmenu", handler, true);
  });

  type CelebrationState = "none" | "confetti" | "creature";
  let celebration: CelebrationState = "none";
  let celebrationTimer: ReturnType<typeof setTimeout> | null = null;

  function triggerCelebration(state: Exclude<CelebrationState, "none">, duration: number) {
    if (celebrationTimer) {
      clearTimeout(celebrationTimer);
      celebration = "none";
    }
    // setTimeout 0 lets Svelte unmount the old Celebration before remounting
    // (resets CSS animations cleanly for rapid successive completions)
    setTimeout(() => {
      celebration = state;
      celebrationTimer = setTimeout(() => {
        celebration = "none";
        celebrationTimer = null;
      }, duration);
    }, 0);
  }

  async function handleToggle(task: TaskRecord) {
    if (!task.isCompleted) {
      const group = bucketGroups.find((g) => g.tasks.some((t) => t.id === task.id));
      if (group?.bucketId === "today") {
        const remaining = group.tasks.filter((t) => !t.isCompleted && t.id !== task.id).length;
        triggerCelebration(remaining === 0 ? "creature" : "confetti", remaining === 0 ? 2520 : 2100);
      } else {
        triggerCelebration("confetti", 2100);
      }
    }
    await onToggle(task);
  }

  async function handleDrop(event: CustomEvent<{
    taskId: string;
    sourceBucketId: string;
    targetBucketId: string;
  }>) {
    const { taskId, targetBucketId } = event.detail;
    for (const group of bucketGroups) {
      const task = group.tasks.find((t) => t.id === taskId);
      if (task) {
        await handleMove(task, targetBucketId === TO_REVIEW_ID ? null : targetBucketId);
        return;
      }
    }
  }
</script>

<div class="gtd-panel" class:gtd-compact={settings.compactView}>
  <div class="gtd-panel-header">
    <h3>GTD Tasks</h3>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <span
      class="clickable-icon gtd-settings-icon"
      title="Open GTD settings"
      on:click={onOpenSettings}
    >⚙</span>
  </div>

  <div class="gtd-panel-body">
    {#each bucketGroups as group (group.bucketId)}
      <BucketGroup
        bucketId={group.bucketId}
        name={group.name}
        emoji={group.emoji}
        tasks={group.tasks}
        staleTaskIds={group.staleTaskIds}
        autoPlacedTaskIds={group.autoPlacedTaskIds}
        quickMoveTargets={getQuickMoveTargets(group.bucketId)}
        showCompletedUntilMidnight={settings.completedVisibilityUntilMidnight}
        {allTasksMap}
        {taskBucketMap}
        bucketGroups={bucketGroups}
        on:move={(e) => handleMove(e.detail.task, e.detail.targetBucketId)}
        on:toggle={(e) => handleToggle(e.detail.task)}
        on:navigate={(e) => onNavigate(e.detail.task)}
        on:confirm={(e) => onConfirm(e.detail.task, e.detail.bucketId)}
        on:drop={handleDrop}
      />
    {/each}

    {#if bucketGroups.length === 0}
      <div class="gtd-empty-state">No tasks found. Adjust the task scope in settings.</div>
    {/if}
  </div>

  {#if celebration !== "none"}
    <Celebration type={celebration} imagePaths={celebrationImageUrls} />
  {/if}
</div>
