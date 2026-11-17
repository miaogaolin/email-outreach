import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import { emailUpdatedAt, formatEmailTime } from "../core/ai-file";
import {
	filterEmailRows,
	matchesCustomerFilter,
	type EmailCustomerFilter,
} from "../core/email-list";
import {
	summarizeRunStatuses,
	statusLabel,
} from "../core/run-status";
import { pruneSelection, selectionSummary } from "../core/selection";
import { formatBeijingTime } from "../core/send-time";
import type { EmailRow, EmailStatus } from "../core/types";
import { EMAIL_STATUSES } from "../core/types";
import type { OutreachPluginApi } from "./plugin-api";
import { confirm } from "./modals/confirm";
import { PreviewController } from "./preview-popover";

const STATUS_LABELS: Record<EmailStatus | "all", string> = {
	all: "全部状态",
	Generated: "待审核",
	Accepted: "已验收",
	Rejected: "已拒绝",
};

export class EmailListView extends ItemView {
	private statusFilter: EmailStatus | "all" = "all";
	private search = "";
	private customerFilter: EmailCustomerFilter | null = null;
	private showDuplicatePending = false;
	private preview = new PreviewController();

	// 批量删除：选中键只对当前可见行有意义，筛选变化后自动裁剪。
	private selected = new Set<string>();
	private busy = false;
	private deleteButton: HTMLButtonElement | null = null;
	private selectAllInput: HTMLInputElement | null = null;
	private visibleKeys: string[] = [];
	private rowElements = new Map<
		string,
		{ tr: HTMLTableRowElement; checkbox: HTMLInputElement }
	>();

