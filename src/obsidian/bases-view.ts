import type { App, TFile } from "obsidian";
import { isExcluded } from "../core/filters";
import type { CustomerRecord } from "../core/types";
import type { OutreachPluginApi } from "./plugin-api";
import { renderTaskBar } from "./task-bar";
import {
	renderCustomerTable,
	type CustomerColumn,
	type CustomerRow,
} from "./table";

export const BASES_VIEW_TYPE = "email-outreach-customers";
export const BASES_VIEW_NAME = "Email Outreach 客户工作台";

interface BasesEntryLike {
	file: TFile;
	getPropertyKeys(): string[];
	getRawProperty(key: string): unknown;
}

interface BasesConfigLike {
	getOrder(): string[];
	getSort(): { property?: string; direction?: string }[];
	getDisplayName(propertyId: string): string;
	getLimit(): number;
}

export interface BasesViewLike {
	app: App;
	data: { data: BasesEntryLike[] };
	config: BasesConfigLike;
}

function readRecord(entry: BasesEntryLike): CustomerRecord {
	const fm: Record<string, unknown> = {};
	const tags: string[] = [];
	for (const key of entry.getPropertyKeys()) {
		if (key === "file" || key === "this" || key === "note" || key === "formula") {
			continue;
		}
		const value = entry.getRawProperty(key);
		fm[key] = value;
		if (key === "tags") {
			const list = Array.isArray(value) ? value : [value];
			for (const item of list) {
				if (item === undefined || item === null) continue;
				tags.push(String(item).replace(/^#/, ""));
			}
		}
	}
	return {
		path: entry.file.path,
		name: entry.file.basename,
		fm,
		tags,
		mtime: entry.file.stat?.mtime ?? 0,
	};
}

function propertyCell(
	view: BasesViewLike,
	entry: BasesEntryLike,
	propertyId: string,
): Node | string {
	const host = document.createElement("span");
	try {
		const value = (entry as unknown as {
			getValue(id: string): {
				renderTo?(el: HTMLElement, context: unknown): void;
				toString(): string;
			} | null;
		}).getValue(propertyId);
		if (!value) return "";
		const context = (view.app as unknown as { renderContext?: unknown })
			.renderContext;
		if (typeof value.renderTo === "function" && context) {
			value.renderTo(host, context);
			return host;
		}
		return value.toString();
	} catch {
		return "";
	}
}

function renderBasesRoot(
	root: HTMLElement,
	view: BasesViewLike,
	plugin: OutreachPluginApi,
): void {
	root.empty();
	root.addClass("eo-bases-root");

	const entries = Array.isArray(view.data?.data) ? view.data.data : [];
	const allRows = entries.map((entry) => ({
		entry,
		record: readRecord(entry),
	}));

	const header = root.createDiv({ cls: "eo-header" });
	header.createEl("h2", { text: "客户开发工作台（Bases）" });
	const actions = header.createDiv({ cls: "eo-header-actions" });

	const searchInput = actions.createEl("input", {
		type: "search",
		attr: { placeholder: "按客户名筛选" },
	});
	const excludeLabel = actions.createEl("label", { cls: "eo-filter-excluded" });
	const excludeToggle = excludeLabel.createEl("input", { type: "checkbox" });
	excludeToggle.checked = true;
	excludeLabel.createSpan({ text: "排除公海/共享" });
	actions
		.createEl("button", { text: "邮件列表" })
		.addEventListener("click", () => plugin.openEmailList());
	actions
		.createEl("button", { text: "内置工作台" })
		.addEventListener("click", () => plugin.openWorkbench());

	let showExcluded = false;
	const drawTable = (): void => {
		const search = searchInput.value.trim().toLowerCase();
		const rules = {
			tags: plugin.settings.excludeTags,
			progressPrefixes: plugin.settings.excludeProgressPrefixes,
		};
		let excludedCount = 0;
		const filtered = allRows.filter(({ record }) => {
			if (search && !record.name.toLowerCase().includes(search)) return false;
			if (excludeToggle.checked && !showExcluded) {
				if (isExcluded(record, rules)) {
					excludedCount++;
					return false;
				}
			}
			return true;
		});
		void showExcluded;

		const rows: CustomerRow[] = filtered.map(({ record }) => ({
			key: record.path,
			name: record.name,
			record,
		}));

		const order = view.config?.getOrder?.() ?? [];
		const propertyColumns = order.filter((propertyId) => propertyId !== "file.name");
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
						void plugin.openFile(row.record.path);
					});
					return link;
				},
			},
		];
		for (const propertyId of propertyColumns) {
			const entryFor = new Map(
				filtered.map(({ entry, record }) => [record.path, entry]),
			);
			columns.push({
				id: propertyId,
				label: view.config.getDisplayName(propertyId) || propertyId,
				width: 120,
				render: (row) => {
					const entry = entryFor.get(row.record.path);
					return entry ? propertyCell(view, entry, propertyId) : "";
				},
			});
		}

		if (propertyColumns.length === 0) {
			const hint = root.createDiv({ cls: "eo-muted eo-bases-hint" });
			hint.setText(
				"还没有选择属性列：在 Base 工具栏的「属性」菜单里勾选要显示的字段。",
			);
		}

		const tableContainer = root.createDiv({ cls: "eo-table-wrap" });
		const selected = plugin.getSelected();
		renderCustomerTable(tableContainer, {
			columns,
			rows,
			selected,
			onToggle: (key, checked) => {
				if (checked) selected.add(key);
				else selected.delete(key);
				plugin.setSelected(selected);
			},
			onToggleAll: (checked) => {
				for (const row of rows) {
					if (checked) selected.add(row.key);
					else selected.delete(row.key);
				}
				plugin.setSelected(selected);
			},
			onRowClick: (row) => void plugin.openContacts(row.record),
			statusText: (row) =>
				row.record.fm[plugin.settings.linkPropertyName] ? "✓" : "—",
			emptyText:
				entries.length === 0
					? "当前 Base 没有匹配的客户。请在 Base 里调整筛选条件。"
					: "没有符合当前搜索/排除条件的客户",
		});

		const info = root.createDiv({ cls: "eo-muted eo-bases-info" });
		const sort = view.config?.getSort?.() ?? [];
		const sortText =
			sort.length > 0
				? sort
						.map(
							(item) =>
								`${item.property ?? "?"} ${item.direction === "DESC" ? "降序" : "升序"}`,
						)
						.join("，")
				: "未设置排序";
		info.setText(
			`共 ${rows.length} 家 · 已排除 ${excludedCount} 家 · 排序：${sortText}（由 Base 控制）`,
		);

		const footer = root.createDiv({ cls: "eo-footer" });
		const taskContainer = footer.createDiv({ cls: "eo-taskbar-container" });
		renderTaskBar(taskContainer, {
			tasks: plugin.getTaskSelection(),
			selectedCount: selected.size,
			onChange: (tasks) => {
				plugin.setTaskSelection(tasks);
				renderBasesRoot(root, view, plugin);
			},
			onRun: () => {
				const chosen = selected.size
					? allRows
							.filter(({ record }) => selected.has(record.path))
							.map(({ record }) => record)
					: [];
				void plugin.runTasks(chosen, plugin.getTaskSelection());
			},
		});
		void excludedCount;
	};

	searchInput.addEventListener("input", drawTable);
	excludeToggle.addEventListener("change", drawTable);
	drawTable();
}

