import { App, Modal, Notice } from "obsidian";

export class BaseStarterModal extends Modal {
	constructor(
		app: App,
		private defaultPath: string,
		private onCreate: (path: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("eo-modal");
		contentEl.createEl("h2", { text: "生成示例 Base 文件" });
		contentEl.createEl("p", {
			cls: "eo-muted",
			text: "示例 Base 会包含客户目录过滤、默认排除标签，以及一个「Email Outreach 客户工作台」视图。你也可以在现有 Base 里手动新增这种视图。",
		});
		const group = contentEl.createDiv({ cls: "eo-detail-field" });
		group.createEl("label", { text: "Base 文件路径" });
		const input = group.createEl("input", {
			type: "text",
			value: this.defaultPath,
		});
		const buttons = contentEl.createDiv({ cls: "eo-modal-buttons" });
		buttons
			.createEl("button", { text: "取消" })
			.addEventListener("click", () => this.close());
		buttons
			.createEl("button", { cls: "mod-cta", text: "生成" })
			.addEventListener("click", () => {
				void (async () => {
					const path = input.value.trim();
					if (!path) {
						new Notice("请填写路径");
						return;
					}
					try {
						await this.onCreate(path);
						this.close();
					} catch (error) {
						new Notice(
							error instanceof Error ? error.message : String(error),
						);
					}
				})();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
