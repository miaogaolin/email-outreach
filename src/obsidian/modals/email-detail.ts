import { App, Modal, Notice } from "obsidian";
import {
	currentEmailVersion,
	emailUpdatedAt,
	versionSnapshotText,
} from "../../core/ai-file";
import { emailEditIntent } from "../../core/prompt";
import { formatBeijingTime } from "../../core/send-time";
import type { CustomerAIFile, EmailRow } from "../../core/types";
import { confirm } from "./confirm";

/** 「重新生成」过程中回传给弹窗的进度事件。 */
export interface RegenerateProgressEvent {
	/** 正在做什么，一句短说明。 */
	step: string;
	/** 补充信息：依据哪一版、模型、错误原因等。 */
	detail?: string;
	/** 0–1 的确定进度；缺省表示进度不确定（显示滚动条）。 */
	fraction?: number;
}

export interface EmailDetailHost {
	app: App;
	getRow(key: string): EmailRow | null;
	getAIFile(path: string): CustomerAIFile | null;
	saveEmailEdit(row: EmailRow, subject: string, body: string): Promise<void>;
	/** 返回是否真的写入了新版本（配置不全、已发送等情况返回 false）。 */
	regenerateEmail(
		row: EmailRow,
		comment: string,
		onProgress?: (event: RegenerateProgressEvent) => void,
	): Promise<boolean>;
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

function normalizeText(value: string): string {
	return value.replace(/\r\n?/g, "\n").trim();
}

export class EmailDetailModal extends Modal {
	private row: EmailRow;
	private subjectInput: HTMLInputElement | null = null;
	private bodyInput: HTMLTextAreaElement | null = null;
	private commentInput: HTMLTextAreaElement | null = null;
	private actionButton: HTMLButtonElement | null = null;
	private dirtyEl: HTMLElement | null = null;
	private progressEl: HTMLElement | null = null;
	private progressStepEl: HTMLElement | null = null;
	private progressDetailEl: HTMLElement | null = null;
	private progressTimeEl: HTMLElement | null = null;
	private progressBarEl: HTMLElement | null = null;
	private buttons: HTMLButtonElement[] = [];
	private busy = false;
	private closed = false;
	private elapsedTimer: number | null = null;
	private startedAt = 0;

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
		if (this.closed) return;
		const updated = this.host.getRow(this.row.key);
		if (!updated) {
			this.close();
			return;
		}
		this.row = updated;
		this.render();
	}

	// ------------------------------------------------------------ dirty state

	private isDirty(): boolean {
		if (!this.subjectInput || !this.bodyInput) return false;
		const record = this.row.record;
		return (
			normalizeText(this.subjectInput.value) !== normalizeText(record.subject) ||
			normalizeText(this.bodyInput.value) !== normalizeText(record.body)
		);
	}

	private updateDirtyHint(): void {
		if (!this.dirtyEl) return;
		const dirty = this.isDirty();
		this.dirtyEl.hidden = !dirty;
		if (!dirty) return;
		const version = currentEmailVersion(this.row.record);
		this.dirtyEl.setText(
			`有未保存的 Subject / Body 修改：填写修改意见提交时，会先保存为 v${version + 1} 再让 AI 按意见改写；不填意见直接提交会重新生成，这些改动会被丢弃。`,
		);
	}

	private commentValue(): string {
		return this.commentInput?.value.trim() ?? "";
	}

	/** 合并入口：意见有内容 = 按意见修改；留空 = 重新生成。 */
	private updateActionLabel(): void {
		if (!this.actionButton) return;
		const modify = emailEditIntent(this.commentValue()) === "modify";
		this.actionButton.setText(modify ? "按意见修改" : "重新生成");
		this.actionButton.setAttr(
			"title",
			modify
				? "先保存当前 Subject / Body（如有改动），再让 AI 按修改意见改写"
				: "没有修改意见：直接让 AI 重新生成，未保存的改动会被丢弃",
		);
	}

	// -------------------------------------------------------------- progress

