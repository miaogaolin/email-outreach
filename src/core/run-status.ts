import type {
	CustomerDevStatus,
	CustomerDevStatusKind,
	DevStatusMap,
	RunStatusFile,
} from "./types";

const KINDS: CustomerDevStatusKind[] = [
	"generated",
	"no_contact",
	"no_suitable",
	"failed",
];

export function isDevStatusKind(value: unknown): value is CustomerDevStatusKind {
	return (
		typeof value === "string" &&
		(KINDS as string[]).includes(value)
	);
}

export function statusLabel(status: CustomerDevStatus): string {
	switch (status.kind) {
		case "generated":
			return `已生成 ${status.emailCount} 封`;
		case "no_contact":
			return "无可用联系人";
		case "no_suitable":
			return "未找到合适联系人";
		case "failed":
			return "执行失败";
	}
}

export function statusLevel(
	status: CustomerDevStatus,
): "ok" | "warn" | "error" {
	switch (status.kind) {
		case "generated":
			return "ok";
		case "failed":
			return "error";
		default:
			return "warn";
	}
}

export function statusNeedsAttention(status: CustomerDevStatus): boolean {
	return status.kind !== "generated";
}

export interface RunStatusSummary {
	generatedCustomers: number;
	generatedEmailCount: number;
	noContact: number;
	noSuitable: number;
	failed: number;
	attention: CustomerDevStatus[];
}

export function summarizeRunStatuses(map: DevStatusMap): RunStatusSummary {
	const summary: RunStatusSummary = {
		generatedCustomers: 0,
		generatedEmailCount: 0,
		noContact: 0,
		noSuitable: 0,
		failed: 0,
		attention: [],
	};
	for (const status of Object.values(map)) {
		switch (status.kind) {
			case "generated":
				summary.generatedCustomers++;
				summary.generatedEmailCount += status.emailCount;
				break;
			case "no_contact":
				summary.noContact++;
				break;
			case "no_suitable":
				summary.noSuitable++;
				break;
			case "failed":
				summary.failed++;
				break;
		}
		if (statusNeedsAttention(status)) summary.attention.push(status);
	}
	summary.attention.sort((a, b) =>
		a.customerName.localeCompare(b.customerName, "zh-CN"),
	);
	return summary;
}

function parseStatus(value: unknown): CustomerDevStatus | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	const kind = record.kind;
	if (!isDevStatusKind(kind)) return null;
	const customerName =
		typeof record.customerName === "string" ? record.customerName.trim() : "";
	if (!customerName) return null;
	const rawCount = Number(record.emailCount);
	const emailCount = Number.isFinite(rawCount) && rawCount >= 0
		? Math.floor(rawCount)
		: 0;
	const message = typeof record.message === "string" ? record.message : "";
	const at = typeof record.at === "string" ? record.at : "";
	return { kind, customerName, emailCount, message, at };
}

/**
 * 读取 `.state/last-run.json`。
 * 接受已解析对象或 JSON 字符串；任何不合法内容都返回 null，避免坏状态影响列表。
 */
export function parseRunStatusFile(value: unknown): RunStatusFile | null {
	let data = value;
	if (typeof value === "string") {
		try {
			data = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (typeof data !== "object" || data === null) return null;
	const record = data as Record<string, unknown>;
	const at = typeof record.at === "string" ? record.at : "";
	const customersRaw = record.customers;
	if (
		typeof customersRaw !== "object" ||
		customersRaw === null ||
		Array.isArray(customersRaw)
	) {
		return null;
	}
	const customers: DevStatusMap = {};
	for (const [path, raw] of Object.entries(
		customersRaw as Record<string, unknown>,
	)) {
		if (!path.trim()) continue;
		const status = parseStatus(raw);
		if (status) customers[path] = status;
	}
	return { at, customers };
}
