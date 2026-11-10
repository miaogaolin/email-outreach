import { App, Modal } from "obsidian";

export class SelfCheckModal extends Modal {
	constructor(
		app: App,
		private report: string,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("eo-modal eo-selfcheck-modal");
		contentEl.createEl("h2", { text: "Email Outreach 自检" });
		const pre = contentEl.createEl("pre", { cls: "eo-selfcheck" });
		pre.setText(this.report);
		const buttons = contentEl.createDiv({ cls: "eo-modal-buttons" });
		buttons
			.createEl("button", { text: "复制报告" })
			.addEventListener("click", () => {
				void navigator.clipboard.writeText(this.report);
			});
		buttons
			.createEl("button", { cls: "mod-cta", text: "关闭" })
			.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
