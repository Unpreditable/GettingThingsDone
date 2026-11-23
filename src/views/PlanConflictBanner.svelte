<script lang="ts">
  import type { Conflict } from "../core/plan/Plan";
  import type { ConflictWording } from "../core/plan/ConflictWording";

  export let conflicts: { conflict: Conflict; wording: ConflictWording }[];
  export let onAnswer: (conflict: Conflict, choice: "note" | "plan") => void;
</script>

<!-- One banner for every open conflict, never one per conflict. -->
<div class="gtd-language-banner gtd-plan-conflicts">
  {#each conflicts as { conflict, wording } (conflict.entryId + conflict.field)}
    <div class="gtd-plan-conflict">
      <span class="gtd-language-banner-message">
        {wording.message}
      </span>
      <div class="gtd-language-banner-actions">
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span class="gtd-language-banner-btn" on:click={() => onAnswer(conflict, "note")}>{wording.useNote}</span>
        <span class="gtd-language-banner-sep" aria-hidden="true">·</span>
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span class="gtd-language-banner-btn" on:click={() => onAnswer(conflict, "plan")}>{wording.keepPlan}</span>
      </div>
    </div>
  {/each}
</div>

<style>
  .gtd-plan-conflict {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
</style>
