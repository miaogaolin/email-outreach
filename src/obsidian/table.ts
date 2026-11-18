import { mergeColumnWidths } from "../core/column-widths";
import { selectionSummary } from "../core/selection";
import type { CustomerRecord } from "../core/types";
import { attachColumnResize } from "./column-resize";

export interface CustomerRow {
	key: string;
	name: string;
	record: CustomerRecord;
}

export interface CustomerColumn {
	id: string;
	label: string;
	width?: number;
	/** 表头 tooltip，例如解释「开发状态」两行分别是什么。 */
	title?: string;
	render: (row: CustomerRow) => string | Node | null;
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
	/** 表格即将移除时调用：断开列宽 ResizeObserver。 */
	destroy(): void;
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
	emptyText?: string;
	/** 用户保存过的列宽（按列 id）；缺省时用各列默认宽度。 */
	columnWidths?: Record<string, number> | null;
	/** 拖完列宽后落盘；不传则本次调整不保存。 */
	onColumnWidthsChange?: (widths: Record<string, number>) => void;
}

const SELECT_COLUMN_WIDTH = 40;
const CONTACTS_COLUMN_WIDTH = 76;
/** 固定列的宽度键：加前缀避免和客户属性同名。 */
export const SELECT_COLUMN_ID = "__select";
export const CONTACTS_COLUMN_ID = "__contacts";

const EMPTY_HANDLE: CustomerTableHandle = {
	updateSelection() {},
	setContactCount() {},
	isConnected: () => false,
	destroy() {},
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

	const contactsHead = headRow.createEl("th", {
		cls: "eo-col-contacts",
		text: "联系人",
	});

	const headerCells: HTMLElement[] = [selectAll, contactsHead];
	for (const column of options.columns) {
		const th = headRow.createEl("th", {
			text: column.label,
			cls: options.onSort ? "eo-sortable" : undefined,
		});
		if (column.title) th.setAttr("title", column.title);
		headerCells.push(th);
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

	// 列宽按「列 id」保存。选择列/联系人列的 id 与属性名隔离，避免撞键。
	const resizeColumns = [
		{
			id: SELECT_COLUMN_ID,
			label: "选择",
			width: SELECT_COLUMN_WIDTH,
			defaultWidth: SELECT_COLUMN_WIDTH,
		},
		{
			id: CONTACTS_COLUMN_ID,
			label: "联系人",
			width: CONTACTS_COLUMN_WIDTH,
			defaultWidth: CONTACTS_COLUMN_WIDTH,
		},
		...options.columns.map((column) => ({
			id: column.id,
			label: column.label,
			width: column.width ?? 130,
			defaultWidth: column.width ?? 130,
		})),
	];
	const mergedWidths = mergeColumnWidths(
		resizeColumns.map((column) => ({ id: column.id, width: column.width })),
		options.columnWidths,
	);

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
			const value = column.render(row);
			if (value instanceof Node) {
				td.appendChild(value);
			} else if (value !== null) {
				td.setText(value);
			}
		}
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

	// 行都建好后再接列宽：填充列需要给每一行补一个单元格。
	const resizer = attachColumnResize(table, headerCells, {
		columns: resizeColumns.map((column) => ({
			...column,
			width: mergedWidths[column.id] ?? column.width,
		})),
		onChange: (widths) => options.onColumnWidthsChange?.(widths),
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
		destroy: () => resizer.destroy(),
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