	private setBusy(busy: boolean): void {
		this.busy = busy;
		for (const button of this.buttons) {
			button.disabled = busy || button.dataset.eoInitialDisabled === "1";
		}
		// 运行期间锁住 Subject / Body：结果回填时会被覆盖，边跑边改没有意义。
		if (this.subjectInput) this.subjectInput.readOnly = busy;
		if (this.bodyInput) this.bodyInput.readOnly = busy;
	}

	private startElapsedTimer(): void {
		this.stopElapsedTimer();
		this.startedAt = Date.now();
		const tick = (): void => {
			if (!this.progressTimeEl) return;
			const seconds = (Date.now() - this.startedAt) / 1000;
			this.progressTimeEl.setText(`已等待 ${seconds.toFixed(1)} 秒`);
		};
		tick();
		this.elapsedTimer = window.setInterval(tick, 100);
	}

	private stopElapsedTimer(): void {
		if (this.elapsedTimer !== null) {
			window.clearInterval(this.elapsedTimer);
			this.elapsedTimer = null;
		}
	}

	private showProgress(
		step: string,
		detail = "",
		fraction?: number,
	): void {
		if (!this.progressEl || this.closed) return;
		this.progressEl.hidden = false;
		this.progressEl.removeClass("is-error");
		if (this.progressStepEl) this.progressStepEl.setText(step);
		if (this.progressDetailEl) this.progressDetailEl.setText(detail);
		if (!this.progressBarEl) return;
		if (typeof fraction === "number") {
			const clamped = Math.min(1, Math.max(0, fraction));
			this.progressBarEl.addClass("is-determinate");
			this.progressBarEl.style.width = `${Math.round(clamped * 100)}%`;
		} else {
			this.progressBarEl.removeClass("is-determinate");
			this.progressBarEl.style.width = "";
		}
	}

	private showProgressError(message: string, step = "操作失败"): void {
		if (!this.progressEl || this.closed) return;
		this.progressEl.hidden = false;
		this.progressEl.addClass("is-error");
		if (this.progressStepEl) this.progressStepEl.setText(step);
		if (this.progressDetailEl) this.progressDetailEl.setText(message);
		if (this.progressTimeEl) this.progressTimeEl.setText("");
		if (this.progressBarEl) {
			this.progressBarEl.removeClass("is-determinate");
			this.progressBarEl.style.width = "";
		}
	}

	// ----------------------------------------------------------------- render

