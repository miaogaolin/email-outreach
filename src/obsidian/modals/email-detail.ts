import { App, Modal, Notice } from "obsidian";
import { versionSnapshotText } from "../../core/ai-file";
import type { CustomerAIFile, EmailRow } from "../../core/types";

export interface EmailDetailHost {
	app: App;
	getRow(key: string): EmailRow | null;
	getAIFile(path: string): CustomerAIFile | null;
	saveEmailEdit(row: EmailRow, subject: string, body: string): Promise<void>;
	regenerateEmail(row: EmailRow, comment: string): Promise<void>;
	acceptEmail(row: EmailRow): Promise<void>;
	rejectEmail(row: EmailRow): Promise<void>;
	markEmailSent(row: EmailRow): Promise<void>;
	saveRuleFromEmail(row: EmailRow, comment: string): Promise<void>;
	openFile(path: string): void;
	refreshEmails(): Promise<void>;
}

const STATUS_LABELS: Record<string, string> = {
	Generated: "待审核",
	Revision: "已修改，待审核",
	Accepted: "已验收",
	Rejected: "已拒绝",
};

export class EmailDetailModal extends Modal {
	private row: EmailRow;
	private subjectInput: HTMLInputElement | null = null;
	private bodyInput: HTMLTextAreaElement | null = null;
	private commentInput: HTMLTextAreaElement | null = null;

	constructor(
		app: App,
		row: EmailRow,
		private host: EmailDetailHost,
	) {
		super(app);
		this.row = row;
	}

	onOpen(): void {
		this.render();
	}

	private async afterAction(): Promise<void> {
		await this.host.refreshEmails();
		const updated = this.host.getRow(this.row.key);
		if (!updated) {
			this.close();
			return;
		}
		this.row = updated;
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("eo-modal eo-email-detail");
		const record = this.row.record;

		const header = contentEl.createDiv({ cls: "eo-detail-header" });
		header.createEl("h2", { text: this.row.customerName });
		header.createSpan({
			cls: `eo-status eo-status-${record.status.toLowerCase()}`,
			text: STATUS_LABELS[record.status] ?? record.status,
		});

		const meta = contentEl.createDiv({ cls: "eo-detail-meta" });
		const addMeta = (label: string, value: string): void => {
			const item = meta.createDiv({ cls: "eo-detail-meta-item" });
			item.createSpan({ cls: "eo-muted", text: label });
			item.createSpan({ text: value || "—" });
		};
		addMeta("联系人", record.contact);
		addMeta("邮箱", record.email);
		addMeta("邮件语言", `${record.languageLabel || ""}（${record.language}）`);
		addMeta(
			"建议发送时间",
			record.suggestedTime
				? `${record.suggestedTime}${record.timezone ? ` · ${record.timezone}` : ""}`
				: "",
		);
		addMeta("中文摘要", record.summaryZh);
		addMeta("已发送", record.sent ? `是（${record.sentAt ?? ""}）` : "否");

		const subjectGroup = contentEl.createDiv({ cls: "eo-detail-field" });
		subjectGroup.createEl("label", { text: "Subject" });
		this.subjectInput = subjectGroup.createEl("input", {
			type: "text",
		});
		this.subjectInput.value = record.subject;

		const bodyGroup = contentEl.createDiv({ cls: "eo-detail-field" });
		bodyGroup.createEl("label", { text: "Body" });
		this.bodyInput = bodyGroup.createEl("textarea", {
			cls: "eo-detail-body",
		});
		this.bodyInput.value = record.body;
		this.bodyInput.rows = 14;

		const commentGroup = contentEl.createDiv({ cls: "eo-detail-field" });
		commentGroup.createEl("label", {
			text: "修改意见（用于重新生成 / 沉淀规则）",
		});
		this.commentInput = commentGroup.createEl("textarea", {
			cls: "eo-detail-comment",
		});
		this.commentInput.value = "";
		this.commentInput.rows = 3;

		const actions = contentEl.createDiv({ cls: "eo-detail-actions" });
		const addButton = (
			label: string,
			handler: () => Promise<void> | void,
			cls?: string,
			disabled = false,
		): HTMLButtonElement => {
			const button = actions.createEl("button", { text: label, cls });
			button.disabled = disabled;
			button.addEventListener("click", () => {
				void (async () => {
					try {
						await handler();
					} catch (error) {
						new Notice(
							error instanceof Error ? error.message : String(error),
						);
					}
				})();
			});
			return button;
		};

		addButton("保存修改", async () => {
			const subject = this.subjectInput?.value.trim() ?? "";
			const body = this.bodyInput?.value ?? "";
			if (!subject || !body.trim()) {
				new Notice("Subject 和 Body 都不能为空");
				return;
			}
			if (subject === record.subject && body === record.body) {
				new Notice("没有改动");
				return;
			}
			await this.host.saveEmailEdit(this.row, subject, body);
			await this.afterAction();
		});

		addButton("重新生成", async () => {
			const comment = this.commentInput?.value.trim() ?? "";
			await this.host.regenerateEmail(this.row, comment);
			await this.afterAction();
		});

		addButton(
			"验收通过",
			async () => {
				await this.host.acceptEmail(this.row);
				await this.afterAction();
			},
			"mod-cta",
			record.status === "Accepted",
		);

		addButton(
			"标记已发送",
			async () => {
				await this.host.markEmailSent(this.row);
				await this.afterAction();
			},
			undefined,
			record.status !== "Accepted" || record.sent,
		);

		addButton(
			"拒绝",
			async () => {
				await this.host.rejectEmail(this.row);
				await this.afterAction();
			},
			"mod-warning",
			record.status === "Rejected",
		);

		addButton("保存为长期规则", async () => {
			const comment = this.commentInput?.value.trim() ?? "";
			await this.host.saveRuleFromEmail(this.row, comment);
			await this.afterAction();
		});

		addButton("打开 AI 文件", () => {
			this.host.openFile(this.row.filePath);
		});

		// AI analysis of the customer, read from the AI file.
		const aiFile = this.host.getAIFile(this.row.filePath);
		if (aiFile?.analysis) {
			const analysis = contentEl.createDiv({ cls: "eo-detail-analysis" });
			analysis.createEl("h3", { text: "客户分析" });
			const list = analysis.createEl("ul");
			list.createEl("li", {
				text: `客户类型：${aiFile.analysis.customerType ?? "未知"}`,
			});
			list.createEl("li", {
				text: `Fit ${aiFile.analysis.fit ?? "—"} · Intent ${aiFile.analysis.intent ?? "—"} · Potential ${aiFile.analysis.potential ?? "—"} · Risk ${aiFile.analysis.risk ?? "—"}`,
			});
			for (const note of aiFile.analysis.riskNotes) {
				list.createEl("li", { text: `风险：${note}` });
			}
		}

		const versions = contentEl.createDiv({ cls: "eo-detail-versions" });
		versions.createEl("h3", { text: `修改历史（${record.versions.length} 版）` });
		for (const version of [...record.versions].reverse()) {
			const details = versions.createEl("details");
			details.createEl("summary", {
				text: `v${version.version} · ${version.at} · ${version.action}${version.userComment ? ` · 意见：${version.userComment}` : ""}`,
			});
			details.createEl("pre", { text: versionSnapshotText(version) });
		}

		const footer = contentEl.createDiv({ cls: "eo-modal-buttons" });
		footer
			.createEl("button", { text: "关闭" })
			.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
