<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Readable } from "svelte/store";
  import { Menu } from "obsidian";
  import BucketGroup from "./BucketGroup.svelte";
  import Celebration from "./Celebration.svelte";
  import type { BucketGroup as BucketGroupData } from "../core/BucketManager";
  import type { TaskRecord } from "../core/TaskParser";
  import { getTagValue, getInlineFieldValue } from "../core/TaskParser";
  import type { BucketConfig, PluginSettings } from "../settings";
  import { TO_REVIEW_ID } from "../core/BucketManager";
  import { t } from "../i18n/i18n";

  export let bucketGroups$: Readable<BucketGroupData[]>;
  export let settings$: Readable<PluginSettings>;
  export let celebrationImageUrls$: Readable<string[]>;
  export let languageChangeNotice$: Readable<boolean>;
  $: bucketGroups = $bucketGroups$;
  $: settings = $settings$;
  $: celebrationImageUrls = $celebrationImageUrls$;
  $: showLanguageBanner = $languageChangeNotice$;

  export let onMove: (task: TaskRecord, targetBucketId: string | null) => Promise<void>;
  export let onToggle: (task: TaskRecord) => Promise<void>;
  export let onNavigate: (task: TaskRecord) => void;
  export let onConfirm: (task: TaskRecord, bucketId: string) => Promise<void>;
  export let onOpenSettings: () => void;
  export let onDismissLanguageBanner: () => void;

  $: bucketConfigMap = new Map<string, BucketConfig>(
    settings.buckets.map((b) => [b.id, b])
  );

  $: allTasksMap = new Map<string, TaskRecord>(
    bucketGroups.flatMap((g) => g.tasks).map((t) => [t.id, t])
  );
  $: taskBucketMap = new Map<string, string>(
    bucketGroups.flatMap((g) => g.tasks.map((t) => [t.id, g.bucketId]))
  );

  let searchQuery = '';

  $: totalTaskCount = bucketGroups.flatMap((g) => g.tasks).length;

  $: filteredBucketGroups = searchQuery === ''
    ? bucketGroups
    : bucketGroups
        .map((g) => ({
          ...g,
          tasks: g.tasks.filter((t) =>
            t.text.toLowerCase().includes(searchQuery.toLowerCase())
          ),
        }))
        .filter((g) => g.tasks.length > 0);

  $: matchedTaskCount = searchQuery === ''
    ? totalTaskCount
    : filteredBucketGroups.flatMap((g) => g.tasks).length;

  function getQuickMoveTargets(bucketId: string): BucketConfig[] {
    const targetIds =
      bucketId === TO_REVIEW_ID
        ? settings.toReviewQuickMoveTargets
        : bucketConfigMap.get(bucketId)?.quickMoveTargets ?? [];

    return targetIds
      .filter(Boolean)
      .map((id) => {
        if (id === TO_REVIEW_ID) {
          return {
            id: TO_REVIEW_ID,
            name: t("buckets.toReview"),
            emoji: settings.toReviewEmoji,
            dateRangeRule: null,
            quickMoveTargets: [] as [string?, string?],
            showInStatusBar: false,
          };
        }
        return bucketConfigMap.get(id!);
      })
      .filter(Boolean) as BucketConfig[];
  }

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

  let pendingMoveConfirm: {
    task: TaskRecord;
    targetBucketId: string | null;
    explicitChildren: TaskRecord[];
  } | null = null;

  async function handleMove(task: TaskRecord, targetBucketId: string | null) {
    if (targetBucketId === "__context_menu__") {
      showContextMenu(task);
      return;
    }

    const descendants = getDescendants(task);
    const targetId = targetBucketId ?? TO_REVIEW_ID;
    // Only ask about children that are in a *different* bucket than the target.
    // Children already in the target bucket need no action and should not trigger a dialog.
    const explicitChildren = descendants.filter(
      (t) => hasExplicitAssignment(t) && taskBucketMap.get(t.id) !== targetId
    );

    if (explicitChildren.length > 0) {
      pendingMoveConfirm = { task, targetBucketId, explicitChildren };
      return;
    }

    await onMove(task, targetBucketId);
  }

  async function confirmMoveChildren(moveChildren: boolean) {
    if (!pendingMoveConfirm) return;
    const { task, targetBucketId, explicitChildren } = pendingMoveConfirm;
    pendingMoveConfirm = null;

    await onMove(task, targetBucketId);

    if (moveChildren) {
      for (const child of explicitChildren) {
        // Re-look up from the live map — re-indexing after the parent write may have
        // produced a fresh TaskRecord with an updated rawLine for this child.
        const fresh = allTasksMap.get(child.id) ?? child;
        await onMove(fresh, targetBucketId);
      }
    }
  }

  function showContextMenu(task: TaskRecord) {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle(`${settings.toReviewEmoji} ${t("panel.contextMenu.moveTo", { name: t("buckets.toReview") })}`)
        .setIcon("inbox")
        .onClick(() => onMove(task, null))
    );

    menu.addSeparator();

    for (const bucket of settings.buckets) {
      const b = bucket;
      menu.addItem((item) =>
        item
          .setTitle(`${b.emoji} ${t("panel.contextMenu.moveTo", { name: b.name })}`)
          .onClick(() => onMove(task, b.id))
      );
    }

    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("panel.contextMenu.openFile"))
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

  // Capture-phase dragover on the panel root ensures "move" cursor everywhere
  // inside the panel, before SortableJS can override dropEffect in bubble phase.
  let panelEl: HTMLElement;
  function panelDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }
  onMount(() => {
    panelEl.addEventListener("dragover", panelDragOver, true);
  });
  onDestroy(() => {
    panelEl?.removeEventListener("dragover", panelDragOver, true);
  });

  type CelebrationState = "none" | "confetti" | "creature" | "creature-and-confetti";
  let celebration: CelebrationState = "none";
  let celebrationTimer: ReturnType<typeof setTimeout> | null = null;

  function triggerCelebration(state: Exclude<CelebrationState, "none">, duration: number) {
    if (celebrationTimer) {
      clearTimeout(celebrationTimer);
      celebration = "none";
    }
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
      const mode = settings.celebrationMode ?? "confetti";
      if (mode === "all") {
        triggerCelebration("creature-and-confetti", 2520);
      } else if (mode === "creature") {
        triggerCelebration("creature", 2520);
      } else if (mode === "confetti") {
        triggerCelebration("confetti", 2100);
      }
    }
    await onToggle(task);
  }

  let bucketGroupRefs: BucketGroup[] = [];

  function dismissAllCompleted() {
    for (const ref of bucketGroupRefs) {
      ref?.dismissAllVisible();
    }
  }

  async function handleDrop(event: CustomEvent<{
    taskId: string;
    sourceBucketId: string;
    targetBucketId: string;
  }>) {
    const { taskId, targetBucketId } = event.detail;
    const resolvedTarget = targetBucketId === TO_REVIEW_ID ? null : targetBucketId;

    for (const group of bucketGroups) {
      const task = group.tasks.find((t) => t.id === taskId);
      if (task) {
        await handleMove(task, resolvedTarget);
        return;
      }
    }
  }
