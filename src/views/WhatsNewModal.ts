import { App, Component, MarkdownRenderer, Modal } from "obsidian";
import { i18next, t } from "../i18n/i18n";
import { changelogFor } from "../changelog";

/** The changelog, in the UI language when it has been translated. */
export class WhatsNewModal extends Modal {
  private component = new Component();

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("gtd-whats-new-modal");
    this.titleEl.setText(t("whatsNew.title"));
    this.component.load();
    const { text, isEnglish } = changelogFor(i18next.language);
    const body = createDiv({ cls: "gtd-whats-new" });

    if (!isEnglish) {
      let showingEnglish = false;
      // In the header row, beside the title: Obsidian wraps the title in .modal-header.
      const link = (this.titleEl.parentElement ?? this.contentEl).createEl("a", {
        text: t("whatsNew.readInEnglish"),
        cls: "gtd-whats-new-english",
        href: "#",
      });
      link.onclick = (e) => {
        e.preventDefault();
        showingEnglish = !showingEnglish;
        link.setText(t(showingEnglish ? "whatsNew.readTranslated" : "whatsNew.readInEnglish"));
        this.render(body, showingEnglish ? changelogFor("en").text : text);
      };
    }

    this.contentEl.appendChild(body);
    this.render(body, text);
  }

  private render(el: HTMLElement, markdown: string) {
    el.empty();
    void MarkdownRenderer.render(this.app, markdown, el, "", this.component);
  }

  onClose() {
    this.component.unload();
    this.contentEl.empty();
  }
}
