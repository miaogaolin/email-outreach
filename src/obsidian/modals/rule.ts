import { App, Modal } from "obsidian";
import type { RuleDraft } from "../../core/prompt";

export class RuleModal extends Modal {
	private draft: RuleDraft;

	constructor(
		app: App,
		draft: RuleDraft,
		private sourceLabel: string,
		private onConfirm: (draft: RuleDraft) => void,
	) {
		super(app);
		this.draft = { ...draft };
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("eo-modal eo-rule-modal");
		contentEl.createEl("h2", { text: "保存为长期规则" });
		contentEl.createEl("p", {
			cls: "eo-muted",
			text: `AI 整理出的规则，确认后写入 Feedback.md。来源：${this.sourceLabel}`,
		});

		const titleGroup = contentEl.createDiv({ cls: "eo-detail-field" });
		titleGroup.createEl("label", { text: "规则标题" });
		const titleInput = titleGroup.createEl("input", {
			type: "text",
			value: this.draft.ruleTitle,
		});

		const scopeGroup = contentEl.createDiv({ cls: "eo-detail-field" });
		scopeGroup.createEl("label", { text: "适用范围" });
		const scopeInput = scopeGroup.createEl("input", {
			type: "text",
			value: this.draft.scope,
		});

		const textGroup = contentEl.createDiv({ cls: "eo-detail-field" });
		textGroup.createEl("label", { text: "规则内容" });
		const textInput = textGroup.createEl("textarea");
		textInput.value = this.draft.ruleText;
		textInput.rows = 6;

		const buttons = contentEl.createDiv({ cls: "eo-modal-buttons" });
		buttons
			.createEl("button", { text: "取消" })
			.addEventListener("click", () => this.close());
		buttons
			.createEl("button", { cls: "mod-cta", text: "确认写入 Feedback.md" })
			.addEventListener("click", () => {
				const ruleText = textInput.value.trim();
				if (!ruleText) return;
				this.onConfirm({
					ruleTitle: titleInput.value.trim() || this.draft.ruleTitle,
					ruleText,
					scope: scopeInput.value.trim() || this.draft.scope,
				});
				this.close();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
