import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { EmailRow, EmailStatus } from "../core/types";
import { EMAIL_STATUSES } from "../core/types";
import type { OutreachPluginApi } from "./plugin-api";
import { PreviewController } from "./preview-popover";

const STATUS_LABELS: Record<EmailStatus | "all", string> = {
	all: "全部状态",
	Generated: "待审核",
	Revision: "已修改，待审核",
	Accepted: "已验收",
	Rejected: "已拒绝",
};

export class EmailListView extends ItemView {
	private statusFilter: EmailStatus | "all" = "all";
	private search = "";
	private preview = new PreviewController();

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
		this.render();
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("eo-email-list");

		const rows = this.plugin.emailStore.getRows();
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
			this.renderTable(container);
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
			this.renderTable(container);
		});

		actions
			.createEl("button", { text: "刷新" })
			.addEventListener("click", () => void this.refresh());
		actions
			.createEl("button", { text: "客户工作台" })
			.addEventListener("click", () => this.plugin.openWorkbench());

		this.tableContainer = container.createDiv({ cls: "eo-table-wrap" });
		this.renderTable(container);
		void rows;
	}

	private tableContainer: HTMLElement | null = null;

	private filteredRows(): EmailRow[] {
		const rows = this.plugin.emailStore.getRows();
		const search = this.search.trim().toLowerCase();
		return rows.filter((row) => {
			if (this.statusFilter === "all") {
				if (row.record.status === "Rejected") return false;
			} else if (row.record.status !== this.statusFilter) {
				return false;
			}
			if (!search) return true;
			const haystack = [
				row.customerName,
				row.record.contact,
				row.record.email,
				row.record.summaryZh,
				row.record.subject,
			]
				.join(" ")
				.toLowerCase();
			return haystack.includes(search);
		});
	}

	private renderTable(container: HTMLElement): void {
		this.preview.hide();
		const target = this.tableContainer;
		if (!target) return;
		target.empty();
		const rows = this.filteredRows();
		const count = target.createDiv({ cls: "eo-muted eo-list-count" });
		count.setText(`共 ${rows.length} 封邮件`);

		if (rows.length === 0) {
			target.createDiv({
				cls: "eo-empty",
				text: "还没有生成邮件。先在客户工作台勾选客户并执行「生成开发邮件」。",
			});
			return;
		}

		const table = target.createEl("table", { cls: "eo-table eo-email-table" });
		const head = table.createEl("thead").createEl("tr");
		for (const label of [
			"客户",
			"联系人",
			"邮箱",
			"中文摘要",
			"建议发送时间",
			"状态",
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
			tr.createEl("td", { text: row.customerName });
			tr.createEl("td", { text: row.record.contact });
			tr.createEl("td", { text: row.record.email });

			const summaryCell = tr.createEl("td", { cls: "eo-summary-cell" });
			summaryCell.setText(row.record.summaryZh || "（无摘要）");
			this.preview.attach(summaryCell, (popover) => {
				popover.createEl("div", {
					cls: "eo-preview-subject",
					text: row.record.subject,
				});
				const meta = popover.createDiv({ cls: "eo-preview-meta" });
				meta.setText(
					`${row.record.languageLabel || row.record.language} · ${
						row.record.suggestedTime
							? `${row.record.suggestedTime}${row.record.timezone ? ` ${row.record.timezone}` : ""}`
							: "未建议时间"
					}`,
				);
				const excerpt = popover.createEl("pre", { cls: "eo-preview-body" });
				excerpt.setText(
					row.record.body.length > 500
						? `${row.record.body.slice(0, 500)}…`
						: row.record.body,
				);
			});

			tr.createEl("td", {
				text: row.record.suggestedTime
					? `${row.record.suggestedTime}${row.record.timezone ? ` · ${row.record.timezone}` : ""}`
					: "—",
			});
			const statusCell = tr.createEl("td");
			statusCell.createSpan({
				cls: `eo-status eo-status-${row.record.status.toLowerCase()}`,
				text: STATUS_LABELS[row.record.status],
			});
			tr.createEl("td", { text: String(row.record.versions.length) });
		}
		void container;
	}
}
