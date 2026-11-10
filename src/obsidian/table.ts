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

export interface CustomerTableOptions {
	columns: CustomerColumn[];
	rows: CustomerRow[];
	selected: Set<string>;
	onToggle: (key: string, checked: boolean) => void;
	onToggleAll: (checked: boolean) => void;
	onRowClick: (row: CustomerRow) => void;
	sort?: { columnId: string; dir: 1 | -1 } | null;
	onSort?: (columnId: string) => void;
	statusText?: (row: CustomerRow) => string;
	emptyText?: string;
}

export function renderCustomerTable(
	container: HTMLElement,
	options: CustomerTableOptions,
): void {
	container.empty();
	container.addClass("eo-table-container");

	if (options.rows.length === 0) {
		container.createDiv({
			cls: "eo-empty",
			text: options.emptyText ?? "没有符合条件的客户",
		});
		return;
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
	const selectedVisible = visibleKeys.filter((key) =>
		options.selected.has(key),
	).length;
	selectAllInput.checked =
		visibleKeys.length > 0 && selectedVisible === visibleKeys.length;
	selectAllInput.indeterminate =
		selectedVisible > 0 && selectedVisible < visibleKeys.length;
	selectAllInput.addEventListener("change", () => {
		options.onToggleAll(selectAllInput.checked);
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
	headRow.createEl("th", { cls: "eo-col-status", text: "邮件" });

	const tbody = table.createEl("tbody");
	for (const row of options.rows) {
		const tr = tbody.createEl("tr", { cls: "eo-row" });
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
		statusCell.setText(
			options.statusText
				? options.statusText(row)
				: row.record.fm["AI开发信息"]
					? "✓"
					: "—",
		);

		tr.addEventListener("click", (event) => {
			const target = event.target as HTMLElement | null;
			if (
				target?.closest("input") ||
				target?.closest("a") ||
				target?.closest("button")
			) {
				return;
			}
			options.onRowClick(row);
		});
	}
}
