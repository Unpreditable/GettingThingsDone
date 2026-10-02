import { App, Modal } from "obsidian";
import { t } from "../i18n/i18n";

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private message: string,
    private confirmLabel: string,
    private onConfirm: () => void | Promise<void>
  ) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText(t("panel.title"));
    this.contentEl.createEl("p", { text: this.message });

    const footer = this.contentEl.createDiv({
      cls: "modal-button-container",
    });

    const confirmBtn = footer.createEl("button", {
      text: this.confirmLabel,
      cls: "mod-warning",
    });
    confirmBtn.onclick = () => {
      void this.onConfirm();
      this.close();
    };

    const cancelBtn = footer.createEl("button", { text: t("common.cancel") });
    cancelBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
