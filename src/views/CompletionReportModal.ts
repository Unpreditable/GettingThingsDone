import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type GtdTasksPlugin from "../main";
import { buildCompletionReport } from "../core/CompletionReport";
import type { TaskRecord } from "../core/TaskParser";
import type { ReportOption } from "../settings";
import { i18next } from "../i18n/i18n";
import CompletionReport from "./CompletionReport.svelte";
import { revealTaskLine } from "./revealTaskLine";

/**
 * Tasks completed today, yesterday, this week and last week. Built once when
 * it opens: nothing behind a modal can change while it is up, and opening a
 * task closes it.
 */
export class CompletionReportModal extends Modal {
  private component?: ReturnType<typeof mount>;

  constructor(private plugin: GtdTasksPlugin) {
    super(plugin.app);
  }

  onOpen() {
    const { settings } = this.plugin;
    this.modalEl.addClass("gtd-report-modal");
    this.component = mount(CompletionReport, {
      target: this.contentEl,
      props: {
        report: buildCompletionReport(this.plugin.taskIndex.getAllTasks(), new Date(), settings.weekStartsOn),
        // Obsidian's typings leave out the modal's headerEl, the title's parent.
        headerEl: this.titleEl.parentElement ?? this.contentEl,
        locale: i18next.language,
        showGraph: settings.reportShowGraph,
        showCancelled: settings.reportShowCancelled,
        showFileNames: settings.reportShowFileNames,
        onOptionChange: (key: ReportOption, value: boolean) => {
          settings[key] = value;
          void this.plugin.saveSettings();
        },
        onClose: () => this.close(),
        onOpenTask: (task: TaskRecord) => {
          this.close();
          void revealTaskLine(this.app, task);
        },
      },
    });
  }

  onClose() {
    if (this.component) void unmount(this.component);
    this.component = undefined;
    this.contentEl.empty();
  }
}
