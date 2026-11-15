<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Readable } from "svelte/store";
  import { Menu, Notice } from "obsidian";
  import type { MenuItem } from "obsidian";
  import BucketGroup from "./BucketGroup.svelte";
  import Celebration from "./Celebration.svelte";
  import type { BucketGroup as BucketGroupData } from "../core/BucketManager";
  import type { TaskRecord } from "../core/TaskParser";
  import { getTagValue, getInlineFieldValue, statusSymbol } from "../core/TaskParser";
  import { blockerLabel } from "../core/TasksFieldText";
  import type { SettableStatus } from "../core/TaskWriter";
  import { dateEntries, datePresets } from "../core/DateMenu";
  import type { DateEntry, DateField, PresetId } from "../core/DateMenu";
  import { dayKey, diffInDays } from "../core/DueStatus";
  import { dropDateOptions, landsIn } from "../core/DropDates";
  import type { DropDateOptions } from "../core/DropDates";
  import { formatDate } from "../core/DueStatusText";
  import { today } from "../integrations/TasksPluginParser";
  import type { DatePicker } from "../integrations/Kalendae";
  import { countShown, searchBuckets, shownTasks, visibleCompleted } from "../core/PanelVisibility";
  import type { BucketConfig, PluginSettings } from "../settings";
  import { shouldRecommendCatchAll, hiddenFilterStrings, weekStartIndex } from "../settings";
  import { TO_REVIEW_ID, autoBucketFor } from "../core/BucketManager";
  import { PANEL_NOTICES, noticeToShow } from "../core/PanelNotices";
  import { icon } from "./icon";
  import { headerDragOver } from "./dragState";
  import { t } from "../i18n/i18n";

  export let bucketGroups$: Readable<BucketGroupData[]>;
  export let settings$: Readable<PluginSettings>;
  export let celebrationImageUrls$: Readable<string[]>;
  export let languageChangeNotice$: Readable<boolean>;
  $: bucketGroups = $bucketGroups$;
  $: settings = $settings$;
  $: hiddenStrings = hiddenFilterStrings(settings);
  $: celebrationImageUrls = $celebrationImageUrls$;
  $: showLanguageBanner = $languageChangeNotice$;

  export let onMove: (
    task: TaskRecord,
    targetBucketId: string | null,
    orderedTaskIds?: string[] | null
  ) => Promise<void>;
  export let onToggle: (task: TaskRecord) => Promise<void>;
  export let onNavigate: (task: TaskRecord) => void;
  export let onOpenLink: (task: TaskRecord, target: string, external: boolean, newTab: boolean) => void;
  /** Asked each time the menu opens, since Tasks can be enabled or disabled while the panel is up. */
  export let canEditTask: () => boolean;
  export let onEdit: (task: TaskRecord) => void;
  export let onSetStatus: (task: TaskRecord, symbol: SettableStatus) => Promise<void>;
  export let onSetDate: (task: TaskRecord, field: DateField, date: string, unpin: boolean) => Promise<void>;
  export let onDropDate: (
    task: TaskRecord,
    field: DateField,
    date: string,
    targetBucketId: string,
    orderedTaskIds: string[] | null
  ) => Promise<void>;
  /** Custom…: Kalendae's calendar, or the popup that installs, updates, or enables it. */
  export let pickDay: DatePicker;
  export let onReorder: (bucketId: string, orderedTaskIds: string[]) => Promise<void>;
  export let onDismiss: (tasks: TaskRecord[]) => void;
  export let onOpenSettings: () => void;
  export let onDismissLanguageBanner: () => void;
  export let onDismissCatchAllNotice: () => void;
  export let onDismissWeekStartNotice: () => void;
  export let onDismissNotice: (id: string) => void;
  export let onOpenChangelog: () => void;

  // Keyed off the shape of the rules rather than tasks actually piling up in To
  // Review, so the warning arrives before the mess does.
  $: showCatchAllBanner =
    !settings.catchAllNoticeSeen && shouldRecommendCatchAll(settings.buckets);

  // Announced once to installs whose weeks were hardcoded to Monday. Dismissal is
  // the only thing that hides it, and picking a first day counts as one (see
  // setControlValue), so it cannot key off the value and blink as that changes.
  $: showWeekStartBanner = !settings.weekStartNoticeSeen;

  // Every button settles the note: the changelog keeps its text reachable.
  $: panelNotice = noticeToShow(PANEL_NOTICES, settings.lastNoticeSeen);

  $: bucketConfigMap = new Map<string, BucketConfig>(
    settings.buckets.map((b) => [b.id, b])
  );

  $: allTasksMap = new Map<string, TaskRecord>(
    bucketGroups.flatMap((g) => g.tasks).map((t) => [t.id, t])
  );
  $: taskBucketMap = new Map<string, string>(
    bucketGroups.flatMap((g) => g.tasks.map((t) => [t.id, g.bucketId]))
  );
  /** Task id → the bucket its tag pins it to. Membership follows the same test
   *  resolveManualAssignment applies, so a tag naming a deleted bucket is out. */
  $: pinnedIn = new Map<string, BucketConfig>(
    bucketGroups
      .flatMap((g) => g.tasks)
      .flatMap((task) => {
        const bucket = hasExplicitAssignment(task) ? bucketConfigMap.get(taskBucketMap.get(task.id) ?? "") : undefined;
        return bucket ? [[task.id, bucket] as [string, BucketConfig]] : [];
      })
  );

  /** Task id → why it can't be done yet, across every bucket. */
  $: waitingMap = new Map(bucketGroups.flatMap((g) => Object.entries(g.waiting)));

  let searchQuery = '';

  $: untilMidnight = settings.completedVisibilityUntilMidnight;
  $: totalTaskCount = countShown(bucketGroups, untilMidnight);

  $: filteredBucketGroups = searchBuckets(bucketGroups, searchQuery, hiddenStrings, untilMidnight);

  $: matchedTaskCount = searchQuery === ''
    ? totalTaskCount
    : countShown(filteredBucketGroups, untilMidnight);

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
    orderedTaskIds: string[] | null;
    /** Set when the parent's drop gave it a date rather than a pin. */
    date?: { field: DateField; day: string };
    /** Run once the dialog is answered, whichever way: the drop menu's row copy waits on it. */
    onSettled?: () => void;
  } | null = null;

  function cancelMoveConfirm() {
    const settled = pendingMoveConfirm?.onSettled;
    pendingMoveConfirm = null;
    settled?.();
  }

  async function handleMove(
    task: TaskRecord,
    targetBucketId: string | null,
    orderedTaskIds: string[] | null = null
  ) {
    if (targetBucketId === "__context_menu__") {
      showContextMenu(task);
      return;
    }

    const explicitChildren = childrenToAsk(task, targetBucketId);
    if (explicitChildren.length > 0) {
      pendingMoveConfirm = { task, targetBucketId, explicitChildren, orderedTaskIds };
      return;
    }

    await onMove(task, targetBucketId, orderedTaskIds);
  }

  /** Children pinned to a bucket other than the target. Those already in it need no action. */
  function childrenToAsk(task: TaskRecord, targetBucketId: string | null): TaskRecord[] {
    const targetId = targetBucketId ?? TO_REVIEW_ID;
    return getDescendants(task).filter((t) => hasExplicitAssignment(t) && taskBucketMap.get(t.id) !== targetId);
  }

  async function dropWithDate(
    task: TaskRecord,
    field: DateField,
    day: string,
    targetBucketId: string,
    orderedTaskIds: string[] | null
  ) {
    const explicitChildren = childrenToAsk(task, targetBucketId);
    if (explicitChildren.length > 0) {
      pendingMoveConfirm = { task, targetBucketId, explicitChildren, orderedTaskIds, date: { field, day } };
      return;
    }
    await onDropDate(task, field, day, targetBucketId, orderedTaskIds);
  }

  async function confirmMoveChildren(moveChildren: boolean) {
    if (!pendingMoveConfirm) return;
    const { task, targetBucketId, explicitChildren, orderedTaskIds, date, onSettled } = pendingMoveConfirm;
    pendingMoveConfirm = null;
    try {
      await applyMoveConfirm(task, targetBucketId, explicitChildren, orderedTaskIds, date, moveChildren);
    } finally {
      onSettled?.();
    }
  }

  async function applyMoveConfirm(
    task: TaskRecord,
    targetBucketId: string | null,
    explicitChildren: TaskRecord[],
    orderedTaskIds: string[] | null,
    date: { field: DateField; day: string } | undefined,
    moveChildren: boolean
  ) {
    if (date && targetBucketId !== null) {
      await onDropDate(task, date.field, date.day, targetBucketId, orderedTaskIds);
    } else {
      await onMove(task, targetBucketId, orderedTaskIds);
    }

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
    const currentBucketId = taskBucketMap.get(task.id) ?? TO_REVIEW_ID;
    const autoTarget = autoBucketFor(task, settings);

    let topSection = false;

    if (canEditTask()) {
      menu.addItem((item) => item.setTitle(t("panel.contextMenu.editTask")).setIcon("pencil").onClick(() => onEdit(task)));
      topSection = true;
    }

    // Done stays with the row's checkbox, so a done task gets neither item.
    const status = statusSymbol(task.rawLine);
    if (status === " " || status === "-") {
      menu.addItem((item) =>
        item.setTitle(t("panel.contextMenu.setInProgress")).setIcon("loader").onClick(() => onSetStatus(task, "/"))
      );
      topSection = true;
    }
    if (status === " " || status === "/") {
      menu.addItem((item) =>
        item.setTitle(t("panel.contextMenu.cancelTask")).setIcon("x-octagon").onClick(() => onSetStatus(task, "-"))
      );
      topSection = true;
    }

    if (hasExplicitAssignment(task)) {
      if (autoTarget) {
        // The arrow promises the task will land elsewhere, so it is dropped when
        // the dates point at the bucket it already sits in.
        const title =
          autoTarget.id === currentBucketId
            ? t("panel.contextMenu.unpinHere")
            : t("panel.contextMenu.unpin", { name: autoTarget.name });
        menu.addItem((item) => item.setTitle(title).setIcon("pin-off").onClick(() => onMove(task, null)));
        topSection = true;
      }
    } else {
      const here = bucketConfigMap.get(currentBucketId);
      if (here) {
        menu.addItem((item) =>
          item
            .setTitle(t("panel.contextMenu.pinTo", { name: here.name }))
            .setIcon("pin")
            .onClick(() => onMove(task, here.id))
        );
        topSection = true;
      }
    }

    if (topSection) menu.addSeparator();

    // The panel shows To Review first, then the buckets in settings order, so
    // To Review's -1 puts every bucket below it.
    const currentIndex = settings.buckets.findIndex((b) => b.id === currentBucketId);
    const targets = settings.buckets.map((b, index) => ({ b, index })).filter(({ b }) => b.id !== currentBucketId);
    if (targets.length > 0) {
      menu.addItem((item) => {
        item.setTitle(t("panel.contextMenu.moveToMenu")).setIcon("arrow-right-left");
        const moveMenu = submenu(item);
        for (const { b, index } of targets) {
          moveMenu.addItem((sub) =>
            sub
              .setTitle(`${b.emoji} ${b.name}`)
              .setIcon(index < currentIndex ? "arrow-up-from-line" : "arrow-down-from-line")
              .onClick(() => onMove(task, b.id))
          );
        }
      });
    }

    for (const entry of dateEntries(task, settings.planBy, pinnedIn.has(task.id))) {
      menu.addItem((item) => {
        item.setTitle(t(ENTRY_TITLES[entry.kind][entry.field])).setIcon("calendar-clock");
        addDateRows(submenu(item), task, entry);
      });
    }

    menu.addSeparator();
    for (const blocker of waitingMap.get(task.id)?.blockedBy ?? []) {
      // A fragment, so styles.css can cap the item's width: a long task name
      // or a long translation is cut with an ellipsis instead of widening the menu.
      const title = createFragment((f) =>
        f.createSpan({
          cls: "gtd-menu-title-capped",
          text: t("panel.contextMenu.goToBlocker", { task: blockerLabel(blocker, hiddenStrings) }),
        })
      );
      menu.addItem((item) => item.setTitle(title).setIcon("construction").onClick(() => onNavigate(blocker)));
    }
    menu.addItem((item) =>
      item
        .setTitle(t("panel.contextMenu.openFile"))
        .setIcon("file-text")
        .onClick(() => onNavigate(task))
    );

    menu.showAtMouseEvent(lastContextMenuEvent ?? new MouseEvent("click"));
  }

  const ENTRY_TITLES: Record<DateEntry["kind"], Record<DateField, string>> = {
    change: { due: "panel.contextMenu.changeDue", scheduled: "panel.contextMenu.changeScheduled" },
    set: { due: "panel.contextMenu.setDue", scheduled: "panel.contextMenu.setScheduled" },
  };

  const PRESET_TITLES: Record<PresetId, string> = {
    today: "panel.contextMenu.presetToday",
    tomorrow: "panel.contextMenu.presetTomorrow",
    startOfNextWeek: "panel.contextMenu.presetStartOfNextWeek",
    inOneWeek: "panel.contextMenu.presetInOneWeek",
    inTwoWeeks: "panel.contextMenu.presetInTwoWeeks",
  };

  /** `MenuItem.setSubmenu()` exists at runtime, and Obsidian uses it itself, but obsidian.d.ts leaves it out. */
  function submenu(item: MenuItem): Menu {
    return (item as MenuItem & { setSubmenu(): Menu }).setSubmenu();
  }

  function addDateRows(dateMenu: Menu, task: TaskRecord, entry: DateEntry) {
    const pinnedTo = pinnedIn.get(task.id);
    if (entry.unpins && pinnedTo) {
      dateMenu.addItem((item) =>
        item.setTitle(t("panel.contextMenu.updateUnpins", { name: `${pinnedTo.emoji} ${pinnedTo.name}` })).setIsLabel(true)
      );
    }

    const current = entry.kind === "change" ? (entry.field === "due" ? task.dueDate : task.scheduledDate) : null;
    const now = today();
    for (const preset of datePresets(now, weekStartIndex(settings.weekStartsOn), current)) {
      // Two columns, as Kalendae's suggestions have: the step, and the day it lands on.
      // Native menus take only the text, so the hidden separator keeps the two apart there.
      const title = createFragment((f) => {
        const row = f.createSpan({ cls: "gtd-date-row" });
        row.createSpan({ cls: "gtd-date-step", text: t(PRESET_TITLES[preset.id]) });
        row.createSpan({ cls: "gtd-date-separator", text: " · " });
        row.createSpan({ cls: "gtd-date-day", text: formatDate(preset.date) });
      });
      dateMenu.addItem((item) =>
        item
          .setTitle(title)
          .onClick(() => onSetDate(task, entry.field, preset.key, entry.unpins))
      );
    }

    const event = lastContextMenuEvent ?? new MouseEvent("click");
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>(".gtd-task") : null;
    dateMenu.addItem((item) =>
      item.setTitle(t("panel.contextMenu.customDate")).onClick(async () => {
        // A redraw since the menu opened may have replaced the row; the click point still stands.
        const day = await pickDay(dayKey(current ?? now), row?.isConnected ? row : event);
        if (day) await onSetDate(task, entry.field, day, entry.unpins);
      })
    );
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
  // Where the drop menu opens. A mouse drag fires dragover, a touch drag pointermove.
  let lastDropPoint: { x: number; y: number } | null = null;
  function trackDropPoint(e: DragEvent | PointerEvent) {
    lastDropPoint = { x: e.clientX, y: e.clientY };
  }
  onMount(() => {
    panelEl.addEventListener("dragover", panelDragOver, true);
    panelEl.addEventListener("dragover", trackDropPoint, true);
    panelEl.addEventListener("pointermove", trackDropPoint, true);
  });
  onDestroy(() => {
    panelEl?.removeEventListener("dragover", panelDragOver, true);
    panelEl?.removeEventListener("dragover", trackDropPoint, true);
    panelEl?.removeEventListener("pointermove", trackDropPoint, true);
  });

  function dropStepTitle(count: number): string {
    if (count === 0) return t("panel.dropMenu.today");
    if (count === 1) return t("panel.dropMenu.tomorrow");
    return t("panel.dropMenu.inDays", { count });
  }

  function fromDayKey(key: string): Date {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  /**
   * Shows the dropped row at its drop position while the drop menu is open.
   * BucketGroup's onAdd already put the real row back in its source list, and
   * it must stay Svelte's, so the row there is hidden and a copy stands in.
   * A header drop has no position to show, its bucket being collapsed, so the
   * header stays marked as the drop target instead.
   */
  function showPendingDrop(task: TaskRecord, targetBucketId: string, orderedTaskIds: string[] | null): () => void {
    const origin = panelEl.querySelector<HTMLElement>(`.gtd-task[data-task-id="${task.id}"]`);
    if (!origin) return () => {};

    if (!orderedTaskIds) {
      const header = panelEl.querySelector<HTMLElement>(`.gtd-bucket[data-bucket-id="${targetBucketId}"] .gtd-bucket-header`);
      origin.addClass("gtd-drop-origin");
      header?.addClass("gtd-drop-target");
      return () => {
        origin.removeClass("gtd-drop-origin");
        header?.removeClass("gtd-drop-target");
      };
    }

    const list = panelEl.querySelector<HTMLElement>(`.gtd-bucket-tasks[data-bucket-id="${targetBucketId}"]`);
    if (!list) return () => {};

    const copy = origin.cloneNode(true) as HTMLElement;
    // Nothing may find the copy as the task: not the e2e row lookups, not SortableJS.
    for (const attr of ["data-task-id", "data-file-path", "data-line-number"]) copy.removeAttribute(attr);
    copy.addClass("gtd-drop-pending");
    const nextId = orderedTaskIds[orderedTaskIds.indexOf(task.id) + 1];
    const next = nextId ? list.querySelector<HTMLElement>(`.gtd-task[data-task-id="${nextId}"]`) : null;
    list.insertBefore(copy, next);
    origin.addClass("gtd-drop-origin");

    return () => {
      copy.remove();
      origin.removeClass("gtd-drop-origin");
    };
  }

  /**
   * Pin, or one of the offered days. Escape cancels the drop, and the task goes
   * back. Any other way of closing the menu, such as a click elsewhere, pins it,
   * since a drop should not be lost to a stray click.
   */
  function showDropMenu(task: TaskRecord, target: BucketConfig, options: DropDateOptions, orderedTaskIds: string[] | null) {
    const menu = new Menu();
    const now = today();
    const name = `${target.emoji} ${target.name}`;
    const clearPending = showPendingDrop(task, target.id, orderedTaskIds);

    // The copy stays until the drop is settled, which the move-children dialog
    // can put off past the action's return.
    const settle = async (action: () => Promise<void>) => {
      try {
        await action();
      } finally {
        if (pendingMoveConfirm?.task.id === task.id && !pendingMoveConfirm.onSettled) {
          pendingMoveConfirm = { ...pendingMoveConfirm, onSettled: clearPending };
        } else {
          clearPending();
        }
      }
    };

    let chosen = false;
    const choose = (action: () => Promise<void>) => () => {
      chosen = true;
      void settle(action);
    };

    menu.addItem((item) =>
      item
        .setTitle(t("panel.dropMenu.pinTo", { name }))
        .setIcon("pin")
        .onClick(choose(() => handleMove(task, target.id, orderedTaskIds)))
    );
    menu.addSeparator();

    for (const key of options.days) {
      const day = fromDayKey(key);
      // The same two columns as the row menu's preset days.
      const title = createFragment((f) => {
        const row = f.createSpan({ cls: "gtd-date-row" });
        row.createSpan({ cls: "gtd-date-step", text: dropStepTitle(diffInDays(day, now)) });
        row.createSpan({ cls: "gtd-date-separator", text: " · " });
        row.createSpan({ cls: "gtd-date-day", text: formatDate(day) });
      });
      menu.addItem((item) =>
        item.setTitle(title).onClick(choose(() => dropWithDate(task, options.field, key, target.id, orderedTaskIds)))
      );
    }

    const bucketEl = panelEl.querySelector<HTMLElement>(`.gtd-bucket[data-bucket-id="${target.id}"]`);
    const rect = bucketEl?.getBoundingClientRect();
    const point = lastDropPoint ?? { x: rect?.left ?? 0, y: rect?.top ?? 0 };

    if (options.offersCustom) {
      menu.addItem((item) =>
        item.setTitle(t("panel.contextMenu.customDate")).onClick(
          choose(async () => {
            const anchor = bucketEl?.isConnected ? bucketEl : new MouseEvent("click", { clientX: point.x, clientY: point.y });
            const day = await pickDay(options.range.from, anchor, [options.range]);
            if (!day) return;
            // Kalendae honours `allowed`, but a day outside the bucket would send
            // the task somewhere it was not dropped, so it is checked all the same.
            if (!landsIn(task, options.field, day, target.id, settings, today())) {
              new Notice(t("notices.dropDayOutside", { day: formatDate(fromDayKey(day)), name }));
              return;
            }
            await dropWithDate(task, options.field, day, target.id, orderedTaskIds);
          })
        )
      );
    }

    let escaped = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") escaped = true;
    };
    // The panel's own window: in a pop-out, keys never reach the main one.
    const win = panelEl.win;
    win.addEventListener("keydown", onKey, true);

    menu.onHide(() => {
      // Obsidian closes the menu on Escape before this listener sees that same
      // key, and an item's click may close it before the item's handler runs:
      // both are settled only once the event is done.
      setTimeout(() => {
        win.removeEventListener("keydown", onKey, true);
        if (chosen) return;
        if (escaped) {
          clearPending();
          return;
        }
        new Notice(t("notices.dropPinned", { name }));
        void settle(() => handleMove(task, target.id, orderedTaskIds));
      }, 0);
    });

    menu.showAtPosition(point, panelEl.doc);
  }

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

  function dismissAllCompleted() {
    onDismiss(filteredBucketGroups.flatMap((g) => visibleCompleted(g, untilMidnight)));
  }

  async function handleDrop(event: CustomEvent<{
    taskId: string;
    sourceBucketId: string;
    targetBucketId: string;
    orderedTaskIds: string[] | null;
  }>) {
    const { taskId, sourceBucketId, targetBucketId, orderedTaskIds } = event.detail;
    const resolvedTarget = targetBucketId === TO_REVIEW_ID ? null : targetBucketId;

    for (const group of bucketGroups) {
      const task = group.tasks.find((t) => t.id === taskId);
      if (task) {
        const target = resolvedTarget === null ? undefined : bucketConfigMap.get(resolvedTarget);
        const options =
          target && settings.dropIntoBucket === "ask" && sourceBucketId !== targetBucketId
            ? dropDateOptions(task, target.id, settings, today())
            : null;
        if (target && options) {
          showDropMenu(task, target, options, orderedTaskIds);
          return;
        }
        await handleMove(task, resolvedTarget, orderedTaskIds);
        return;
      }
    }
  }

  async function handleReorderEvent(event: CustomEvent<{ bucketId: string; orderedTaskIds: string[] }>) {
    await onReorder(event.detail.bucketId, event.detail.orderedTaskIds);
  }
</script>

<div class="gtd-panel" class:gtd-compact={settings.compactView} class:gtd-header-drag-over={$headerDragOver} bind:this={panelEl}>
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
      {#if settings.completedVisibilityUntilMidnight}
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span
          class="clickable-icon gtd-header-icon"
          title={t("panel.dismissAll")}
          on:click={dismissAllCompleted}
          use:icon={"check-check"}
        ></span>
      {/if}
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <span
        class="clickable-icon gtd-header-icon"
        title={t("panel.openSettings")}
        on:click={onOpenSettings}
        use:icon={"settings"}
      ></span>
    </div>
  </div>

  <!-- One banner at a time: these are full-width and push the task list down, and
       all of them are once-ever events, so they queue instead of stacking. -->
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
  {:else if showCatchAllBanner}
    <div class="gtd-language-banner">
      <span class="gtd-language-banner-message">{t("panel.catchAllBanner.message")}</span>
      <div class="gtd-language-banner-actions">
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span class="gtd-language-banner-btn" on:click={onOpenSettings}>{t("panel.catchAllBanner.openSettings")}</span>
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span class="gtd-language-banner-btn" on:click={onDismissCatchAllNotice}>{t("panel.catchAllBanner.dismiss")}</span>
      </div>
    </div>
  {:else if showWeekStartBanner}
    <div class="gtd-language-banner">
      <span class="gtd-language-banner-message">{t("panel.weekStartBanner.message")}</span>
      <div class="gtd-language-banner-actions">
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span class="gtd-language-banner-btn" on:click={onOpenSettings}>{t("panel.weekStartBanner.openSettings")}</span>
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span class="gtd-language-banner-btn" on:click={onDismissWeekStartNotice}>{t("panel.weekStartBanner.dismiss")}</span>
      </div>
    </div>
  {:else if panelNotice}
    {@const notice = panelNotice}
    <div class="gtd-language-banner gtd-notice-banner">
      <span class="gtd-language-banner-message">{t(`whatsNew.notes.${notice.id}.message`)}</span>
      <div class="gtd-language-banner-actions">
        {#if notice.action === "settings"}
          <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
          <span class="gtd-language-banner-btn" on:click={() => { onOpenSettings(); onDismissNotice(notice.id); }}>{t("whatsNew.openSettings")}</span>
          <span class="gtd-language-banner-sep" aria-hidden="true">·</span>
        {/if}
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span class="gtd-language-banner-btn" on:click={() => { onOpenChangelog(); onDismissNotice(notice.id); }}>{t("whatsNew.openChangelog")}</span>
        <span class="gtd-language-banner-sep" aria-hidden="true">·</span>
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span class="gtd-language-banner-btn" on:click={() => onDismissNotice(notice.id)}>{t("whatsNew.dismiss")}</span>
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
    {#each filteredBucketGroups as group (group.bucketId)}
      {#if !group.isSystem || shownTasks(group, untilMidnight).length > 0}
      <BucketGroup
        bucketId={group.bucketId}
        name={group.name}
        emoji={group.emoji}
        tasks={group.tasks}
        dueStatuses={group.dueStatuses}
        waiting={group.waiting}
        showDueFlags={settings.staleIndicatorEnabled}
        priorityDisplay={settings.priorityDisplay}
        showRecurrenceBadge={settings.showRecurrenceBadge}
        openLinksOnClick={settings.openLinksOnClick}
        hiddenFilterStrings={hiddenStrings}
        showTasksFieldsInPopover={settings.showTasksFieldsInPopover}
        autoPlacedFrom={group.autoPlacedFrom}
        misfiledIn={group.misfiledIn}
        {pinnedIn}
        agedCompletedTaskIds={group.agedCompletedTaskIds}
        quickMoveTargets={getQuickMoveTargets(group.bucketId)}
        showCompletedUntilMidnight={settings.completedVisibilityUntilMidnight}
        {allTasksMap}
        {taskBucketMap}
        bucketGroups={bucketGroups}
        on:move={(e) => handleMove(e.detail.task, e.detail.targetBucketId)}
        on:toggle={(e) => handleToggle(e.detail.task)}
        on:navigate={(e) => onNavigate(e.detail.task)}
        on:openLink={(e) => onOpenLink(e.detail.task, e.detail.target, e.detail.external, e.detail.newTab)}
        on:drop={handleDrop}
        on:reorder={handleReorderEvent}
        on:dismiss={(e) => onDismiss([e.detail.task])}
      />
      {/if}
    {/each}

    {#if bucketGroups.length === 0}
      <div class="gtd-empty-state">{t("panel.noTasksFound")}</div>
    {/if}
  </div>

  {#if pendingMoveConfirm}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="gtd-confirm-overlay" on:click={cancelMoveConfirm}>
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <div class="gtd-confirm-dialog" on:click|stopPropagation>
        <p>{t("panel.moveConfirm.message", { count: pendingMoveConfirm.explicitChildren.length })}</p>
        <div class="gtd-confirm-buttons">
          <button class="mod-cta" on:click={() => confirmMoveChildren(true)}>{t("panel.moveConfirm.moveAll")}</button>
          <button on:click={() => confirmMoveChildren(false)}>{t("panel.moveConfirm.parentOnly")}</button>
          <button on:click={cancelMoveConfirm}>{t("panel.moveConfirm.cancel")}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if celebration !== "none"}
    <Celebration type={celebration} imagePaths={celebrationImageUrls} />
  {/if}
</div>