</script>

<div class="gtd-panel" class:gtd-compact={settings.compactView} bind:this={panelEl}>
  <div class="gtd-panel-header">
    <h3>{t("panel.title")}</h3>
    <div class="gtd-search-wrapper">
      <input
        class="gtd-search-input"
        type="text"
        placeholder={t("panel.searchPlaceholder")}
        bind:value={searchQuery}
        on:keydown={(e) => { if (e.key === 'Escape') { searchQuery = ''; e.currentTarget.blur(); } }}
      />
      {#if searchQuery}
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span class="gtd-search-clear" on:click={() => (searchQuery = '')} title={t("panel.clearSearch")}>×</span>
      {/if}
    </div>
    <div class="gtd-header-actions">
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <span
        class="clickable-icon gtd-dismiss-all-icon"
        title={t("panel.dismissAll")}
        on:click={dismissAllCompleted}
      >🧹</span>
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <span
        class="clickable-icon gtd-settings-icon"
        title={t("panel.openSettings")}
        on:click={onOpenSettings}
      >⚙</span>
    </div>
  </div>

  {#if showLanguageBanner}
    <div class="gtd-language-banner">
      <span class="gtd-language-banner-message">{t("panel.languageBanner.message")}</span>
      <div class="gtd-language-banner-actions">
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span class="gtd-language-banner-btn" on:click={() => { onOpenSettings(); onDismissLanguageBanner(); }}>{t("panel.languageBanner.openSettings")}</span>
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span class="gtd-language-banner-btn" on:click={onDismissLanguageBanner}>{t("panel.languageBanner.dismiss")}</span>
      </div>
    </div>
  {/if}

  {#if searchQuery}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="gtd-search-status">
      <span class="gtd-search-pill" on:click={() => (searchQuery = '')}>🔍 {t("panel.searchStatus", { matched: matchedTaskCount, total: totalTaskCount })}</span>
    </div>
  {/if}

  <div class="gtd-panel-body">
    {#each filteredBucketGroups as group, i (group.bucketId)}
      {#if !group.isSystem || group.tasks.some((t) => !t.isCompleted)}
      <BucketGroup
        bind:this={bucketGroupRefs[i]}
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
      {/if}
    {/each}

    {#if bucketGroups.length === 0}
      <div class="gtd-empty-state">{t("panel.noTasksFound")}</div>
    {/if}
  </div>

  {#if pendingMoveConfirm}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="gtd-confirm-overlay" on:click={() => (pendingMoveConfirm = null)}>
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <div class="gtd-confirm-dialog" on:click|stopPropagation>
        <p>{t("panel.moveConfirm.message", { count: pendingMoveConfirm.explicitChildren.length })}</p>
        <div class="gtd-confirm-buttons">
          <button class="mod-cta" on:click={() => confirmMoveChildren(true)}>{t("panel.moveConfirm.moveAll")}</button>
          <button on:click={() => confirmMoveChildren(false)}>{t("panel.moveConfirm.parentOnly")}</button>
          <button on:click={() => (pendingMoveConfirm = null)}>{t("panel.moveConfirm.cancel")}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if celebration !== "none"}
    <Celebration type={celebration} imagePaths={celebrationImageUrls} />
  {/if}
</div>
