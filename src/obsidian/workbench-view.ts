import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import {
	applyFilters,
	collectPropertyKeys,
	distinctValues,
	FILTER_OP_LABELS,
	inferPropertyType,
	type FilterCondition,
	type FilterOp,
} from "../core/filters";
import type { CustomerRecord } from "../core/types";
import type { ColumnPreference } from "./settings";
import type { OutreachPluginApi } from "./plugin-api";
import {
	renderCustomerTable,
	type CustomerColumn,
	type CustomerRow,
} from "./table";
import { renderTaskBar } from "./task-bar";
import { ColumnsModal } from "./modals/columns";

const DEFAULT_COLUMNS = [
	"客户类型",
	"地区",
	"fit",
	"indent",
	"potential",
	"risk",
	"跟进次数",
	"最近联系时间",
];

function formatCell(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
	return String(value);
}

function compareValues(a: unknown, b: unknown): number {
	if (typeof a === "number" && typeof b === "number") return a - b;
	const left = formatCell(a);
	const right = formatCell(b);
	const leftNumber = Number(left);
	const rightNumber = Number(right);
	const bothNumeric =
		left.trim() !== "" &&
		right.trim() !== "" &&
		Number.isFinite(leftNumber) &&
		Number.isFinite(rightNumber);
	if (bothNumeric) return leftNumber - rightNumber;
	return left.localeCompare(right, "zh-CN");
}

export class WorkbenchView extends ItemView {
	private appRef: App;
	private plugin: OutreachPluginApi;
	private sortState: { key: string; dir: 1 | -1 } | null;

	constructor(leaf: WorkspaceLeaf, plugin: OutreachPluginApi) {
		super(leaf);
		this.plugin = plugin;
		this.appRef = plugin.app;
		this.sortState = plugin.settings.builtinSort;
	}

	getViewType(): string {
		return "email-outreach-workbench";
	}

	getDisplayText(): string {
		return "客户开发工作台";
	}

