/**
 * 写入被 Obsidian 重新加载的文件时，阅读/编辑视图可能被重置到开头。
 *
 * 这里只决定「当前滚动位置是否需要拉回写入前的位置」：
 * - 写入前本来就在顶部：不用管；
 * - 视图还没重新渲染完（拿不到位置）：稍后再试；
 * - 现在掉到顶部而写入前不在顶部：还原。
 *
 * 判断只看「是否掉到顶部」，用户自己滚到别处时保持不动，避免和用户抢滚动条。
 * 位置是行号（MarkdownSubView.getScroll/applyScroll 的语义），不是像素。
 */
export type ScrollRestoreDecision = "keep" | "retry" | "restore";

export function decideScrollRestore(
	saved: number | null | undefined,
	current: number | null | undefined,
): ScrollRestoreDecision {
	if (!isPosition(saved) || saved < 1) return "keep";
	if (!isPosition(current)) return "retry";
	return current < 1 ? "restore" : "keep";
}

function isPosition(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value);
}
