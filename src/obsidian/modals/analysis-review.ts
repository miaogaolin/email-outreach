import { App, Modal } from "obsidian";
import { buildCandidates, type FieldCandidate } from "../../core/merge";
import type { EmailRunResult, TaskSelection } from "../../core/types";

export interface AnalysisPlan {
	result: EmailRunResult;
	candidates: FieldCandidate[];
}

interface ReviewItem {
	result: EmailRunResult;
	candidates: FieldCandidate[];
}

const NUMERIC_KEYS = new Set(["fit", "indent", "potential", "risk"]);

export class AnalysisReviewModal extends Modal {
	private items: ReviewItem[] = [];

	constructor(
		app: App,
		results: EmailRunResult[],
		tasks: TaskSelection,
		private onSubmit: (plans: AnalysisPlan[]) => void,
		private onOpenEmailList: () => void,
	) {
		super(app);
		this.items = results
			.filter((result) => result.analysis)
			.map((result) => ({
				result,
				candidates: buildCandidates(
					result.customer.fm,
					result.analysis!,
					tasks,
				),
			}));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("eo-modal eo-review-modal");
		contentEl.createEl("h2", { text: "AI 分析结果确认" });
		contentEl.createEl("p", {
			cls: "eo-muted",
			text: "勾选要写入客户 YAML 的字段。已存在且不同的值标记为「冲突」，默认不覆盖。",
		});

		const generated = this.items.filter((item) => item.result.emailPath);
		if (generated.length > 0) {
			const banner = contentEl.createDiv({ cls: "eo-review-banner" });
			banner.setText(
				`已生成 ${generated.length} 封邮件草稿，保存在各客户的 AI 开发信息文件中，可在「邮件列表」里审核。`,
			);
			const open = banner.createEl("button", { text: "打开邮件列表" });
			open.addEventListener("click", () => {
				this.close();
				this.onOpenEmailList();
			});
		}

		if (this.items.length === 0) {
			contentEl.createDiv({
				cls: "eo-empty",
				text: "本次没有可写入的客户分析结果。",
			});
		}

		const toolbar = contentEl.createDiv({ cls: "eo-review-toolbar" });
		toolbar
			.createEl("button", { text: "勾选全部非冲突字段" })
			.addEventListener("click", () => {
				for (const item of this.items) {
					for (const candidate of item.candidates) {
						if (!candidate.conflict) candidate.selected = true;
					}
				}
				this.renderCards(contentEl);
			});
		toolbar
			.createEl("button", { text: "全部取消勾选" })
			.addEventListener("click", () => {
				for (const item of this.items) {
					for (const candidate of item.candidates) {
						candidate.selected = false;
					}
				}
				this.renderCards(contentEl);
			});

		this.cardsEl = contentEl.createDiv({ cls: "eo-review-cards" });
		this.renderCards(contentEl);

		const buttons = contentEl.createDiv({ cls: "eo-modal-buttons" });
		buttons
			.createEl("button", { text: "跳过（不写客户属性）" })
			.addEventListener("click", () => this.close());
		buttons
			.createEl("button", {
				cls: "mod-cta",
				text: "确认写入选中字段",
			})
			.addEventListener("click", () => {
				const plans = this.items
					.map((item) => ({
						result: item.result,
						candidates: item.candidates,
					}))
					.filter((plan) =>
						plan.candidates.some((candidate) => candidate.selected),
					);
				this.close();
				this.onSubmit(plans);
			});
	}

	private cardsEl: HTMLElement | null = null;

	private renderCards(container: HTMLElement): void {
		if (!this.cardsEl) return;
		this.cardsEl.empty();
		if (this.items.length === 0) return;
		for (const item of this.items) {
			const card = this.cardsEl.createDiv({ cls: "eo-review-card" });
			const head = card.createDiv({ cls: "eo-review-head" });
			head.createEl("strong", { text: item.result.customer.name });
			const status = head.createSpan({ cls: "eo-muted" });
			status.setText(
				item.result.errors.length > 0
					? `有 ${item.result.errors.length} 个错误`
					: item.result.emailPath
						? "邮件已生成"
						: "仅分析",
			);

			const table = card.createEl("table", { cls: "eo-review-table" });
			const body = table.createEl("tbody");
			for (const candidate of item.candidates) {
				const tr = body.createEl("tr");
				const selectCell = tr.createEl("td");
				const checkbox = selectCell.createEl("input", { type: "checkbox" });
				checkbox.checked = candidate.selected;
				checkbox.addEventListener("change", () => {
					candidate.selected = checkbox.checked;
				});
				tr.createEl("td", { text: candidate.label });
				const oldCell = tr.createEl("td", { cls: "eo-muted" });
				oldCell.setText(
					candidate.oldValue === undefined ||
						candidate.oldValue === null ||
						String(candidate.oldValue).trim() === ""
						? "（空）"
						: String(candidate.oldValue),
				);
				const newCell = tr.createEl("td");
				const input = newCell.createEl("input", {
					type: NUMERIC_KEYS.has(candidate.key) ? "number" : "text",
					value: String(candidate.value),
				});
				if (NUMERIC_KEYS.has(candidate.key)) {
					input.setAttr("min", "1");
					input.setAttr("max", "10");
					input.setAttr("step", "0.5");
				}
				input.addEventListener("change", () => {
					const raw = input.value.trim();
					if (NUMERIC_KEYS.has(candidate.key)) {
						const parsed = Number(raw);
						candidate.value = Number.isFinite(parsed)
							? parsed
							: candidate.value;
					} else {
						candidate.value = raw;
					}
				});
				const flag = tr.createEl("td");
				if (candidate.conflict) {
					flag.createSpan({ cls: "eo-badge eo-badge-warn", text: "冲突" });
				}
			}

			if (item.result.analysis?.riskNotes.length) {
				const notes = card.createDiv({ cls: "eo-review-notes" });
				notes.createEl("strong", { text: "风险说明" });
				const ul = notes.createEl("ul");
				for (const note of item.result.analysis.riskNotes) {
					ul.createEl("li", { text: note });
				}
			}
			if (item.result.analysis?.analysisNotes) {
				card.createDiv({
					cls: "eo-muted",
					text: `分析备注：${item.result.analysis.analysisNotes}`,
				});
			}
			if (item.result.analysis?.contactPriority.length) {
				const priority = card.createDiv({ cls: "eo-review-notes" });
				priority.createEl("strong", { text: "联系人优先级" });
				const ul = priority.createEl("ul");
				for (const contact of item.result.analysis.contactPriority) {
					ul.createEl("li", {
						text: `${contact.rank}. ${contact.contactId} — ${contact.reason}`,
					});
				}
			}
			if (item.result.errors.length > 0) {
				const box = card.createDiv({ cls: "eo-error-box" });
				for (const error of item.result.errors) {
					box.createDiv({ text: error });
				}
			}
			if (item.result.warnings.length > 0) {
				const box = card.createDiv({ cls: "eo-warning-box" });
				for (const warning of item.result.warnings) {
					box.createDiv({ text: warning });
				}
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
