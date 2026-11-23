<script lang="ts">
  import type { PlanViewState } from "../PlanSession";
  import { icon } from "./icon";
  import { t } from "../i18n/i18n";

  export let state: PlanViewState;
  export let peeking: boolean;
  export let dropMode: "pin" | "ask";
  export let onUndo: () => void;
  export let onRedo: () => void;
  export let onApply: () => void;
  export let onDiscard: () => void;
  export let onToggleDropMode: () => void;
  export let onTogglePeek: () => void;
  export let onOpenPlanIntro: () => void;
  /** The success strip's last step: sliding up into the normal view. */
  export let sliding: boolean = false;

  $: planning = state.phase === "planning";
  $: count = state.summary.count;
  $: undoDisabled = !planning || peeking || !state.canUndo || state.undoBlocked;
  $: redoDisabled = !planning || peeking || !state.canRedo;
  $: applyDisabled = !planning || peeking || count === 0;
  $: undoTitle = state.undoBlocked ? t("plan.toolbar.undoBlocked") : t("plan.toolbar.undo");

  function run(disabled: boolean, action: () => void) {
    return () => {
      if (!disabled) action();
    };
  }

  function onKey(action: () => void) {
    return (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        action();
      }
    };
  }
</script>

{#if state.phase === "applied"}
  <div class="gtd-plan-toolbar is-applied" class:is-sliding={sliding}>
    <span class="gtd-plan-label">{t("plan.toolbar.applied", { count: state.appliedCount })}</span>
  </div>
{:else}
  <div class="gtd-plan-toolbar" class:is-peeking={peeking}>
    <div class="gtd-plan-row">
      <span class="gtd-plan-label">{peeking ? t("plan.toolbar.peekLabel") : t("plan.toolbar.label")}</span>
      <div class="gtd-plan-icons">
        {#if !peeking}
          <span
            class="clickable-icon gtd-plan-icon"
            class:is-disabled={undoDisabled}
            role="button"
            tabindex="0"
            aria-disabled={undoDisabled}
            aria-label={undoTitle}
            on:click={run(undoDisabled, onUndo)}
            on:keydown={onKey(run(undoDisabled, onUndo))}
            use:icon={"undo-2"}
          ></span>
          <span
            class="clickable-icon gtd-plan-icon"
            class:is-disabled={redoDisabled}
            role="button"
            tabindex="0"
            aria-disabled={redoDisabled}
            aria-label={t("plan.toolbar.redo")}
            on:click={run(redoDisabled, onRedo)}
            on:keydown={onKey(run(redoDisabled, onRedo))}
            use:icon={"redo-2"}
          ></span>
          <span
            class="clickable-icon gtd-plan-icon"
            role="button"
            tabindex="0"
            aria-label={dropMode === "pin" ? t("plan.toolbar.pinMode") : t("plan.toolbar.askMode")}
            on:click={onToggleDropMode}
            on:keydown={onKey(onToggleDropMode)}
            use:icon={dropMode === "pin" ? "pin" : "calendar"}
          ></span>
        {/if}
        <span
          class="clickable-icon gtd-plan-icon gtd-plan-peek"
          class:is-active={peeking}
          role="button"
          tabindex="0"
          aria-pressed={peeking}
          aria-label={peeking ? t("plan.toolbar.backToPlan") : t("plan.toolbar.peek")}
          on:click={onTogglePeek}
          on:keydown={onKey(onTogglePeek)}
        >
          <span class="gtd-plan-peek-icon" use:icon={"eye"}></span>
          {#if peeking}<span class="gtd-plan-peek-text">{t("plan.toolbar.backToPlan")}</span>{/if}
        </span>
        {#if !peeking}
          <span
            class="clickable-icon gtd-plan-icon"
            role="button"
            tabindex="0"
            aria-label={t("plan.toolbar.info")}
            on:click={onOpenPlanIntro}
            on:keydown={onKey(onOpenPlanIntro)}
            use:icon={"info"}
          ></span>
        {/if}
      </div>
    </div>
    <div class="gtd-plan-row gtd-plan-buttons">
      <button class="mod-cta" disabled={applyDisabled} on:click={run(applyDisabled, onApply)}>
        {count === 0 ? t("plan.toolbar.noChanges") : t("plan.toolbar.apply", { count })}
      </button>
      <button disabled={!planning || peeking} on:click={run(!planning || peeking, onDiscard)}>
        {t("plan.toolbar.discard")}
      </button>
    </div>
  </div>
{/if}

<style>
  .gtd-plan-toolbar {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 12px;
    background: var(--background-secondary);
    border-left: 3px solid var(--interactive-accent);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .gtd-plan-toolbar.is-applied {
    max-height: 4em;
    overflow: hidden;
    transition: max-height 200ms ease, padding 200ms ease, opacity 200ms ease;
  }

  .gtd-plan-toolbar.is-applied.is-sliding {
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
    opacity: 0;
  }

  .gtd-plan-toolbar.is-applied .gtd-plan-label {
    color: var(--color-green);
  }

  @media (prefers-reduced-motion: reduce) {
    .gtd-plan-toolbar.is-applied {
      transition: none;
    }
  }

  .gtd-plan-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .gtd-plan-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-ui-small);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
  }

  .gtd-plan-icons {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  span.gtd-plan-icon.is-disabled {
    opacity: 0.4;
    cursor: default;
  }

  span.gtd-plan-peek {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  span.gtd-plan-peek.is-active {
    background: var(--background-modifier-hover);
    color: var(--text-accent);
  }

  .gtd-plan-peek-text {
    font-size: var(--font-ui-smaller);
  }

  .gtd-plan-buttons {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .gtd-plan-buttons button {
    min-width: 0;
  }
</style>
