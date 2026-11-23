import { App, Modal, setIcon } from "obsidian";
import { t } from "../i18n/i18n";

/** Stand-ins handed to `t`, then swapped for the bold button names and the eye icon. */
const TOKENS = { apply: "\uE000", discard: "\uE001", eye: "\uE002" };

function fill(el: HTMLElement, key: string): void {
  for (const part of t(key, TOKENS).split(/([\uE000-\uE002])/)) {
    if (part === TOKENS.apply) el.createEl("strong", { text: t("plan.toolbar.applyName") });
    else if (part === TOKENS.discard) el.createEl("strong", { text: t("plan.toolbar.discard") });
    else if (part === TOKENS.eye) setIcon(el.createSpan({ cls: "gtd-plan-intro-icon" }), "eye");
    else if (part) el.appendText(part);
  }
}

/**
 * What plan mode does. "enter" is shown on the way in, with Cancel and Start
 * planning; "info" is the ⓘ button's copy of the same text, with one way back.
 */
export class PlanIntroModal extends Modal {
  constructor(
    app: App,
    private variant: "enter" | "info",
    private onStart?: (dontShowAgain: boolean) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("gtd-plan-intro-modal");
    this.titleEl.setText(t("plan.intro.title"));
    const lead = contentEl.createEl("p");
    fill(lead, "plan.intro.lead");
    lead.createEl("br");
    fill(lead, "plan.intro.leadButtons");
    const list = contentEl.createEl("ul");
    for (const key of ["plan.intro.waits", "plan.intro.saves", "plan.intro.peek", "plan.intro.notSaved"]) {
      fill(list.createEl("li"), key);
    }

    const footer = contentEl.createDiv({ cls: "modal-button-container" });

    if (this.variant === "info") {
      footer.createEl("button", { text: t("plan.intro.back"), cls: "mod-cta" }).onclick = () => this.close();
      return;
    }

    const label = footer.createEl("label", { cls: "mod-checkbox gtd-plan-intro-dont-show" });
    const checkbox = label.createEl("input", { type: "checkbox" });
    label.appendText(t("plan.intro.dontShow"));

    footer.createEl("button", { text: t("plan.intro.cancel") }).onclick = () => this.close();
    footer.createEl("button", { text: t("plan.intro.start"), cls: "mod-cta" }).onclick = () => {
      this.close();
      this.onStart?.(checkbox.checked);
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
