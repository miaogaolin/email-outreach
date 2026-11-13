import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import { emailUpdatedAt, formatEmailTime } from "../core/ai-file";
import {
	summarizeRunStatuses,
	statusLabel,
} from "../core/run-status";
import { formatBeijingTime } from "../core/send-time";
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

		this.renderRunBanner(container);
		this.tableContainer = container.createDiv({ cls: "eo-table-wrap" });
		this.renderTable(container);
		void rows;
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
		void container;
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
