import type { CustomerRepo } from "./customer-repo";
import type { CustomerRow, CustomerTableHandle } from "./table";

const CONCURRENCY = 6;

/** 让出主线程，避免大量已缓存的读取在微任务里连续解析、拖住点击。 */
function yieldToUi(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

/**
 * 联系人数量要读客户笔记正文。渲染时先用缓存值，缺失的在这里按少量并发
 * 补齐，只更新对应单元格，避免打开工作台时同步读几百个文件卡住界面。
 */
export function fillContactCounts(
	repo: CustomerRepo,
	rows: CustomerRow[],
	table: CustomerTableHandle,
	isCurrent: () => boolean,
): void {
	const pending = rows.filter(
		(row) => repo.getContactCount(row.record) === null,
	);
	if (pending.length === 0) return;

	let index = 0;
	const worker = async (): Promise<void> => {
		while (index < pending.length) {
			if (!isCurrent()) return;
			const row = pending[index++]!;
			try {
				const count = await repo.loadContactCount(row.record);
				if (isCurrent() && table.isConnected()) {
					table.setContactCount(row.key, count);
				}
			} catch {
				if (isCurrent() && table.isConnected()) {
					table.setContactCount(row.key, null);
				}
			}
			await yieldToUi();
		}
	};

	void Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker),
	);
}
