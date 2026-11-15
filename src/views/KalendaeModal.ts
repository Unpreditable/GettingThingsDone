import { App, Modal, Notice } from "obsidian";
import { t } from "../i18n/i18n";
import { KALENDAE_ID, enableKalendae, kalendaeState } from "../integrations/Kalendae";
import type { DatePicker, KalendaeState } from "../integrations/Kalendae";

type Need = Exclude<KalendaeState, { kind: "ready" | "unloaded" }>;
type NeedKind = Need["kind"];

const TEXT: Record<NeedKind, { message: string; action: string }> = {
  missing: { message: "kalendae.installMessage", action: "kalendae.install" },
  outdated: { message: "kalendae.updateMessage", action: "kalendae.update" },
  disabled: { message: "kalendae.enableMessage", action: "kalendae.enable" },
};

/** Asks to install, update, or enable Kalendae; resolves true when the reader agrees. */
class KalendaeModal extends Modal {
  private agreed = false;

  constructor(app: App, private need: Need, private onDone: (agreed: boolean) => void) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText(t("panel.title"));
    const params = this.need.kind === "outdated" ? { version: this.need.version } : undefined;
    this.contentEl.createEl("p", { text: t(TEXT[this.need.kind].message, params) });

    const footer = this.contentEl.createDiv({ cls: "modal-button-container" });
    const actionBtn = footer.createEl("button", { text: t(TEXT[this.need.kind].action), cls: "mod-cta" });
    actionBtn.onclick = () => {
      this.agreed = true;
      this.close();
    };
    const cancelBtn = footer.createEl("button", { text: t("common.cancel") });
    cancelBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
    this.onDone(this.agreed);
  }
}

function ask(app: App, need: Need): Promise<boolean> {
  return new Promise((resolve) => new KalendaeModal(app, need, resolve).open());
}

/**
 * A Custom… click: Kalendae's calendar when it can open one, or else the step
 * that gets it there. Resolves with the picked day, or null when none was.
 */
export function pickWithKalendae(app: App): DatePicker {
  return async (value, anchor, allowed) => {
    const state = kalendaeState(app);
    if (state.kind === "ready") return state.pick(value, anchor, allowed);
    if (state.kind === "unloaded") {
      new Notice(t("kalendae.unloaded"));
      return null;
    }

    if (!(await ask(app, state))) return null;

    if (state.kind !== "disabled") {
      // Obsidian's plugin browser, on Kalendae's page.
      window.open(`obsidian://show-plugin?id=${KALENDAE_ID}`);
      return null;
    }

    const next = (await enableKalendae(app)) ? kalendaeState(app) : null;
    if (next?.kind !== "ready") {
      new Notice(t("kalendae.enableFailed"));
      return null;
    }
    return next.pick(value, anchor, allowed);
  };
}
