import { App, MarkdownView, type WorkspaceLeaf } from "obsidian";
import { decideScrollRestore } from "../core/view-scroll";

/**
 * 写入文件后保持打开着的 Markdown 视图停在原处。
 *
 * 插件用 `vault.modify` 改 AI 开发信息文件时，Obsidian 会重新加载这个视图；
 * 阅读视图重建时可能被滚回开头（用户勾选底部「发送提醒」后最明显）。
 * 这里记录写入前的行号，写入后等视图重新渲染完再把位置补回去。
 */
export interface MarkdownPosition {
	leaf: WorkspaceLeaf;
	path: string;
	mode: string;
	scroll: number;
}

interface ScrollableLike {
	getScroll(): number;
	applyScroll(scroll: number): void;
}

/** 记录当前打开着这个文件的 Markdown 视图位置；写入前调用。 */
export function captureMarkdownPositions(
	app: App,
	path: string,
): MarkdownPosition[] {
	const positions: MarkdownPosition[] = [];
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) continue;
		if (view.file?.path !== path) continue;
		const scroll = readScroll(view.currentMode);
		if (scroll === null) continue;
		positions.push({ leaf, path, mode: view.getMode(), scroll });
	}
	return positions;
}

/**
 * 把被重置到开头的视图拉回写入前的位置；多次尝试是因为 Obsidian 的重新渲染
 * 是异步的（阅读视图解析完成前 `getScroll` 会返回 null）。
 */
export function restoreMarkdownPositions(
	positions: MarkdownPosition[],
): void {
	if (positions.length === 0) return;
	const run = (): void => {
		for (const item of positions) {
			const view = item.leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (view.file?.path !== item.path) continue;
			if (view.getMode() !== item.mode) continue;
			const current = readScroll(view.currentMode);
			if (decideScrollRestore(item.scroll, current) !== "restore") continue;
			try {
				view.currentMode.applyScroll(item.scroll);
			} catch (error) {
				console.error("[email-outreach] 还原阅读位置失败", error);
			}
		}
	};
	run();
	// 渲染完成时间不确定：逐次检查，位置回到原处后自然不再动作。
	for (const delay of [60, 160, 320, 620, 1000]) {
		window.setTimeout(run, delay);
	}
}

function readScroll(mode: ScrollableLike | null | undefined): number | null {
	if (!mode) return null;
	const scroll = mode.getScroll();
	return typeof scroll === "number" && Number.isFinite(scroll) ? scroll : null;
}

/* ------------------------------------------------------------------ 插件视图 */

export interface ViewScrollState {
	/** 视图根元素自身的滚动位置（页面级滚动）。 */
	root: number;
	/** 页内表格的滚动位置；重绘后按出现顺序还原。 */
	tables: number[];
}

/** 记录插件视图（工作台 / 邮件列表 / Bases）的滚动位置；重绘前调用。 */
export function captureViewScroll(root: HTMLElement): ViewScrollState {
	return {
		root: root.scrollTop,
		tables: Array.from(
			root.querySelectorAll<HTMLElement>(".eo-table-wrap"),
		).map((element) => element.scrollTop),
	};
}

/** 重绘完成后把插件视图的滚动位置放回去，避免刷新把列表滚回顶部。 */
export function restoreViewScroll(
	root: HTMLElement,
	state: ViewScrollState,
): void {
	const apply = (): void => {
		root.scrollTop = state.root;
		const tables = root.querySelectorAll<HTMLElement>(".eo-table-wrap");
		tables.forEach((element, index) => {
			const top = state.tables[index];
			if (top !== undefined) element.scrollTop = top;
		});
	};
	apply();
	window.requestAnimationFrame(apply);
}