	// 局部重绘用：搜索/状态变化只换计数与表格，输入框不丢焦点。
	private tableContainer: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private dedupeWrap: HTMLElement | null = null;
	private dedupeLabelEl: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: OutreachPluginApi,
	) {
		super(leaf);
	}

	getViewType(): string {
		return "email-outreach-emails";
	}

	getDisplayText(): string {
		return "开发邮件列表";
	}

	getIcon(): string {
		return "mail";
	}

	async onOpen(): Promise<void> {
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.preview.destroy();
	}

	async refresh(): Promise<void> {
		try {
			await this.plugin.emailStore.refresh();
		} catch (error) {
			console.error("[email-outreach] 刷新邮件列表失败", error);
		}
		// 刷新不清空客户筛选 / 搜索 / 状态，只重画内容。
		this.render();
	}

	/** 由工作台「开发状态」单元格调用；null 表示回到全部客户。 */
	setCustomerFilter(filter: EmailCustomerFilter | null): void {
		this.customerFilter = filter;
		this.render();
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("eo-email-list");

		const header = container.createDiv({ cls: "eo-header" });
		header.createEl("h2", { text: "开发邮件列表" });
		const actions = header.createDiv({ cls: "eo-header-actions" });

		const searchInput = actions.createEl("input", {
			type: "search",
			attr: { placeholder: "搜索客户 / 联系人 / 邮箱 / 摘要" },
			value: this.search,
		});
		searchInput.addEventListener("input", () => {
			this.search = searchInput.value;
			this.renderBody();
		});

		const statusSelect = actions.createEl("select");
		for (const status of ["all", ...EMAIL_STATUSES] as const) {
			statusSelect.createEl("option", {
				value: status,
				text: STATUS_LABELS[status],
			});
		}
		statusSelect.value = this.statusFilter;
		statusSelect.addEventListener("change", () => {
			this.statusFilter = statusSelect.value as EmailStatus | "all";
			this.renderBody();
		});

		const dedupeWrap = actions.createEl("label", {
			cls: "eo-filter-excluded eo-dedupe-toggle",
		});
		const dedupeInput = dedupeWrap.createEl("input", { type: "checkbox" });
		dedupeInput.checked = this.showDuplicatePending;
		dedupeInput.addEventListener("change", () => {
			this.showDuplicatePending = dedupeInput.checked;
			this.renderBody();
		});
		this.dedupeLabelEl = dedupeWrap.createSpan({ text: "显示重复待审" });
		this.dedupeWrap = dedupeWrap;
		dedupeWrap.style.display = "none";

		this.deleteButton = actions.createEl("button", {
			text: "删除选中",
			cls: "mod-warning eo-delete-emails",
		});
		this.deleteButton.disabled = true;
		this.deleteButton.setAttr(
			"title",
			"永久删除勾选的邮件（含修改历史和发送提醒）",
		);
		this.deleteButton.addEventListener("click", () => {
			void this.deleteSelected();
		});

		actions
			.createEl("button", { text: "刷新" })
			.addEventListener("click", () => void this.refresh());
		actions
			.createEl("button", { text: "客户工作台" })
			.addEventListener("click", () => this.plugin.openWorkbench());

		if (this.customerFilter) {
			const chipRow = container.createDiv({ cls: "eo-filter-row eo-customer-filter" });
			chipRow.createSpan({ text: `客户：${this.customerFilter.name}` });
			chipRow
				.createEl("button", {
					text: "×",
					attr: { type: "button", "aria-label": "清除客户筛选" },
				})
				.addEventListener("click", () => this.setCustomerFilter(null));
		}

		this.renderRunBanner(container);
		this.countEl = container.createDiv({ cls: "eo-muted eo-list-count" });
		this.tableContainer = container.createDiv({ cls: "eo-table-wrap" });
		this.renderBody();
	}

	private renderRunBanner(container: HTMLElement): void {
		const run = this.plugin.getLastRunStatus();
		if (!run) return;
		const summary = summarizeRunStatuses(run.customers);
		if (summary.attention.length === 0) return;
		const banner = container.createDiv({ cls: "eo-run-banner" });
		const names = summary.attention
			.slice(0, 5)
			.map((status) => `${status.customerName}（${statusLabel(status)}）`)
			.join("、");
		const more =
			summary.attention.length > 5
				? ` 等 ${summary.attention.length} 家`
				: "";
		banner.setText(
			`上次执行有 ${summary.attention.length} 家客户没有生成邮件：${names}${more}。可回到客户工作台查看「开发状态」列。`,
		);
		const button = banner.createEl("button", { text: "客户工作台" });
		button.addEventListener("click", () => this.plugin.openWorkbench());
	}

	private renderBody(): void {
		this.preview.hide();
		const target = this.tableContainer;
		if (!target) return;
		target.empty();
		this.rowElements = new Map();
		this.selectAllInput = null;

		const result = filterEmailRows(this.plugin.emailStore.getRows(), {
			status: this.statusFilter,
			search: this.search,
			customer: this.customerFilter,
			showDuplicatePending: this.showDuplicatePending,
		});
		const rows = result.visible;
		this.visibleKeys = rows.map((row) => row.key);
		// 筛选/刷新后只保留仍然可见的勾选，避免删除看不见的邮件。
		this.selected = pruneSelection(this.selected, this.visibleKeys);

		const countParts = [`共 ${rows.length} 封邮件`];
		if (this.customerFilter) countParts.push(`客户：${this.customerFilter.name}`);
		if (result.hiddenDuplicateCount > 0) {
			countParts.push(
				this.showDuplicatePending
					? `已显示 ${result.hiddenDuplicateCount} 封旧待审`
					: `已隐藏 ${result.hiddenDuplicateCount} 封同邮箱旧待审`,
			);
		}
		this.countEl?.setText(countParts.join(" · "));

		if (this.dedupeWrap && this.dedupeLabelEl) {
			const relevant =
				result.hiddenDuplicateCount > 0 || this.showDuplicatePending;
			this.dedupeWrap.style.display = relevant ? "" : "none";
			this.dedupeLabelEl.setText(
				result.hiddenDuplicateCount > 0
					? `显示重复待审（${result.hiddenDuplicateCount}）`
					: "显示重复待审",
			);
		}

		if (rows.length === 0) {
			this.renderEmptyState(target, result.hiddenDuplicateCount);
			this.syncSelectionUi();
			return;
		}

		const table = target.createEl("table", { cls: "eo-table eo-email-table" });
		const head = table.createEl("thead").createEl("tr");
		const selectTh = head.createEl("th", { cls: "eo-col-select" });
		this.selectAllInput = selectTh.createEl("input", {
			type: "checkbox",
			attr: { "aria-label": "全选当前邮件" },
		});
		this.selectAllInput.addEventListener("change", () => {
			if (this.selectAllInput?.checked) {
				for (const key of this.visibleKeys) this.selected.add(key);
			} else {
				this.selected.clear();
			}
			this.syncSelectionUi();
		});
		for (const label of [
			"客户",
			"联系人",
			"邮箱",
			"中文摘要",
			"建议发送时间（北京）",
			"状态",
			"更新时间",
			"版本",
		]) {
			head.createEl("th", { text: label });
		}

		const body = table.createEl("tbody");
		for (const row of rows) {
			const tr = body.createEl("tr", { cls: "eo-row" });
			tr.addEventListener("click", () => {
				this.plugin.openEmailDetail(row.key);
			});
			if (this.selected.has(row.key)) tr.addClass("is-selected");

			const selectCell = tr.createEl("td", { cls: "eo-col-select" });
			selectCell.addEventListener("click", (event) => event.stopPropagation());
			const checkbox = selectCell.createEl("input", {
				type: "checkbox",
				attr: {
					"aria-label": `选择 ${row.customerName} 的邮件 ${row.record.id}`,
				},
			});
			checkbox.checked = this.selected.has(row.key);
			checkbox.addEventListener("click", (event) => event.stopPropagation());
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) this.selected.add(row.key);
				else this.selected.delete(row.key);
				this.syncSelectionUi();
			});
			this.rowElements.set(row.key, { tr, checkbox });

			const customerCell = tr.createEl("td");
			if (row.customerLink) {
				const link = customerCell.createEl("a", {
					cls: "internal-link",
					text: row.customerName || row.customerLink,
					attr: { href: "#", "data-href": row.customerLink },
				});
				link.setAttr("title", `打开客户：${row.customerLink}`);
				link.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.openCustomer(row);
				});
			} else {
				customerCell.setText(row.customerName || "（未关联客户）");
			}

			tr.createEl("td", { text: row.record.contact });
			tr.createEl("td", { text: row.record.email });

			const summaryCell = tr.createEl("td", { cls: "eo-summary-cell" });
			summaryCell.setText(row.record.summaryZh || "（无摘要）");
			const beijingTime = formatBeijingTime(
				row.record.suggestedTime,
				row.record.timezone,
			);
			const timeTitle = [
				row.record.suggestedTime
					? `客户当地时间 ${row.record.suggestedTime}${row.record.timezone ? ` · ${row.record.timezone}` : ""}`
					: "",
				row.record.timeReason ?? "",
			]
				.filter(Boolean)
				.join("\n");
			this.preview.attach(summaryCell, (popover) => {
				popover.createEl("div", {
					cls: "eo-preview-subject",
					text: row.record.subject,
				});
				const meta = popover.createDiv({ cls: "eo-preview-meta" });
				meta.setText(
					`${row.record.languageLabel || row.record.language} · ${
						beijingTime ? `北京时间 ${beijingTime}` : "未建议时间"
					}`,
				);
				if (timeTitle) meta.setAttr("title", timeTitle);
				const excerpt = popover.createEl("pre", { cls: "eo-preview-body" });
				excerpt.setText(
					row.record.body.length > 500
						? `${row.record.body.slice(0, 500)}…`
						: row.record.body,
				);
			});

			const timeCell = tr.createEl("td", {
				text: beijingTime ? `北京时间 ${beijingTime}` : "—",
			});
			if (timeTitle) timeCell.setAttr("title", timeTitle);
			const statusCell = tr.createEl("td");
			statusCell.createSpan({
				cls: `eo-status eo-status-${row.record.status.toLowerCase()}`,
				text: STATUS_LABELS[row.record.status],
			});
			const updatedAt = emailUpdatedAt(row.record);
			const updatedCell = tr.createEl("td", {
				cls: "eo-updated-cell",
				text: updatedAt ? formatEmailTime(updatedAt) : "—",
			});
			if (updatedAt) updatedCell.setAttr("title", updatedAt);
			tr.createEl("td", { text: String(row.record.versions.length) });
		}
		this.syncSelectionUi();
	}

	/** 同步全选框、行选中样式与删除按钮；勾选时只更新界面，不整表重绘。 */
	private syncSelectionUi(): void {
		const summary = selectionSummary(this.visibleKeys, this.selected);
		if (this.selectAllInput) {
			this.selectAllInput.checked = summary.checked;
			this.selectAllInput.indeterminate = summary.indeterminate;
		}
		for (const [key, element] of this.rowElements) {
			const checked = this.selected.has(key);
			if (element.checkbox.checked !== checked) {
				element.checkbox.checked = checked;
			}
			element.tr.classList.toggle("is-selected", checked);
		}
		if (!this.deleteButton) return;
		const count = this.selected.size;
		this.deleteButton.disabled = this.busy || count === 0;
		this.deleteButton.setText(
			count > 0 ? `删除选中（${count}）` : "删除选中",
		);
	}

	private async deleteSelected(): Promise<void> {
		if (this.busy) return;
		if (this.plugin.isRunning()) {
			new Notice("生成任务正在运行，完成后再删除邮件。");
			return;
		}
		const rows = this.plugin.emailStore
			.getRows()
			.filter((row) => this.selected.has(row.key));
		if (rows.length === 0) {
			this.syncSelectionUi();
			return;
		}

		const fileCount = new Set(rows.map((row) => row.filePath)).size;
		const acceptedCount = rows.filter(
			(row) => row.record.status === "Accepted",
		).length;

		this.busy = true;
		this.syncSelectionUi();
		try {
			const confirmed = await confirm(this.app, {
				title: "删除开发邮件",
				confirmText: "永久删除",
				cancelText: "取消",
				danger: true,
				build: (container) => {
					container.createEl("p", {
						text: `将从 ${fileCount} 个 AI 开发信息文件中永久删除 ${rows.length} 封邮件。`,
					});
					container.createEl("p", {
						text: "每封邮件的修改历史和对应的发送提醒会一起删除，列表里的这些行也会消失。此操作不能撤销，只能从 Git 历史或备份恢复。",
					});
					if (acceptedCount > 0) {
						container.createEl("p", {
							cls: "eo-warning-box",
							text: `其中 ${acceptedCount} 封已验收，发送提醒会被一并移除。`,
						});
					}
					const list = container.createEl("ul");
					for (const row of rows.slice(0, 5)) {
						list.createEl("li", {
							text: `${row.customerName} · 邮件 ${row.record.id} · ${
								row.record.contact || row.record.email || "（无联系人）"
							}`,
						});
					}
					if (rows.length > 5) {
						container.createEl("p", {
							cls: "eo-muted",
							text: `等 ${rows.length} 封`,
						});
					}
				},
			});
			if (!confirmed) return;
			await this.plugin.deleteEmails(rows);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : String(error));
			await this.refresh();
		} finally {
			this.busy = false;
			this.syncSelectionUi();
		}
	}

	private renderEmptyState(target: HTMLElement, hiddenCount: number): void {
		const empty = target.createDiv({ cls: "eo-empty" });
		const addButton = (label: string, handler: () => void): void => {
			const button = empty.createEl("button", { text: label });
			button.addEventListener("click", handler);
		};

		if (this.customerFilter) {
			const allForCustomer = this.plugin.emailStore
				.getRows()
				.filter((row) => matchesCustomerFilter(row, this.customerFilter));
			if (allForCustomer.length === 0) {
				empty.setText("这个客户还没有开发邮件");
				addButton("清除客户筛选", () => this.setCustomerFilter(null));
				return;
			}
			if (allForCustomer.every((row) => row.record.status === "Rejected")) {
				empty.setText("这个客户只有已拒绝的邮件");
				if (this.statusFilter === "Rejected") {
					addButton("清除客户筛选", () => this.setCustomerFilter(null));
				} else {
					addButton("查看已拒绝", () => {
						this.statusFilter = "Rejected";
						this.render();
					});
				}
				return;
			}
			if (hiddenCount > 0) {
				empty.setText(
					`有 ${hiddenCount} 封旧待审被合并（同一邮箱只显示最新的待审）`,
				);
				addButton("显示重复待审", () => {
					this.showDuplicatePending = true;
					this.render();
				});
				return;
			}
			empty.setText("这个客户在当前搜索/状态筛选下没有邮件");
			addButton("清除客户筛选", () => this.setCustomerFilter(null));
			return;
		}

		if (hiddenCount > 0) {
			empty.setText(`有 ${hiddenCount} 封旧待审被合并（同一邮箱只显示最新的待审）`);
			addButton("显示重复待审", () => {
				this.showDuplicatePending = true;
				this.render();
			});
			return;
		}
		empty.setText(
			"还没有生成邮件。先在客户工作台勾选客户并执行「生成开发邮件」。",
		);
	}

	/** 客户列是双链：点开客户笔记，而不是进入邮件详情。 */
	private openCustomer(row: EmailRow): void {
		const target = this.app.metadataCache.getFirstLinkpathDest(
			row.customerLink,
			row.filePath,
		);
		if (!target) {
			new Notice(`找不到客户文件：${row.customerName || row.customerLink}`);
			return;
		}
		void this.plugin.openFile(target.path);
	}
}
