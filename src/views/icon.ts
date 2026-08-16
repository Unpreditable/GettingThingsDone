import { setIcon } from "obsidian";

/**
 * Renders a Lucide icon into `el`. Cleared first because setIcon appends, so an
 * icon that changes name would otherwise stack two SVGs.
 *
 * Obsidian bundles a Lucide snapshot frozen at its release date and setIcon
 * fails *silently* on a name it doesn't know, so every name has to exist in the
 * manifest's minAppVersion. lucide.dev is not evidence of that; run
 * `npm run check-icons`, which reads a real install.
 */
export function renderIcon(el: HTMLElement, name: string): void {
  el.replaceChildren();
  setIcon(el, name);
}

/**
 * Svelte action: `use:icon={"pin"}`.
 *
 * Sizing the emitted SVG has to happen in styles.css, not a component's <style>
 * block: `.svg-icon` sets --icon-size on the svg itself, so a parent's value is
 * ignored, and the injected node carries no Svelte scope class.
 */
export function icon(node: HTMLElement, name: string) {
  renderIcon(node, name);

  return {
    update: (next: string) => renderIcon(node, next),
    destroy: () => node.replaceChildren(),
  };
}