	private render(): void {
		const { contentEl } = this;
		this.subjectInput = null;
		this.bodyInput = null;
		this.commentInput = null;
		this.actionButton = null;
		this.dirtyEl = null;
		this.progressEl = null;
		this.progressStepEl = null;
		this.progressDetailEl = null;
		this.progressTimeEl = null;
		this.progressBarEl = null;
		this.buttons = [];
		this.busy = false;
		this.stopElapsedTimer();

		contentEl.empty();
		contentEl.addClass("eo-modal");
		contentEl.addClass("eo-email-detail");
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
		const beijingTime = formatBeijingTime(
			record.suggestedTime,
			record.timezone,
		);
		addMeta(
			"建议发送时间",
			beijingTime ? `北京时间 ${beijingTime}` : "",
		);
		if (
			beijingTime &&
			record.suggestedTime &&
			record.timezone &&
			record.timezone !== "Asia/Shanghai"
		) {
			addMeta(
				"客户当地时间",
				`${record.suggestedTime} · ${record.timezone}`,
			);
		}
		addMeta("时间理由", record.timeReason ?? "");
		addMeta("中文摘要", record.summaryZh);
		// 只有一个「更新时间」：首次生成时是创建时间，之后每次改动都会刷新。
		addMeta("更新时间", emailUpdatedAt(record));
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

		this.dirtyEl = contentEl.createDiv({
			cls: "eo-warning-box eo-detail-dirty",
		});
		this.dirtyEl.hidden = true;

		this.subjectInput.addEventListener("input", () => this.updateDirtyHint());
		this.bodyInput.addEventListener("input", () => this.updateDirtyHint());

		const commentGroup = contentEl.createDiv({ cls: "eo-detail-field" });
		commentGroup.createEl("label", {
			text: "修改意见（填写后按意见修改；留空则重新生成）",
		});
		this.commentInput = commentGroup.createEl("textarea", {
			cls: "eo-detail-comment",
		});
		this.commentInput.value = "";
		this.commentInput.rows = 3;
		this.commentInput.addEventListener("input", () =>
			this.updateActionLabel(),
		);

		const progress = contentEl.createDiv({ cls: "eo-detail-progress" });
		progress.hidden = true;
		const progressHead = progress.createDiv({ cls: "eo-detail-progress-head" });
		this.progressStepEl = progressHead.createSpan({
			cls: "eo-detail-progress-step",
		});
		this.progressTimeEl = progressHead.createSpan({
			cls: "eo-detail-progress-time",
		});
		const progressBar = progress.createDiv({ cls: "eo-progress-bar" });
		this.progressBarEl = progressBar.createDiv({
			cls: "eo-progress-bar-inner",
		});
		this.progressDetailEl = progress.createDiv({
			cls: "eo-detail-progress-detail",
		});
		this.progressEl = progress;

		const actions = contentEl.createDiv({ cls: "eo-detail-actions" });
		const addButton = (
			label: string,
			handler: () => Promise<void> | void,
			cls?: string,
			disabled = false,
		): HTMLButtonElement => {
			const button = actions.createEl("button", { text: label, cls });
			button.disabled = disabled;
			button.dataset.eoInitialDisabled = disabled ? "1" : "0";
			this.buttons.push(button);
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

		this.actionButton = addButton("重新生成", async () => {
			await this.submit();
		});
		this.updateActionLabel();

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

	/**
	 * 合并入口：
	 * - 修改意见有内容 → 先保存当前 Subject / Body（如有改动）作为新版本，再按意见修改；
	 * - 修改意见为空 → 重新生成（未保存的改动需要用户确认丢弃）。
	 */
	private async submit(): Promise<void> {
		if (this.busy) return;
		const comment = this.commentValue();
		const intent = emailEditIntent(comment);
		if (this.row.record.sent) {
			new Notice("已发送的邮件不能修改或重新生成");
			return;
		}
		const subject = this.subjectInput?.value.trim() ?? "";
		const body = this.bodyInput?.value ?? "";
		if (!subject || !body.trim()) {
			new Notice("Subject 和 Body 都不能为空");
			return;
		}
		if (intent === "modify" && this.isDirty()) {
			await this.host.saveEmailEdit(this.row, subject, body);
			const updated = this.host.getRow(this.row.key);
			if (updated) this.row = updated;
			this.updateDirtyHint();
		}
		await this.regenerate(comment);
	}

	private async regenerate(comment: string): Promise<void> {
		if (this.busy) return;
		const modify = emailEditIntent(comment) === "modify";
		const record = this.row.record;
		const version = currentEmailVersion(record);
		if (this.isDirty()) {
			const confirmed = await confirm(this.app, {
				title: "有未保存的修改",
				confirmText: modify ? "继续修改" : "继续生成",
				build: (container) => {
					container.createEl("p", {
						text: `弹窗里的 Subject / Body 还没有保存。${
							modify
								? "按意见修改只使用输出目录里已保存的内容"
								: "重新生成只使用输出目录里已保存的内容"
						}，未保存的修改会被丢弃。`,
					});
				},
			});
			if (!confirmed) return;
		}
		this.setBusy(true);
		this.showProgress(
			modify ? "正在按修改意见修改邮件…" : "正在重新生成邮件…",
			`依据输出目录里已保存的 v${version}`,
		);
		this.startElapsedTimer();
		try {
			const wrote = await this.host.regenerateEmail(
				this.row,
				comment,
				(event) => this.showProgress(event.step, event.detail, event.fraction),
			);
			this.stopElapsedTimer();
			if (!wrote) {
				this.setBusy(false);
				if (this.progressEl) this.progressEl.hidden = true;
				return;
			}
			this.showProgress("已生成新版本", "正在刷新列表…", 1);
			await this.afterAction();
		} catch (error) {
			this.stopElapsedTimer();
			const message = error instanceof Error ? error.message : String(error);
			this.showProgressError(
				message,
				modify ? "按意见修改失败" : "重新生成失败",
			);
			this.setBusy(false);
			new Notice(message, 9000);
		}
	}

	onClose(): void {
		this.closed = true;
		this.stopElapsedTimer();
		this.contentEl.empty();
	}
}
