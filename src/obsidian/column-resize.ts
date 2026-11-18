import { clampColumnWidth, resizeColumnWidth } from "../core/column-widths";

/**
 * 表格列宽拖拽。
 *
 * 列宽不写进每个 `th`/`td`，而是统一放进 `<colgroup>`：表格用
 * `table-layout: fixed`，拖动时只改这一列的 `<col>` 和表格总宽度，
 * 其它列不会被浏览器按内容或剩余空间重新分配，宽度才是「拖多少变多少」。
 * 表格总宽度 = 各列之和：比面板窄时右侧留白，超出时 `.eo-table-wrap` 横向滚动。
 */
export interface ResizableColumn {
	id: string;
	/** 用于 aria-label / title；缺省用 id。 */
	label?: string;
	/** 当前宽度（调用方已把用户保存的宽度合并进来）。 */
	width: number;
	/** 双击手柄恢复的宽度；缺省回退到 `width`。 */
	defaultWidth?: number;
}

export interface ColumnResizeOptions {
	columns: ResizableColumn[];
	/** 拖拽结束 / 双击恢复 / 键盘微调后调用；拖动过程中不写盘。 */
	onChange: (widths: Record<string, number>) => void;
}

export function attachColumnResize(
	table: HTMLTableElement,
	headerCells: HTMLElement[],
	options: ColumnResizeOptions,
): void {
	const columns = options.columns;
	const widths: Record<string, number> = {};
	for (const column of columns) {
		widths[column.id] = clampColumnWidth(column.width);
	}

	const colgroup = document.createElement("colgroup");
	const colById = new Map<string, HTMLTableColElement>();
	for (const column of columns) {
		const col = document.createElement("col");
		col.style.width = `${widths[column.id]}px`;
		colgroup.appendChild(col);
		colById.set(column.id, col);
	}
	// colgroup 必须是 table 的第一个子元素，否则浏览器会忽略它。
	table.insertBefore(colgroup, table.firstChild);

	const totalWidth = (): number => {
		let total = 0;
		for (const column of columns) total += widths[column.id] ?? 0;
		return total;
	};
	const syncTableWidth = (): void => {
		table.style.width = `${totalWidth()}px`;
	};
	syncTableWidth();

	const applyWidth = (id: string, width: number): void => {
		widths[id] = width;
		const col = colById.get(id);
		if (col) col.style.width = `${width}px`;
		syncTableWidth();
	};

	columns.forEach((column, index) => {
		const header = headerCells[index];
		if (!header) return;

		const handle = document.createElement("div");
		handle.className = "eo-col-resizer";
		handle.setAttribute("role", "separator");
		handle.setAttribute("aria-orientation", "vertical");
		handle.setAttribute("aria-label", `调整「${column.label ?? column.id}」列宽`);
		handle.setAttribute(
			"title",
			"拖动调整列宽；双击恢复默认；聚焦后按 ←/→ 微调",
		);
		handle.tabIndex = 0;

		// 表头可点排序：手柄上的点击/双击不能冒泡到 th。
		handle.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
		});

		// 双击恢复默认。不用 dblclick 事件：拖拽里对 pointerdown 做了
		// preventDefault，个别内核会吞掉兼容鼠标事件，自己判定更稳。
		let lastDownAt = 0;
		let lastDownX = 0;

		handle.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			event.preventDefault();
			event.stopPropagation();
			const step = event.shiftKey ? 40 : 8;
			const delta = event.key === "ArrowLeft" ? -step : step;
			applyWidth(
				column.id,
				resizeColumnWidth(widths[column.id] ?? column.width, delta),
			);
			options.onChange({ ...widths });
		});

		handle.addEventListener("pointerdown", (event: PointerEvent) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			// 阻止默认行为后浏览器不再给焦点，手动给上：拖完可以直接按 ←/→。
			handle.focus({ preventScroll: true });

			const now = Date.now();
			const doubleClick =
				now - lastDownAt <= 350 && Math.abs(event.clientX - lastDownX) <= 6;
			lastDownAt = now;
			lastDownX = event.clientX;
			if (doubleClick) {
				lastDownAt = 0;
				applyWidth(
					column.id,
					clampColumnWidth(column.defaultWidth ?? column.width),
				);
				options.onChange({ ...widths });
				return;
			}

			const pointerId = event.pointerId;
			const startX = event.clientX;
			const startWidth = widths[column.id] ?? column.width;
			// 指针捕获让手指移出手柄后仍能继续拖；旧内核不支持时靠 window 监听兜底。
			const pointerHost = table.ownerDocument?.defaultView ?? window;
			if (typeof handle.setPointerCapture === "function") {
				try {
					handle.setPointerCapture(pointerId);
				} catch {
					// 某些旧内核不支持捕获；不捕获也能拖，只是移出手柄会断。
				}
			}
			handle.classList.add("is-dragging");
			table.classList.add("is-col-resizing");

			const move = (moveEvent: PointerEvent): void => {
				if (moveEvent.pointerId !== pointerId) return;
				applyWidth(
					column.id,
					resizeColumnWidth(startWidth, moveEvent.clientX - startX),
				);
			};
			const finish = (): void => {
				pointerHost.removeEventListener("pointermove", move);
				pointerHost.removeEventListener("pointerup", finish);
				pointerHost.removeEventListener("pointercancel", finish);
				handle.classList.remove("is-dragging");
				table.classList.remove("is-col-resizing");
				if (
					typeof handle.hasPointerCapture === "function" &&
					handle.hasPointerCapture(pointerId)
				) {
					handle.releasePointerCapture(pointerId);
				}
				if (widths[column.id] !== startWidth) {
					options.onChange({ ...widths });
				}
			};
			pointerHost.addEventListener("pointermove", move);
			pointerHost.addEventListener("pointerup", finish);
			pointerHost.addEventListener("pointercancel", finish);
		});

		header.appendChild(handle);
	});
}
