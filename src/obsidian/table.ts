import { selectionSummary } from "../core/selection";
import type { CustomerRecord } from "../core/types";

export interface CustomerRow {
	key: string;
	name: string;
	record: CustomerRecord;
}

export interface CustomerColumn {
	id: string;
	label: string;
	width?: number;
	render: (row: CustomerRow) => string | Node | null;
}

export interface CustomerStatus {
	text: string;
	level?: "ok" | "warn" | "error";
	title?: string;
}

/**
 * 表格渲染完成后留下的控制器。勾选和联系人数量只更新对应的单元格，
 * 不重新构建整张表——客户多时整表重绘会让复选框明显卡顿。
 */
export interface CustomerTableHandle {
	updateSelection(selected: Set<string>): void;
	/** null 表示读取失败（显示「—」）；初始未加载时显示「…」。 */
	setContactCount(key: string, count: number | null): void;
	isConnected(): boolean;
}

export interface CustomerTableOptions {
	columns: CustomerColumn[];
	rows: CustomerRow[];
	selected: Set<string>;
	onToggle: (key: string, checked: boolean) => void;
	onToggleAll: (checked: boolean) => void;
	/** 联系人数量；null 表示还没读取完成。 */
	contactCount: (row: CustomerRow) => number | null;
	onOpenContacts: (row: CustomerRow) => void;
	sort?: { columnId: string; dir: 1 | -1 } | null;
	onSort?: (columnId: string) => void;
	status?: (row: CustomerRow) => CustomerStatus | null;
	emptyText?: string;
}

const EMPTY_HANDLE: CustomerTableHandle = {
	updateSelection() {},
	setContactCount() {},
	isConnected: () => false,
};

export function renderCustomerTable(
	container: HTMLElement,
	options: CustomerTableOptions,
): CustomerTableHandle {
	container.empty();
	container.addClass("eo-table-container");

	if (options.rows.length === 0) {
		container.createDiv({
			cls: "eo-empty",
			text: options.emptyText ?? "没有符合条件的客户",
		});
		return EMPTY_HANDLE;
	}

	const table = container.createEl("table", { cls: "eo-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");

	const selectAll = headRow.createEl("th", { cls: "eo-col-select" });
	const selectAllInput = selectAll.createEl("input", {
		type: "checkbox",
		attr: { "aria-label": "全选当前结果" },
	});
	const visibleKeys = options.rows.map((row) => row.key);

	headRow.createEl("th", {
		cls: "eo-col-contacts",
		text: "联系人",
	});

	for (const column of options.columns) {
		const th = headRow.createEl("th", {
			text: column.label,
			cls: options.onSort ? "eo-sortable" : undefined,
		});
		if (column.width) th.style.width = `${column.width}px`;
		if (options.sort?.columnId === column.id) {
			th.createSpan({
				cls: "eo-sort-indicator",
				text: options.sort.dir === 1 ? " ▲" : " ▼",
			});
		}
		if (options.onSort) {
			th.addEventListener("click", () => options.onSort?.(column.id));
		}
	}
	headRow.createEl("th", { cls: "eo-col-status", text: "开发状态" });

	const rowElements = new Map<string, HTMLTableRowElement>();
	const rowCheckboxes = new Map<string, HTMLInputElement>();
	const contactCounts = new Map<string, HTMLButtonElement>();

	const tbody = table.createEl("tbody");
	for (const row of options.rows) {
		const tr = tbody.createEl("tr", { cls: "eo-row" });
		rowElements.set(row.key, tr);
		if (options.selected.has(row.key)) tr.addClass("is-selected");

		const selectCell = tr.createEl("td", { cls: "eo-col-select" });
		const checkbox = selectCell.createEl("input", {
			type: "checkbox",
			attr: { "aria-label": `选择 ${row.name}` },
		});
		checkbox.checked = options.selected.has(row.key);
		checkbox.addEventListener("click", (event) => event.stopPropagation());
		checkbox.addEventListener("change", () => {
			options.onToggle(row.key, checkbox.checked);
		});
		rowCheckboxes.set(row.key, checkbox);

		const contactsCell = tr.createEl("td", { cls: "eo-col-contacts" });
		const countButton = contactsCell.createEl("button", {
			cls: "eo-contact-count",
			attr: {
				type: "button",
				title: "点击查看联系人",
				"aria-label": `查看 ${row.name} 的联系人`,
			},
		});
		renderContactCount(countButton, options.contactCount(row), true);
		countButton.addEventListener("click", (event) => {
			event.stopPropagation();
			options.onOpenContacts(row);
		});
		contactCounts.set(row.key, countButton);

		for (const column of options.columns) {
			const td = tr.createEl("td");
			if (column.width) td.style.width = `${column.width}px`;
			const value = column.render(row);
			if (value instanceof Node) {
				td.appendChild(value);
			} else if (value !== null) {
				td.setText(value);
			}
		}

		const statusCell = tr.createEl("td", { cls: "eo-col-status" });
		const status =
			options.status?.(row) ??
			({
				text: row.record.fm["AI开发信息"] ? "✓" : "—",
			} satisfies CustomerStatus);
		const statusSpan = statusCell.createSpan({
			cls: `eo-dev-status eo-dev-status-${status.level ?? "none"}`,
			text: status.text,
		});
		if (status.title) statusSpan.setAttr("title", status.title);
	}

	const applySelectionSummary = (): void => {
		const summary = selectionSummary(visibleKeys, options.selected);
		selectAllInput.checked = summary.checked;
		selectAllInput.indeterminate = summary.indeterminate;
	};
	applySelectionSummary();

	selectAllInput.addEventListener("change", () => {
		options.onToggleAll(selectAllInput.checked);
	});

	return {
		updateSelection(selected: Set<string>): void {
			for (const [key, checkbox] of rowCheckboxes) {
				const checked = selected.has(key);
				if (checkbox.checked !== checked) checkbox.checked = checked;
				rowElements.get(key)?.classList.toggle("is-selected", checked);
			}
			const summary = selectionSummary(visibleKeys, selected);
			selectAllInput.checked = summary.checked;
			selectAllInput.indeterminate = summary.indeterminate;
		},
		setContactCount(key: string, count: number | null): void {
			const button = contactCounts.get(key);
			if (button) renderContactCount(button, count);
		},
		isConnected: () => table.isConnected,
	};
}

function renderContactCount(
	button: HTMLButtonElement,
	count: number | null,
	loading = false,
): void {
	if (count === null) {
		button.setText(loading ? "…" : "—");
		button.classList.toggle("is-loading", loading);
		button.classList.remove("is-zero");
		if (!loading) button.setAttr("title", "联系人读取失败");
		return;
	}
	button.setText(String(count));
	button.classList.remove("is-loading");
	button.classList.toggle("is-zero", count === 0);
	if (count === 0) button.setAttr("title", "没有解析到联系人，点击查看");
	else button.setAttr("title", "点击查看联系人");
}
