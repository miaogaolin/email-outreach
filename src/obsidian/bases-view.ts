import type { App, TFile } from "obsidian";
import { isExcluded } from "../core/filters";
import {
	summarizeRunStatuses,
	statusLabel,
	statusLevel,
} from "../core/run-status";
import type { CustomerRecord } from "../core/types";
import type { OutreachPluginApi } from "./plugin-api";
import { fillContactCounts } from "./contact-counts";
import { renderRunBar, type RunBarHandle } from "./run-bar";
import {
	renderCustomerTable,
	type CustomerColumn,
	type CustomerRow,
	type CustomerStatus,
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

	// 搜索/排除开关会重复调用 drawTable；每次只重画这一块，避免表格叠加。
	const body = root.createDiv({ cls: "eo-bases-body" });
	let showExcluded = false;
	let drawToken = 0;
	const drawTable = (): void => {
		const token = ++drawToken;
		body.empty();
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
			const hint = body.createDiv({ cls: "eo-muted eo-bases-hint" });
			hint.setText(
				"还没有选择属性列：在 Base 工具栏的「属性」菜单里勾选要显示的字段。",
			);
		}

		renderBasesRunBanner(body, plugin);
		const tableContainer = body.createDiv({ cls: "eo-table-wrap" });
		// Base 的筛选/搜索变化后，隐藏的客户不能继续留在选区里。
		const selected = plugin.pruneSelection(rows.map((row) => row.key));
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
			status: (row) => statusForCustomer(plugin, row),
			emptyText:
				entries.length === 0
					? "当前 Base 没有匹配的客户。请在 Base 里调整筛选条件。"
					: "没有符合当前搜索/排除条件的客户",
		});
		fillContactCounts(
			plugin.repo,
			rows,
			table,
			() => token === drawToken,
		);

		const info = body.createDiv({ cls: "eo-muted eo-bases-info" });
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

		const footer = body.createDiv({ cls: "eo-footer" });
		const taskContainer = footer.createDiv({ cls: "eo-taskbar-container" });
		runBar = renderRunBar(taskContainer, {
			selectedCount: selected.size,
			onRun: () => {
				const chosen = selected.size
					? allRows
							.filter(({ record }) => selected.has(record.path))
							.map(({ record }) => record)
					: [];
				void plugin.runTasks(chosen);
			},
		});
		void excludedCount;
	};

	searchInput.addEventListener("input", drawTable);
	excludeToggle.addEventListener("change", drawTable);
	drawTable();
}

function statusForCustomer(
	plugin: OutreachPluginApi,
	row: CustomerRow,
): CustomerStatus {
	const status = plugin.getCustomerDevStatus(row.record.path);
	if (status) {
		return {
			text: statusLabel(status),
			level: statusLevel(status),
			title: status.message,
		};
	}
	return {
		text: row.record.fm[plugin.settings.linkPropertyName] ? "✓" : "—",
	};
}

function renderBasesRunBanner(
	container: HTMLElement,
	plugin: OutreachPluginApi,
): void {
	const run = plugin.getLastRunStatus();
	if (!run) return;
	const summary = summarizeRunStatuses(run.customers);
	if (summary.generatedCustomers === 0 && summary.attention.length === 0) {
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

interface RefreshableBasesView {
	refresh(): boolean;
}

const liveBasesViews = new Set<RefreshableBasesView>();

/** 运行结束后刷新所有仍然挂载的 Bases 视图，让「开发状态」列立即更新。 */
export function refreshBasesViews(): void {
	for (const view of [...liveBasesViews]) {
		try {
			if (!view.refresh()) liveBasesViews.delete(view);
		} catch (error) {
			console.error("[email-outreach] 刷新 Bases 视图失败", error);
			liveBasesViews.delete(view);
		}
	}
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
	// Loaded lazily so the plugin still boots on Obsidian versions without
	// Bases (or on mobile, where require may not exist).
	if (typeof require !== "function") return false;
	let runtime: { BasesView?: unknown };
	try {
		runtime = require("obsidian") as { BasesView?: unknown };
	} catch {
		return false;
	}
	const BaseClass = runtime.BasesView as
		| (new (controller: unknown) => {
				type: string;
				onDataUpdated(): void;
		  })
		| undefined;
	if (!BaseClass || typeof plugin.registerBasesView !== "function") {
		return false;
	}
	class OutreachBasesView extends BaseClass implements RefreshableBasesView {
		readonly type = BASES_VIEW_TYPE;
		private rootEl: HTMLElement;

		constructor(
			controller: unknown,
			parentEl: HTMLElement,
			private pluginApi: OutreachPluginApi,
		) {
			super(controller);
			this.rootEl = parentEl.createDiv({ cls: "eo-bases-host" });
			liveBasesViews.add(this);
			renderBasesRoot(
				this.rootEl,
				this as unknown as BasesViewLike,
				this.pluginApi,
			);
		}

		refresh(): boolean {
			if (!this.rootEl.isConnected) return false;
			renderBasesRoot(
				this.rootEl,
				this as unknown as BasesViewLike,
				this.pluginApi,
			);
			return true;
		}

		onDataUpdated(): void {
			this.refresh();
		}
	}

	try {
		return Boolean(
			plugin.registerBasesView(BASES_VIEW_TYPE, {
				name: BASES_VIEW_NAME,
				icon: "mail",
				factory: (controller: unknown, parentEl: HTMLElement) =>
					new OutreachBasesView(controller, parentEl, plugin),
			}),
		);
	} catch (error) {
		console.error("[email-outreach] 注册 Bases 视图失败", error);
		return false;
	}
}
