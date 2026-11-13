import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import {
	applyFilters,
	collectPropertyKeys,
	conditionValues,
	distinctValues,
	FILTER_OP_LABELS,
	inferPropertyType,
	supportsMultipleValues,
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
	type CustomerStatus,
} from "./table";
import { renderRunBar, type RunBarHandle } from "./run-bar";
import { fillContactCounts } from "./contact-counts";
import { summarizeRunStatuses, statusLabel, statusLevel } from "../core/run-status";
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
	/** 重新渲染筛选框后保持值选择器展开。 */
	private openValuePicker: FilterCondition | null = null;
	/** 每次重绘递增；异步补联系人数量时用它丢弃过期结果。 */
	private renderToken = 0;

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

	async onClose(): Promise<void> {
		// 视图关闭后不再往已销毁的表格里补数据。
		this.renderToken++;
	}

	refresh(): void {
		this.render();
	}

	private render(): void {
		const token = ++this.renderToken;
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

		// 筛选条件变化后，已经不可见的客户不能继续留在选区里，
		// 否则用户无法取消勾选，只能删掉筛选条件。
		const selected = plugin.pruneSelection(rows.map((row) => row.key));
		this.renderRunBanner(container);
		const tableContainer = container.createDiv({ cls: "eo-table-wrap" });
		const columns = this.buildColumns(records);
		let runBar: RunBarHandle | null = null;
		const applySelection = (): void => {
			plugin.setSelected(selected);
			table.updateSelection(selected);
			runBar?.updateSelectedCount(selected.size);
		};
		const table = renderCustomerTable(tableContainer, {
			columns,
			rows,
			selected,
			onToggle: (key, checked) => {
				if (checked) selected.add(key);
				else selected.delete(key);
				applySelection();
			},
			onToggleAll: (checked) => {
				for (const row of rows) {
					if (checked) selected.add(row.key);
					else selected.delete(row.key);
				}
				applySelection();
			},
			contactCount: (row) => plugin.repo.getContactCount(row.record),
			onOpenContacts: (row) => {
				void plugin.openContacts(row.record);
			},
			status: (row) => this.statusFor(row),
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
		fillContactCounts(
			plugin.repo,
			rows,
			table,
			() => token === this.renderToken,
		);

		const footer = container.createDiv({ cls: "eo-footer" });
		const taskContainer = footer.createDiv({ cls: "eo-taskbar-container" });
		runBar = renderRunBar(taskContainer, {
			selectedCount: selected.size,
			onRun: () => {
				void plugin.runTasks(records);
			},
		});
		if (this.sortState) {
			const hint = footer.createDiv({ cls: "eo-muted eo-sort-hint" });
			hint.setText(`当前排序：${this.sortState.key} ${this.sortState.dir === 1 ? "升序" : "降序"}`);
		}
	}

	private statusFor(row: CustomerRow): CustomerStatus {
		const status = this.plugin.getCustomerDevStatus(row.record.path);
		if (status) {
			return {
				text: statusLabel(status),
				level: statusLevel(status),
				title: status.message,
			};
		}
		return {
			text: row.record.fm[this.plugin.settings.linkPropertyName] ? "✓" : "—",
		};
	}

	private renderRunBanner(container: HTMLElement): void {
		const run = this.plugin.getLastRunStatus();
		if (!run) return;
		const summary = summarizeRunStatuses(run.customers);
		if (
			summary.generatedCustomers === 0 &&
			summary.attention.length === 0
		) {
			return;
		}
		const banner = container.createDiv({ cls: "eo-run-banner" });
		const parts: string[] = [];
		if (summary.generatedCustomers > 0) {
			parts.push(
				`已生成 ${summary.generatedEmailCount} 封（${summary.generatedCustomers} 家）`,
			);
		}
		if (summary.attention.length > 0) {
			const names = summary.attention
				.slice(0, 8)
				.map((status) => `${status.customerName}（${statusLabel(status)}）`)
				.join("、");
			const more =
				summary.attention.length > 8
					? ` 等 ${summary.attention.length} 家`
					: "";
			parts.push(`未生成邮件：${names}${more}`);
		}
		banner.setText(`上次执行：${parts.join("；")}。`);
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
				const nextOp = opSelect.value as FilterOp;
				const previousValues = conditionValues(condition);
				condition.op = nextOp;
				if (supportsMultipleValues(nextOp)) {
					if (previousValues.length > 0) {
						condition.values = previousValues;
						condition.value = "";
					}
				} else if (
					nextOp === "gt" ||
					nextOp === "lt" ||
					nextOp === "between"
				) {
					condition.value = previousValues[0] ?? condition.value;
					condition.values = undefined;
				}
				void plugin.saveSettings();
				this.render();
			});

			this.renderFilterValue(row, condition, records, index);

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

	private renderFilterValue(
		row: HTMLElement,
		condition: FilterCondition,
		records: CustomerRecord[],
		index: number,
	): void {
		if (condition.op === "empty" || condition.op === "not_empty") return;
		if (supportsMultipleValues(condition.op)) {
			this.renderMultiValueFilter(row, condition, records, index);
			return;
		}
		this.renderSingleValueFilter(row, condition, records, index);
	}

	/** 文本类条件：同一个属性可以选多个值，任一命中即可。 */
	private renderMultiValueFilter(
		row: HTMLElement,
		condition: FilterCondition,
		records: CustomerRecord[],
		index: number,
	): void {
		const values = conditionValues(condition);
		const wrap = row.createDiv({ cls: "eo-filter-values" });

		if (values.length > 0) {
			const chips = wrap.createDiv({ cls: "eo-filter-chips" });
			for (const value of values) {
				const chip = chips.createSpan({ cls: "eo-filter-chip" });
				chip.createSpan({ text: value });
				chip
					.createEl("button", {
						cls: "eo-filter-chip-remove",
						text: "×",
						attr: { type: "button", "aria-label": `移除 ${value}` },
					})
					.addEventListener("click", () => {
						this.setConditionValues(
							condition,
							conditionValues(condition).filter((item) => item !== value),
						);
					});
			}
		}

		const suggestions = distinctValues(records, condition.key);
		if (suggestions.length > 0) {
			const details = wrap.createEl("details", { cls: "eo-filter-picker" });
			details.open = this.openValuePicker === condition;
			details.addEventListener("toggle", () => {
				if (details.open) this.openValuePicker = condition;
				else if (this.openValuePicker === condition) {
					this.openValuePicker = null;
				}
			});
			details.createEl("summary", {
				text:
					values.length > 0
						? `选择值（已选 ${values.length}）`
						: "选择值",
			});
			const list = details.createDiv({ cls: "eo-filter-picker-list" });
			const selected = new Set(values.map((value) => value.toLowerCase()));
			for (const suggestion of suggestions) {
				const option = list.createEl("label", { cls: "eo-filter-option" });
				const checkbox = option.createEl("input", { type: "checkbox" });
				checkbox.checked = selected.has(suggestion.toLowerCase());
				checkbox.addEventListener("change", () => {
					const next = conditionValues(condition).filter(
						(value) =>
							value.toLowerCase() !== suggestion.toLowerCase(),
					);
					if (checkbox.checked) next.push(suggestion);
					this.setConditionValues(condition, next);
				});
				option.createSpan({ text: suggestion });
			}
		}

		const listId = `eo-values-${index}`;
		const attr: Record<string, string> = {
			placeholder:
				values.length > 0
					? "继续输入值，回车添加"
					: "输入或选择值，可添加多个",
		};
		if (suggestions.length > 0) attr.list = listId;
		const input = wrap.createEl("input", { type: "text", attr });
		if (suggestions.length > 0) {
			const datalist = wrap.createEl("datalist", { attr: { id: listId } });
			for (const suggestion of suggestions) {
				datalist.createEl("option", { value: suggestion });
			}
		}
		const commit = (): void => {
			const raw = input.value.trim();
			if (!raw) return;
			const current = conditionValues(condition);
			if (current.some((value) => value.toLowerCase() === raw.toLowerCase())) {
				input.value = "";
				return;
			}
			this.setConditionValues(condition, [...current, raw]);
		};
		input.addEventListener("change", commit);
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				commit();
			}
		});
	}

	/** 数值/区间条件仍然只有一个值。 */
	private renderSingleValueFilter(
		row: HTMLElement,
		condition: FilterCondition,
		records: CustomerRecord[],
		index: number,
	): void {
		const value = conditionValues(condition)[0] ?? condition.value;
		const valueInput = row.createEl("input", {
			type: "text",
			value,
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
			condition.values = undefined;
			void this.plugin.saveSettings();
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
				void this.plugin.saveSettings();
				this.render();
			});
		}
	}

	private setConditionValues(
		condition: FilterCondition,
		values: string[],
	): void {
		condition.values = values;
		condition.value = "";
		void this.plugin.saveSettings();
		this.render();
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