	getIcon(): string {
		return "users";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	refresh(): void {
		this.render();
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("eo-workbench");

		const plugin = this.plugin;
		const records = plugin.repo.list();

		const header = container.createDiv({ cls: "eo-header" });
		header.createEl("h2", { text: "客户开发工作台" });
		const headerActions = header.createDiv({ cls: "eo-header-actions" });
		const addButton = (label: string, handler: () => void): void => {
			headerActions
				.createEl("button", { text: label })
				.addEventListener("click", handler);
		};
		addButton("刷新", () => {
			plugin.repo.invalidate();
			this.render();
		});
		addButton("显示哪些属性", () => {
			void this.openColumnsModal(records);
		});
		addButton("邮件列表", () => plugin.openEmailList());
		addButton("生成示例 Base", () => plugin.openBaseStarter());

		const filterBox = container.createDiv({ cls: "eo-filter-box" });
		this.renderFilters(filterBox, records);

		const { included } = applyFilters(
			records,
			plugin.settings.builtinFilters,
			{
				tags: plugin.settings.excludeTags,
				progressPrefixes: plugin.settings.excludeProgressPrefixes,
			},
		);
		const rows: CustomerRow[] = this.sortRows(
			included.map((record) => ({
				key: record.path,
				name: record.name,
				record,
			})),
		);

		const selected = plugin.getSelected();
		const tableContainer = container.createDiv({ cls: "eo-table-wrap" });
		const columns = this.buildColumns(records);
		renderCustomerTable(tableContainer, {
			columns,
			rows,
			selected,
			onToggle: (key, checked) => {
				if (checked) selected.add(key);
				else selected.delete(key);
				plugin.setSelected(selected);
				this.render();
			},
			onToggleAll: (checked) => {
				for (const row of rows) {
					if (checked) selected.add(row.key);
					else selected.delete(row.key);
				}
				plugin.setSelected(selected);
				this.render();
			},
			onRowClick: (row) => {
				void plugin.openContacts(row.record);
			},
			statusText: (row) =>
				row.record.fm[plugin.settings.linkPropertyName] ? "✓" : "—",
			sort: this.sortState
				? { columnId: this.sortState.key, dir: this.sortState.dir }
				: null,
			onSort: (key) => {
				const current = this.sortState;
				const next =
					current && current.key === key
						? { key, dir: (current.dir === 1 ? -1 : 1) as 1 | -1 }
						: { key, dir: 1 as 1 | -1 };
				this.sortState = next;
				plugin.settings.builtinSort = next;
				void plugin.saveSettings();
				this.render();
			},
			emptyText:
				records.length === 0
					? "客户目录为空：请先在插件设置里指定客户目录"
					: "没有符合筛选条件的客户",
		});

		const footer = container.createDiv({ cls: "eo-footer" });
		const taskContainer = footer.createDiv({ cls: "eo-taskbar-container" });
		const selectedAll = plugin.getSelected();
		renderTaskBar(taskContainer, {
			tasks: plugin.getTaskSelection(),
			selectedCount: selectedAll.size,
			onChange: (tasks) => {
				plugin.setTaskSelection(tasks);
				this.render();
			},
			onRun: () => {
				void plugin.runTasks(records, plugin.getTaskSelection());
			},
		});
		if (this.sortState) {
			const hint = footer.createDiv({ cls: "eo-muted eo-sort-hint" });
			hint.setText(`当前排序：${this.sortState.key} ${this.sortState.dir === 1 ? "升序" : "降序"}`);
		}
	}

	private sortRows(rows: CustomerRow[]): CustomerRow[] {
		const sort = this.sortState;
		if (!sort) return rows;
		const sorted = [...rows];
		sorted.sort((a, b) => {
			if (sort.key === "name") {
				return a.name.localeCompare(b.name, "zh-CN") * sort.dir;
			}
			return (
				compareValues(a.record.fm[sort.key], b.record.fm[sort.key]) * sort.dir
			);
		});
		return sorted;
	}

	private buildColumns(records: CustomerRecord[]): CustomerColumn[] {
		const preferences = this.plugin.settings.builtinColumns;
		const keys = preferences
			? preferences.filter((item) => item.visible).map((item) => item.key)
			: DEFAULT_COLUMNS.filter((key) =>
					records.some((record) => record.fm[key] !== undefined),
				);
		const columns: CustomerColumn[] = [
			{
				id: "name",
				label: "客户",
				width: 220,
				render: (row) => {
					const link = document.createElement("a");
					link.textContent = row.name;
					link.className = "internal-link";
					link.href = "#";
					link.addEventListener("click", (event) => {
						event.preventDefault();
						event.stopPropagation();
						void this.plugin.openFile(row.record.path);
					});
					return link;
				},
			},
		];
		for (const key of keys) {
			if (key === "name") continue;
			columns.push({
				id: key,
				label: key,
				width: inferPropertyType(records, key) === "number" ? 70 : 130,
				render: (row) => formatCell(row.record.fm[key]),
			});
		}
		return columns;
	}

	private renderFilters(
		box: HTMLElement,
		records: CustomerRecord[],
	): void {
		const plugin = this.plugin;
		const config = plugin.settings.builtinFilters;
		const keys = collectPropertyKeys(records);

		const head = box.createDiv({ cls: "eo-filter-head" });
		head.createSpan({ text: "筛选条件" });
		const presets = head.createDiv({ cls: "eo-filter-presets" });
		const addPreset = (label: string, condition: FilterCondition | null): void => {
			presets
				.createEl("button", { text: label })
				.addEventListener("click", () => {
					config.conditions = condition ? [condition] : [];
					void plugin.saveSettings();
					this.render();
				});
		};
		addPreset("五星", { key: "tags", op: "contains", value: "五星" });
		addPreset("开发触达", { key: "tags", op: "contains", value: "开发触达" });
		addPreset("fit ≥ 8", { key: "fit", op: "gt", value: "7.5" });
		addPreset("待开发", { key: "进度", op: "contains", value: "1.待开发" });
		addPreset("清空", null);

		const showExcludedLabel = head.createEl("label", {
			cls: "eo-filter-excluded",
		});
		const showExcluded = showExcludedLabel.createEl("input", {
			type: "checkbox",
		});
		showExcluded.checked = config.showExcluded;
		showExcluded.addEventListener("change", () => {
			config.showExcluded = showExcluded.checked;
			void plugin.saveSettings();
			this.render();
		});
		showExcludedLabel.createSpan({ text: "显示已排除（公海/共享等）" });

		const conditionsEl = box.createDiv({ cls: "eo-filter-conditions" });
		config.conditions.forEach((condition, index) => {
			const row = conditionsEl.createDiv({ cls: "eo-filter-row" });
			const keySelect = row.createEl("select");
			keySelect.createEl("option", { value: "", text: "选择属性" });
			for (const key of keys) {
				keySelect.createEl("option", { value: key, text: key });
			}
			keySelect.value = condition.key;
			keySelect.addEventListener("change", () => {
				condition.key = keySelect.value;
				void plugin.saveSettings();
				this.render();
			});

			const opSelect = row.createEl("select");
			for (const [op, label] of Object.entries(FILTER_OP_LABELS)) {
				opSelect.createEl("option", { value: op, text: label });
			}
			opSelect.value = condition.op;
			opSelect.addEventListener("change", () => {
				condition.op = opSelect.value as FilterOp;
				void plugin.saveSettings();
				this.render();
			});

			const valueInput = row.createEl("input", {
				type: "text",
				value: condition.value,
				attr: { placeholder: "值" },
			});
			const suggestions = distinctValues(records, condition.key);
			if (suggestions.length > 0) {
				const listId = `eo-values-${index}`;
				valueInput.setAttr("list", listId);
				const datalist = row.createEl("datalist", { attr: { id: listId } });
				for (const suggestion of suggestions) {
					datalist.createEl("option", { value: suggestion });
				}
			}
			valueInput.addEventListener("change", () => {
				condition.value = valueInput.value;
				void plugin.saveSettings();
				this.render();
			});

			if (condition.op === "between") {
				const second = row.createEl("input", {
					type: "text",
					value: condition.value2 ?? "",
					attr: { placeholder: "上限" },
				});
				second.addEventListener("change", () => {
					condition.value2 = second.value;
					void plugin.saveSettings();
					this.render();
				});
			}

			row
				.createEl("button", { text: "×" })
				.addEventListener("click", () => {
					config.conditions.splice(index, 1);
					void plugin.saveSettings();
					this.render();
				});
		});

		box.createEl("button", { text: "+ 添加条件" }).addEventListener(
			"click",
			() => {
				config.conditions.push({ key: "", op: "eq", value: "" });
				void plugin.saveSettings();
				this.render();
			},
		);
	}

	private async openColumnsModal(records: CustomerRecord[]): Promise<void> {
		const keys = collectPropertyKeys(records);
		const prefs: ColumnPreference[] =
			this.plugin.settings.builtinColumns ?? [];
		const modal = new ColumnsModal(this.appRef, keys, prefs);
		const result = await modal.openAndWait();
		if (result === null) return;
		this.plugin.settings.builtinColumns = result.length > 0 ? result : null;
		await this.plugin.saveSettings();
		this.render();
	}
}