export interface BasesRegistrar {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	registerBasesView?: (id: string, registration: any) => boolean;
}

/**
 * Register the custom Bases view if the running Obsidian exposes the Bases API
 * (1.10+). Returns false when the view could not be registered.
 */
export function registerBasesView(
	plugin: OutreachPluginApi & BasesRegistrar,
): boolean {
	// Loaded lazily so the plugin still boots on Obsidian versions without Bases.
	const runtime = require("obsidian") as { BasesView?: unknown };
	const BaseClass = runtime.BasesView as
		| (new (controller: unknown) => {
				type: string;
				onDataUpdated(): void;
		  })
		| undefined;
	if (!BaseClass || typeof plugin.registerBasesView !== "function") {
		return false;
	}
	class OutreachBasesView extends BaseClass {
		readonly type = BASES_VIEW_TYPE;
		private rootEl: HTMLElement;

		constructor(controller: unknown, parentEl: HTMLElement) {
			super(controller);
			this.rootEl = parentEl.createDiv({ cls: "eo-bases-host" });
			renderBasesRoot(this.rootEl, this as unknown as BasesViewLike, plugin);
		}

		onDataUpdated(): void {
			renderBasesRoot(this.rootEl, this as unknown as BasesViewLike, plugin);
		}
	}

	try {
		return Boolean(
			plugin.registerBasesView(BASES_VIEW_TYPE, {
				name: BASES_VIEW_NAME,
				icon: "mail",
				factory: (controller: unknown, parentEl: HTMLElement) =>
					new OutreachBasesView(controller, parentEl),
			}),
		);
	} catch (error) {
		console.error("[email-outreach] 注册 Bases 视图失败", error);
		return false;
	}
}
