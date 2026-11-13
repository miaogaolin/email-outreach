/**
 * 勾选状态只对当前筛选结果有意义。筛选条件或搜索变化后，把已经
 * 不可见的客户从选区里移除，避免出现「看不见却一直被选中」的状态。
 */
export function pruneSelection(
	selected: Iterable<string>,
	allowed: Iterable<string>,
): Set<string> {
	const allowedSet = new Set(allowed);
	const next = new Set<string>();
	for (const path of selected) {
		if (allowedSet.has(path)) next.add(path);
	}
	return next;
}

export interface SelectionSummary {
	checked: boolean;
	indeterminate: boolean;
	selectedCount: number;
}

/**
 * 「全选」复选框的状态：只统计当前可见行。
 * 表格勾选后原地更新时复用它，避免为了刷新表头再整表重绘。
 */
export function selectionSummary(
	visibleKeys: Iterable<string>,
	selected: ReadonlySet<string>,
): SelectionSummary {
	const keys = [...visibleKeys];
	let selectedCount = 0;
	for (const key of keys) {
		if (selected.has(key)) selectedCount++;
	}
	return {
		checked: keys.length > 0 && selectedCount === keys.length,
		indeterminate: selectedCount > 0 && selectedCount < keys.length,
		selectedCount,
	};
}
