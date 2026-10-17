<script lang="ts">
  import type { CompletionReport, ReportEntry, ReportRange } from "../core/CompletionReport";
  import { REPORT_RANGES, REPORT_WEEKS, groupByDay } from "../core/CompletionReport";
  import type { TaskRecord } from "../core/TaskParser";
  import { stripWikilinks } from "../core/TaskParser";
  import { icon } from "./icon";
  import type { ReportOption as Option } from "../settings";
  import { t } from "../i18n/i18n";

  export let report: CompletionReport;
  /** The modal's own header row, which Obsidian lines up with its close button. */
  export let headerEl: HTMLElement;
  export let locale: string;
  export let showGraph: boolean;
  export let showCancelled: boolean;
  export let showFileNames: boolean;
  export let onOptionChange: (key: Option, value: boolean) => void;
  export let onOpenTask: (task: TaskRecord) => void;
  export let onClose: () => void;

  const TAB_KEYS: Record<ReportRange, string> = {
    today: "today",
    yesterday: "yesterday",
    "this-week": "thisWeek",
    "last-week": "lastWeek",
  };

  let range: ReportRange = "this-week";
  let infoOpen = false;
  let optionsOpen = false;

  const dayFormat = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });
  const shortFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "long" });

  function weekRange(start: Date): string {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return shortFormat.formatRange(start, end);
  }

  const completedCount = (entries: ReportEntry[]) => entries.filter((e) => !e.cancelled).length;

  $: entries = report.ranges[range].filter((e) => showCancelled || !e.cancelled);
  $: days = groupByDay(entries);
  // A single day needs no heading of its own: the tab already names it.
  $: showDayHeadings = range === "this-week" || range === "last-week";

  $: options = [
    { key: "reportShowGraph" as Option, value: showGraph, label: t("report.options.showGraph") },
    { key: "reportShowCancelled" as Option, value: showCancelled, label: t("report.options.showCancelled") },
    { key: "reportShowFileNames" as Option, value: showFileNames, label: t("report.options.showFileNames") },
  ];

  function setOption(key: Option, value: boolean) {
    if (key === "reportShowGraph") showGraph = value;
    if (key === "reportShowCancelled") showCancelled = value;
    if (key === "reportShowFileNames") showFileNames = value;
    onOptionChange(key, value);
  }

  // Plot geometry, in viewBox units; the SVG stretches to the modal's width.
  const W = 560, H = 78, LEFT = 6, RIGHT = 6, TOP = 16, BOTTOM = 18;
  const LAST = REPORT_WEEKS - 1;
  const STEP = (W - LEFT - RIGHT) / LAST;
  const x = (i: number) => LEFT + i * STEP;
  // Gridlines at 0, half and the top, so the top is kept even.
  $: top = Math.max(2, Math.ceil(Math.max(...report.weeks.map((w) => w.count)) / 2) * 2);
  $: y = (n: number) => TOP + (1 - n / top) * (H - TOP - BOTTOM);
  $: solidPoints = report.weeks.slice(0, LAST).map((w, i) => `${x(i)},${y(w.count)}`).join(" ");
  $: areaPoints = `${x(0)},${y(0)} ${solidPoints} ${x(LAST - 1)},${y(0)}`;

  /** Week index under the pointer, or null when it isn't over the plot. */
  let hover: number | null = null;
  // Today, yesterday and this week all fall in the last point.
  $: selected = hover ?? (range === "last-week" ? LAST - 1 : LAST);
  $: hoverWeek = hover === null ? null : report.weeks[hover];
  const AXIS_LABELS = [0, 3, 6, LAST];

  // Snap to the nearest week, but only leave the current one once the pointer
  // is 55% of the way to a neighbour, so the band between two points can't flicker.
  function onPointerMove(e: PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const f = Math.min(LAST, Math.max(0, (((e.clientX - rect.left) * W) / rect.width - LEFT) / STEP));
    let i = hover ?? Math.round(f);
    while (i < LAST && f > i + 0.55) i++;
    while (i > 0 && f < i - 0.55) i--;
    hover = i;
  }

  /** Svelte action: renders the node into `target` instead of where it is written. */
  function moveTo(node: HTMLElement, target: HTMLElement) {
    target.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function pointTitle(i: number): string {
    const week = report.weeks[i];
    const key = week.current ? "report.graph.pointSoFar" : "report.graph.point";
    return t(key, { range: weekRange(week.start), n: week.count });
  }
</script>

<svelte:window on:click={() => (optionsOpen = false)} />

<div class="gtd-report">
  <div class="gtd-report-header" use:moveTo={headerEl}>
    <div class="gtd-report-title">
      <span class="gtd-report-title-icon" use:icon={"trophy"}></span>
      {t("report.title")}
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <span
      class="clickable-icon"
      class:is-active={infoOpen}
      title={t("report.info.button")}
      on:click={() => (infoOpen = !infoOpen)}
      use:icon={"info"}
    ></span>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <span
      class="clickable-icon"
      class:is-active={optionsOpen}
      title={t("report.options.button")}
      on:click|stopPropagation={() => (optionsOpen = !optionsOpen)}
      use:icon={"sliders-horizontal"}
    ></span>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <span class="clickable-icon gtd-report-close" on:click={onClose} use:icon={"x"}></span>

    {#if optionsOpen}
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <div class="gtd-report-options" on:click|stopPropagation>
        {#each options as option (option.key)}
          <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
          <div class="gtd-report-option" on:click={() => setOption(option.key, !option.value)}>
            <span>{option.label}</span>
            <div class="checkbox-container" class:is-enabled={option.value}></div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if infoOpen}
    <div class="gtd-report-info">
      <div class="gtd-report-info-title">{t("report.info.title")}</div>
      <ul>
        <li>{t("report.info.source")}</li>
        <li>
          {t("report.info.undated")}
          {#if report.undated > 0}{" "}{t("report.info.undatedCount", { n: report.undated })}{/if}
        </li>
        <li>{t("report.info.removed")}</li>
        <li>{t("report.info.recurring")}</li>
        <li>{t("report.info.cancelled")}</li>
        <li>{t("report.info.weekStart", { day: weekdayFormat.format(report.weeks[LAST].start) })}</li>
      </ul>
    </div>
  {/if}

  <div class="gtd-report-tabs" role="tablist">
    {#each REPORT_RANGES as r}
      <button
        class="gtd-report-tab"
        class:is-selected={r === range}
        role="tab"
        aria-selected={r === range}
        on:click={() => (range = r)}
      >
        {t(`report.tabs.${TAB_KEYS[r]}`)}
        <span class="gtd-report-tab-count">{completedCount(report.ranges[r])}</span>
      </button>
    {/each}
  </div>

  {#if showGraph}
    <div class="gtd-report-plot">
      <div class="gtd-report-plot-caption">
        <span>{t("report.graph.title")}</span>
        <span>
          {#if hoverWeek}
            {hoverWeek.current
              ? t("report.graph.soFar", { range: weekRange(hoverWeek.start) })
              : weekRange(hoverWeek.start)}
          {:else}
            {t("report.graph.span", { n: REPORT_WEEKS })}
          {/if}
        </span>
      </div>
      <svg
        viewBox="0 0 {W} {H}"
        role="img"
        aria-label={t("report.graph.title")}
        on:pointermove={onPointerMove}
        on:pointerleave={() => (hover = null)}
      >
        {#each [0, top / 2, top] as v}
          <line class="gtd-plot-grid" class:is-base={v === 0} x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} />
        {/each}
        <polygon class="gtd-plot-area" points={areaPoints} />
        {#if hover !== null}
          <line class="gtd-plot-guide" x1={x(hover)} x2={x(hover)} y1={TOP - 4} y2={y(0)} />
        {/if}
        <polyline class="gtd-plot-line" points={solidPoints} />
        <line
          class="gtd-plot-line is-current"
          x1={x(LAST - 1)}
          y1={y(report.weeks[LAST - 1].count)}
          x2={x(LAST)}
          y2={y(report.weeks[LAST].count)}
        />
        {#each report.weeks as week, i}
          <circle
            class="gtd-plot-point"
            class:is-current={week.current}
            cx={x(i)}
            cy={y(week.count)}
            r={i === selected ? 4.5 : 3}
          ><title>{pointTitle(i)}</title></circle>
        {/each}
        <text
          class="gtd-plot-value"
          x={x(selected)}
          y={y(report.weeks[selected].count) - 8}
          text-anchor={selected === LAST ? "end" : "middle"}
        >{report.weeks[selected].count}</text>
        {#each AXIS_LABELS as i}
          <text
            class="gtd-plot-axis"
            x={x(i)}
            y={H - 3}
            text-anchor={i === 0 ? "start" : i === LAST ? "end" : "middle"}
          >{i === LAST ? t("report.tabs.thisWeek") : shortFormat.format(report.weeks[i].start)}</text>
        {/each}
      </svg>
    </div>
  {/if}

  <div class="gtd-report-list">
    {#if entries.length === 0}
      <div class="gtd-report-empty">{t(`report.empty.${TAB_KEYS[range]}`)}</div>
    {:else}
      {#each days as d (d.date.getTime())}
        {#if showDayHeadings}
          <div class="gtd-report-day">
            {dayFormat.format(d.date)}
            <span class="gtd-report-chip" title={t("report.dayCount", { n: d.completed })}>{d.completed}</span>
          </div>
        {/if}
        {#each d.entries as entry (entry.task.id)}
          {@const task = entry.task}
          <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
          <div
            class="gtd-report-row"
            class:is-cancelled={entry.cancelled}
            title={t("report.openTask", { file: task.filePath })}
            on:click={() => onOpenTask(task)}
          >
            <span class="gtd-report-box"></span>
            <span class="gtd-report-text">{stripWikilinks(task.text)}</span>
            {#if showFileNames}
              <span class="gtd-report-file">{task.filePath.replace(/\.md$/, "")}</span>
            {/if}
          </div>
        {/each}
      {/each}
    {/if}
  </div>
</div>

<style>
  .gtd-report {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-3);
  }

  .gtd-report-header {
    position: relative;
    height: 100%;
    display: flex;
    align-items: center;
    gap: var(--size-2-1);
    /* Into the modal's padding, out to where Obsidian's own close button sits. */
    margin-inline-end: calc(var(--size-2-3) - var(--size-4-4));
  }
  .gtd-report-title {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    font-size: var(--font-ui-large);
    font-weight: var(--font-semibold);
  }
  /* A flex box hugs the SVG; as an inline box it sat at the top of a taller line. */
  .gtd-report-title-icon {
    display: flex;
  }

  .gtd-report-options {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: var(--layer-popover);
    min-width: 220px;
    padding: var(--size-2-3);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-s);
  }
  .gtd-report-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-4-4);
    padding: var(--size-2-3) var(--size-4-2);
    border-radius: var(--radius-s);
    font-size: var(--font-ui-small);
    cursor: var(--cursor);
  }
  .gtd-report-option:hover {
    background: var(--background-modifier-hover);
  }

  .gtd-report-info {
    padding: var(--size-4-3) var(--size-4-4);
    background: var(--background-secondary);
    border-radius: var(--radius-m);
    font-size: var(--font-ui-small);
    color: var(--text-muted);
    line-height: var(--line-height-normal);
  }
  .gtd-report-info-title {
    margin-bottom: var(--size-2-3);
    color: var(--text-normal);
    font-weight: var(--font-semibold);
  }
  .gtd-report-info ul {
    margin: 0;
    padding-inline-start: var(--size-4-5);
  }

  .gtd-report-tabs {
    display: flex;
    gap: var(--size-2-1);
    padding: var(--size-2-2);
    background: var(--background-secondary);
    border-radius: var(--radius-m);
  }
  button.gtd-report-tab {
    flex: 1;
    min-width: 0;
    height: auto;
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: var(--size-2-3);
    padding: var(--size-2-3) var(--size-2-2);
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    white-space: nowrap;
  }
  button.gtd-report-tab:hover {
    background: var(--background-modifier-hover);
  }
  button.gtd-report-tab.is-selected {
    background: var(--background-primary);
    box-shadow: var(--shadow-s);
    color: var(--text-normal);
  }
  .gtd-report-tab-count {
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .gtd-report-tab.is-selected .gtd-report-tab-count {
    color: var(--text-accent);
  }

  .gtd-report-plot-caption {
    display: flex;
    justify-content: space-between;
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    margin-bottom: var(--size-2-1);
  }
  .gtd-report-plot svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    touch-action: pan-y;
  }
  .gtd-plot-grid {
    stroke: var(--background-modifier-border);
    stroke-width: 1;
    stroke-dasharray: 2 4;
  }
  .gtd-plot-grid.is-base {
    stroke-dasharray: none;
  }
  .gtd-plot-area {
    fill: hsla(var(--interactive-accent-hsl), 0.12);
  }
  .gtd-plot-guide {
    stroke: var(--text-muted);
    stroke-width: 1;
    stroke-dasharray: 1 3;
  }
  .gtd-plot-line {
    fill: none;
    stroke: var(--interactive-accent);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .gtd-plot-line.is-current {
    stroke-dasharray: 3 3;
  }
  .gtd-plot-point {
    fill: var(--interactive-accent);
  }
  .gtd-plot-point.is-current {
    fill: var(--background-primary);
    stroke: var(--interactive-accent);
    stroke-width: 1.75;
  }
  .gtd-plot-value {
    fill: var(--text-normal);
    font-size: 11px;
    font-weight: var(--font-semibold);
  }
  .gtd-plot-axis {
    fill: var(--text-faint);
    font-size: 10px;
  }

  .gtd-report-list {
    max-height: 360px;
    overflow-y: auto;
  }
  .gtd-report-empty {
    padding: var(--size-4-6) 0;
    text-align: center;
    color: var(--text-faint);
    font-size: var(--font-ui-small);
  }
  .gtd-report-day {
    display: flex;
    align-items: center;
    gap: var(--size-2-3);
    padding: var(--size-4-3) var(--size-4-2) var(--size-2-2);
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    color: var(--text-muted);
  }
  .gtd-report-day:first-child {
    padding-top: 0;
  }
  .gtd-report-chip {
    min-width: 18px;
    padding: 0 var(--size-2-3);
    border-radius: var(--radius-l);
    background: hsla(var(--interactive-accent-hsl), 0.15);
    color: var(--text-accent);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .gtd-report-row {
    display: flex;
    align-items: flex-start;
    gap: var(--size-4-2);
    padding: var(--size-2-2) var(--size-4-2);
    border-radius: var(--radius-s);
    font-size: var(--font-ui-medium);
    line-height: var(--line-height-tight);
    cursor: var(--cursor);
  }
  .gtd-report-row:hover {
    background: var(--background-modifier-hover);
  }
  .gtd-report-box {
    flex: none;
    width: 14px;
    height: 14px;
    margin-top: 2px;
    border-radius: var(--radius-s);
    background: var(--interactive-accent);
    display: grid;
    place-items: center;
  }
  /* A tick drawn from two borders, so no icon has to be injected per row. */
  .gtd-report-box::after {
    content: "";
    width: 4px;
    height: 8px;
    margin-top: -2px;
    border: solid var(--text-on-accent);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .is-cancelled .gtd-report-box {
    background: transparent;
    border: 1.5px solid var(--text-faint);
  }
  .is-cancelled .gtd-report-box::after {
    width: 7px;
    height: 0;
    margin-top: 0;
    border-width: 1.5px 0 0 0;
    border-color: var(--text-faint);
    transform: none;
  }
  .gtd-report-text {
    flex: 1;
    min-width: 0;
  }
  .is-cancelled .gtd-report-text {
    color: var(--text-faint);
    text-decoration: line-through;
  }
  .gtd-report-file {
    flex: none;
    max-width: 40%;
    margin-top: 1px;
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
