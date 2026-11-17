import { setTooltip } from "obsidian";
import { describeDevState } from "../core/dev-state";
import type { CustomerGeneration } from "../core/generation";
import type { OutreachPluginApi } from "./plugin-api";
import type { CustomerRow } from "./table";

/** 合并后的「开发状态」列（主行最近生成，副行未解决提醒）。 */
export const DEV_STATUS_COLUMN_ID = "eo:devStatus";

/**
 * 两个工作台共用的单元格渲染：主行是最近生成时间，副行是上次未解决的提醒。
 * 单元格整体可点击 → 打开这个客户的邮件列表；没有邮件时只显示文字。
 */
export function renderDevStatusCell(
	row: CustomerRow,
	plugin: OutreachPluginApi,
	index: Map<string, CustomerGeneration>,
	now: Date,
): HTMLElement {
	const info = index.get(row.record.path);
	const view = describeDevState(
		info,
		plugin.getCustomerDevStatus(row.record.path),
		now,
	);
	const total = info?.totalEmailCount ?? 0;
	const pending = info?.pendingCount ?? 0;
	const clickable = total > 0;

	const cell = clickable
		? document.createElement("a")
		: document.createElement("div");
	cell.className = "eo-dev-cell";
	if (clickable) {
		(cell as HTMLAnchorElement).href = "#";
		(cell as HTMLAnchorElement).setAttribute("role", "button");
		cell.classList.add("eo-dev-cell-clickable");
	}

	const main = document.createElement("div");
	main.className = `eo-dev-main eo-dev-${view.level}`;
	const text = document.createElement("span");
	text.textContent = view.text;
	main.appendChild(text);
	if (clickable) {
		const jump = document.createElement("span");
		jump.className = pending > 0 ? "eo-dev-jump eo-dev-count" : "eo-dev-jump";
		jump.textContent = pending > 0 ? `✉${pending}` : "✉";
		jump.setAttribute("aria-hidden", "true");
		main.appendChild(jump);
	}
	cell.appendChild(main);

	if (view.detail) {
		const detail = document.createElement("div");
		detail.className = `eo-dev-detail eo-dev-${view.detailLevel ?? "warn"}`;
		detail.textContent = view.detail;
		cell.appendChild(detail);
	}

	const hint = clickable
		? `点击查看该客户的开发邮件（待审 ${pending} 封 / 共 ${total} 封）`
		: "还没有开发邮件";
	// 只用 Obsidian 的 tooltip：再设原生 title 会同时弹出两个内容相同的提示。
	setTooltip(
		cell,
		[
			`${row.name} 开发状态：${view.text}`,
			view.title,
			hint,
		]
			.filter(Boolean)
			.join("\n"),
	);

	if (clickable) {
		cell.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void plugin.openEmailListForCustomer(
				row.record,
				info?.filePath ?? null,
			);
		});
	}

	return cell;
}
