<script lang="ts">
  import { fade } from "svelte/transition";

  export let type: "confetti" | "creature" | "creature-and-confetti";
  export let imagePaths: string[] = [];

  // Pick a random creature image once per mount
  const creatureUrl = imagePaths.length > 0
    ? imagePaths[Math.floor(Math.random() * imagePaths.length)]
    : null;

  const COLORS = [
    "#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff",
    "#ff922b", "#cc5de8", "#f06595", "#74c0fc"
  ];

  const particles = Array.from({ length: 25 }, () => ({
    left: Math.random() * 90 + 5,
    delay: Math.random() * 800,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: Math.random() > 0.5 ? 8 : 6,
    duration: 1200 + Math.random() * 600,
    rotation: Math.random() * 360,
  }));
</script>

<div class="gtd-celebration-overlay">
  {#if (type === "creature" || type === "creature-and-confetti") && creatureUrl}
    <img class="gtd-creature-fly" src={creatureUrl} alt="" transition:fade={{ duration: 100 }} />
  {/if}

  {#if type === "confetti" || type === "creature-and-confetti"}
    {#each particles as p}
      <div
        class="gtd-confetti-particle"
        style="left:{p.left}%;animation-delay:{p.delay}ms;animation-duration:{p.duration}ms;background-color:{p.color};width:{p.size}px;height:{p.size}px;--rotation:{p.rotation}deg"
      ></div>
    {/each}
  {/if}
</div>
