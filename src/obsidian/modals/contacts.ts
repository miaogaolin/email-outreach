import { App, Modal } from "obsidian";
import type { ContactParseResult, CustomerRecord } from "../../core/types";

export class ContactModal extends Modal {
	constructor(
		app: App,
		private record: CustomerRecord,
		private parsed: ContactParseResult,
		private onOpenNote: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("eo-modal eo-contact-modal");
		contentEl.createEl("h2", { text: `${this.record.name} · 联系人` });
		contentEl.createEl("p", {
			cls: "eo-muted",
			text: `解析自 ${this.parsed.headingFound ? `第 ${this.parsed.headingLine} 行的联系人区段` : "（没有找到联系人区段）"}，共 ${this.parsed.contacts.length} 个条目，其中 ${this.parsed.contacts.filter((contact) => contact.emails.length > 0).length} 个有邮箱。`,
		});

		const list = contentEl.createDiv({ cls: "eo-contact-list" });
		if (this.parsed.contacts.length === 0) {
			list.createDiv({
				cls: "eo-empty",
				text: "没有解析出联系人。客户文件里需要有 ## Contact 或 ## 联系人 区段。",
			});
		}
		for (const contact of this.parsed.contacts) {
			const card = list.createDiv({ cls: "eo-contact-card" });
			const head = card.createDiv({ cls: "eo-contact-head" });
			head.createSpan({ cls: "eo-contact-id", text: contact.id });
			head.createSpan({ cls: "eo-contact-name", text: contact.raw });
			if (contact.emails.length === 0) {
				head.createSpan({ cls: "eo-badge eo-badge-warn", text: "无邮箱" });
			}
			if (contact.role) {
				card.createDiv({ cls: "eo-contact-role", text: `职位：${contact.role}` });
			}
			for (const email of contact.emails) {
				card.createDiv({ cls: "eo-contact-line", text: `邮箱：${email}` });
			}
			for (const phone of contact.phones) {
				card.createDiv({ cls: "eo-contact-line", text: `电话：${phone}` });
			}
			for (const link of contact.links) {
				card.createDiv({ cls: "eo-contact-line", text: `链接：${link}` });
			}
			for (const note of contact.notes) {
				card.createDiv({ cls: "eo-contact-line eo-muted", text: `备注：${note}` });
			}
		}

		if (this.parsed.warnings.length > 0) {
			const warnings = contentEl.createDiv({ cls: "eo-warning-box" });
			warnings.createEl("h4", { text: "解析提示" });
			for (const warning of this.parsed.warnings) {
				warnings.createDiv({
					text: `第 ${warning.line} 行：${warning.message}（${warning.text}）`,
				});
			}
		}

		const buttons = contentEl.createDiv({ cls: "eo-modal-buttons" });
		buttons
			.createEl("button", { text: "打开客户文件" })
			.addEventListener("click", () => {
				this.close();
				this.onOpenNote();
			});
		buttons
			.createEl("button", { cls: "mod-cta", text: "关闭" })
			.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
