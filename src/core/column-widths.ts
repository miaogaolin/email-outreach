/**
 * 表格列宽的纯逻辑：夹取、归一化、默认值合并。
 *
 * 宽度只以「列 id → 像素」的形式保存在 data.json 里；DOM 操作在
 * `src/obsidian/column-resize.ts`。放在 core 是为了能直接单测，
 * 也避免把用户手改坏的 data.json 带进渲染层（负宽、字符串、NaN 一律忽略）。
 */

/** 再窄就点不到表头/勾选框了；再宽会把其它列挤到看不见。 */
export const MIN_COLUMN_WIDTH = 32;
export const MAX_COLUMN_WIDTH = 1200;

export interface TableColumnWidths {
	/** 客户列表（内置工作台与 Bases 视图共用，列 id 语义相同）。 */
	customers: Record<string, number>;
	/** 开发邮件列表。 */
	emails: Record<string, number>;
}

export const EMPTY_TABLE_COLUMN_WIDTHS: TableColumnWidths = {
	customers: {},
	emails: {},
};

export function clampColumnWidth(width: number): number {
	if (Number.isNaN(width)) return MIN_COLUMN_WIDTH;
	return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

/** 拖动时用：起始宽度 + 位移，再夹到合法区间。 */
export function resizeColumnWidth(startWidth: number, deltaX: number): number {
	if (!Number.isFinite(startWidth)) return MIN_COLUMN_WIDTH;
	if (!Number.isFinite(deltaX)) return clampColumnWidth(startWidth);
	return clampColumnWidth(startWidth + deltaX);
}

/**
 * 把任意值收敛成 `列 id → 宽度`：只接受有限正数，其余静默丢弃。
 * 不用抛错——data.json 被手改坏时，表格应该按默认宽度继续渲染。
 */
export function normalizeWidthMap(value: unknown): Record<string, number> {
	const result: Record<string, number> = {};
	if (!value || typeof value !== "object" || Array.isArray(value)) return result;
	for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!id) continue;
		const width = typeof raw === "number" ? raw : Number(raw);
		if (!Number.isFinite(width) || width <= 0) continue;
		result[id] = clampColumnWidth(width);
	}
	return result;
}

export function normalizeTableColumnWidths(value: unknown): TableColumnWidths {
	const source =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	return {
		customers: normalizeWidthMap(source.customers),
		emails: normalizeWidthMap(source.emails),
	};
}

/**
 * 默认宽度 + 已保存宽度的合并结果。已保存的键即使当前没有对应列也保留，
 * 这样重新勾选属性列时还能沿用用户上次拖好的宽度。
 */
export function mergeColumnWidths(
	defaults: ReadonlyArray<{ id: string; width: number }>,
	stored: Record<string, number> | null | undefined,
): Record<string, number> {
	const result: Record<string, number> = {};
	for (const { id, width } of defaults) {
		result[id] = clampColumnWidth(width);
	}
	for (const [id, width] of Object.entries(stored ?? {})) {
		if (!id || !Number.isFinite(width) || width <= 0) continue;
		result[id] = clampColumnWidth(width);
	}
	return result;
}

/** 表格实际宽度 = 各列宽度之和；用于 `table.style.width`，超出容器时横向滚动。 */
export function sumColumnWidths(
	ids: readonly string[],
	widths: Record<string, number>,
): number {
	let total = 0;
	for (const id of ids) {
		const width = widths[id];
		total += Number.isFinite(width) ? Math.max(0, width) : 0;
	}
	return total;
}
