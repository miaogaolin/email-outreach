import type { App, TFile } from "obsidian";
import { isExcluded } from "../core/filters";
import {
	matchesGenerationFilter,
	type GenerationFilter,
	type GenerationFilterMode,
} from "../core/generation";
import {
	summarizeRunStatuses,
	statusLabel,
} from "../core/run-status";
import type { CustomerRecord } from "../core/types";
import type { OutreachPluginApi } from "./plugin-api";
import { fillContactCounts } from "./contact-counts";
import { renderRunBar, type RunBarHandle } from "./run-bar";
import {
	renderCustomerTable,
	type CustomerColumn,
	type CustomerRow,
	type CustomerTableHandle,
} from "./table";
import { DEV_STATUS_COLUMN_ID, renderDevStatusCell } from "./dev-status-cell";
import { captureViewScroll, restoreViewScroll } from "./scroll-preserve";

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

/** 每次整块重画 root 前，先断掉上一张表的列宽 ResizeObserver。 */
const tableCleanups = new WeakMap<HTMLElement, () => void>();

function renderBasesRoot(
	root: HTMLElement,
	view: BasesViewLike,
	plugin: OutreachPluginApi,
): void {
	tableCleanups.get(root)?.();
	tableCleanups.delete(root);
	// Bases 的数据更新会整块重画；勾选提醒、验收后刷新时保持当前滚动位置。
	const scroll = captureViewScroll(root);
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
	const generationBar = root.createDiv({ cls: "eo-bases-generation" });
	const body = root.createDiv({ cls: "eo-bases-body" });
	let showExcluded = false;
	let drawToken = 0;
	/** 当前表格：重画前断开列宽 ResizeObserver。 */
	let tableHandle: CustomerTableHandle | null = null;
	const destroyTable = (): void => {
		tableHandle?.destroy();
		tableHandle = null;
	};
	const drawTable = (): void => {
		destroyTable();
		const token = ++drawToken;
		body.empty();
		const search = searchInput.value.trim().toLowerCase();
		const rules = {
			tags: plugin.settings.excludeTags,
			progressPrefixes: plugin.settings.excludeProgressPrefixes,
		};
		// 生成时间来自 AI 开发信息文件：用全量客户建索引，不能只用 Base 过滤后的行。
		const generation = plugin.getGenerationReport();
		const now = new Date();
		let excludedCount = 0;
		let hiddenByGeneration = 0;
		const filtered = allRows.filter(({ record }) => {
			if (search && !record.name.toLowerCase().includes(search)) return false;
			if (excludeToggle.checked && !showExcluded) {
				if (isExcluded(record, rules)) {
					excludedCount++;
					return false;
				}
			}
			if (
				!matchesGenerationFilter(
					generation.byCustomer.get(record.path),
					plugin.settings.generationFilter,
					now,
				)
			) {
				hiddenByGeneration++;
				return false;
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
			{
				id: DEV_STATUS_COLUMN_ID,
				label: "开发状态",
				width: 180,
				title:
					"主行：最近一次有效生成的时间（来自 AI 开发信息文件）\n" +
					"副行：上次未解决的提醒（无可用联系人 / 未找到合适联系人 / 上次失败）\n" +
					"点击单元格查看这个客户的开发邮件；点表头排序",
				render: (row) =>
					renderDevStatusCell(row, plugin, generation.byCustomer, now),
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
			emptyText:
				entries.length === 0
					? "当前 Base 没有匹配的客户。请在 Base 里调整筛选条件。"
					: "没有符合当前搜索/排除条件的客户",
			columnWidths: plugin.settings.columnWidths.customers,
			onColumnWidthsChange: (widths) => {
				// 保留暂时隐藏的列的宽度：重新勾选时还能沿用。
				plugin.settings.columnWidths.customers = {
					...plugin.settings.columnWidths.customers,
					...widths,
				};
				void plugin.saveSettings();
			},
		});
		tableHandle = table;
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
		const unknownCount = allRows.filter(
			({ record }) => generation.byCustomer.get(record.path)?.state === "unknown",
		).length;
		const infoParts = [`共 ${rows.length} 家`];
		if (hiddenByGeneration > 0) {
			infoParts.push(`因生成时间隐藏 ${hiddenByGeneration} 家`);
		}
		if (unknownCount > 0) infoParts.push(`无法判断 ${unknownCount} 家`);
		infoParts.push(`已排除 ${excludedCount} 家`);
		if (generation.unmatchedFiles.length > 0) {
			infoParts.push(
				`有 ${generation.unmatchedFiles.length} 个 AI 文件无法对应客户`,
			);
		}
		infoParts.push(`排序：${sortText}（由 Base 控制）`);
		info.setText(infoParts.join(" · "));

		const footer = body.createDiv({ cls: "eo-footer" });
		const taskContainer = footer.createDiv({ cls: "eo-taskbar-container" });
		runBar = renderRunBar(taskContainer, {
			selectedCount: selected.size,
			running: plugin.isRunning(),
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
	renderGenerationControls(generationBar, plugin, drawTable);
	drawTable();
	// 下一次整块重画之前，先让旧表格断开 ResizeObserver。
	tableCleanups.set(root, destroyTable);
	restoreViewScroll(root, scroll);
}

/** Bases 视图里的「最近生成」控件；写的是与内置工作台同一份设置。 */
function renderGenerationControls(
	container: HTMLElement,
	plugin: OutreachPluginApi,
	onChange: () => void,
): void {
	container.empty();
	const filter = plugin.settings.generationFilter;
	const row = container.createDiv({ cls: "eo-filter-row eo-filter-generation" });
	row.createSpan({ cls: "eo-filter-label", text: "最近生成" });

	const modeSelect = row.createEl("select", {
		attr: { "aria-label": "最近生成筛选" },
	});
	const modes: Array<[GenerationFilterMode, string]> = [
		["off", "不限"],
		["stale", "≥ N 天未生成"],
		["fresh", "N 天内生成过"],
		["never", "从未生成"],
	];
	for (const [value, label] of modes) {
		modeSelect.createEl("option", { value, text: label });
	}
	modeSelect.value = filter.mode;
	modeSelect.addEventListener("change", () => {
		filter.mode = modeSelect.value as GenerationFilterMode;
		void plugin.saveSettings();
		// 模式变化要重画控件本身：天数输入 / 包含从未生成只在特定模式下出现。
		renderGenerationControls(container, plugin, onChange);
		onChange();
	});

	const recreate = (): void => {
		renderGenerationControls(container, plugin, onChange);
		onChange();
	};

	if (filter.mode === "stale" || filter.mode === "fresh") {
		const daysInput = row.createEl("input", {
			type: "number",
			value: String(filter.days),
			cls: "eo-generation-days",
			attr: { min: "0.5", step: "0.5", "aria-label": "天数" },
		});
		daysInput.addEventListener("change", () => {
			const parsed = Number(daysInput.value);
			filter.days = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
			void plugin.saveSettings();
			recreate();
		});
		row.createSpan({ text: "天" });
	}

	if (filter.mode === "stale") {
		const label = row.createEl("label", { cls: "eo-filter-excluded" });
		const checkbox = label.createEl("input", { type: "checkbox" });
		checkbox.checked = filter.includeNever;
		checkbox.addEventListener("change", () => {
			filter.includeNever = checkbox.checked;
			void plugin.saveSettings();
			onChange();
		});
		label.createSpan({ text: "包含从未生成" });
	}

	const quick = row.createDiv({ cls: "eo-filter-presets eo-generation-presets" });
	const addQuick = (label: string, next: GenerationFilter): void => {
		quick.createEl("button", { text: label }).addEventListener("click", () => {
			plugin.settings.generationFilter = { ...next };
			void plugin.saveSettings();
			recreate();
		});
	};
	addQuick("今日待开发", { mode: "stale", days: 1, includeNever: true });
	addQuick("24h 内已生成", { mode: "fresh", days: 1, includeNever: true });
	addQuick("不限", { mode: "off", days: 1, includeNever: true });

	row.createSpan({
		cls: "eo-muted eo-bases-hint",
		text: "Base 原生筛选/排序看不到这个派生字段，由插件视图提供。",
	});
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
