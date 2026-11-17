import { emailUpdatedAt } from "./ai-file";
import { parseGenerationTime } from "./generation";
import type { EmailRow, EmailStatus } from "./types";

/**
 * 邮件列表的客户筛选与「同邮箱待审去重」。
 *
 * 纯函数，不读 Obsidian：视图只负责把 `EmailRow[]` 和查询条件传进来。
 */

export type PendingDedupeScope = "customer" | "global";

export interface EmailCustomerFilter {
	path: string;
	name: string;
	/** 该客户匹配到的 AI 文件路径；匹配不到时为 null。 */
	aiFilePath: string | null;
}

export interface EmailListQuery {
	status: EmailStatus | "all";
	search: string;
	customer: EmailCustomerFilter | null;
	/** 是否显示被合并掉的旧待审。 */
	showDuplicatePending: boolean;
	/** 默认 "customer"：同一客户 + 同一邮箱；"global"：整个列表按邮箱。 */
	scope?: PendingDedupeScope;
}

export interface EmailListResult {
	/** 默认不含被合并的旧待审；showDuplicatePending 打开时包含全部，顺序不变。 */
	visible: EmailRow[];
	/** 当前过滤结果里被合并掉的待审数量。 */
	hiddenDuplicateCount: number;
}

export function isPendingStatus(status: EmailStatus): boolean {
	return status === "Generated" || status === "Revision";
}

export function normalizeEmail(value: string): string {
	return (value ?? "").trim().toLowerCase();
}

export function emailRecencyMs(row: EmailRow): number {
	const raw = emailUpdatedAt(row.record);
	const parsed = parseGenerationTime(raw);
	return parsed === null ? 0 : parsed;
}

function normalizeLink(value: string): string {
	return (value ?? "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/\.md$/i, "")
		.replace(/^\.\//, "")
		.replace(/^\/+/, "");
}

function baseName(value: string): string {
	const normalized = normalizeLink(value);
	return normalized.split("/").pop() ?? "";
}

export function matchesCustomerFilter(
	row: EmailRow,
	filter: EmailCustomerFilter | null,
): boolean {
	if (!filter) return true;
	// 优先用 AI 文件路径：客户改名后仍能精确命中，也不会被同名客户串号。
	if (filter.aiFilePath && row.filePath === filter.aiFilePath) return true;
	const link = normalizeLink(row.customerLink);
	const path = normalizeLink(filter.path);
	if (link) {
		if (link === path) return true;
		if (baseName(link) === baseName(path)) return true;
	}
	return row.customerName === filter.name;
}

function idNumber(row: EmailRow): number {
	const parsed = Number.parseInt(row.record.id, 10);
	return Number.isFinite(parsed) ? parsed : -1;
}

/** 组内「谁更新」：更新时间大的优先，相同则邮件 ID 大的优先，再按 key 稳定排序。 */
function isNewer(left: EmailRow, right: EmailRow): boolean {
	const delta = emailRecencyMs(left) - emailRecencyMs(right);
	if (delta !== 0) return delta > 0;
	const idDelta = idNumber(left) - idNumber(right);
	if (idDelta !== 0) return idDelta > 0;
	return left.key < right.key;
}

function groupKey(row: EmailRow, scope: PendingDedupeScope): string | null {
	const email = normalizeEmail(row.record.email);
	if (!email) return null;
	if (scope === "global") return email;
	return `${row.filePath}\u0000${email}`;
}

/**
 * 同一「客户 + 邮箱」的多条待审只保留最新一封。
 *
 * - 最新一封已验收时，旧待审也隐藏（否则验收完旧草稿又冒出来）；
 * - 更新的已拒绝不抑制旧待审（拒绝的是那封新草稿，不是这个邮箱）；
 * - Accepted / Rejected 行本身永远不隐藏；空邮箱不参与合并。
 *
 * 对全量行执行，不要先做状态/搜索过滤，否则「最新已验收」压不住别的筛选下的旧草稿。
 */
export function dedupePendingRows(
	rows: EmailRow[],
	scope: PendingDedupeScope = "customer",
): { kept: EmailRow[]; hidden: EmailRow[] } {
	const groups = new Map<string, EmailRow[]>();
	for (const row of rows) {
		const key = groupKey(row, scope);
		if (!key) continue;
		const list = groups.get(key) ?? [];
		list.push(row);
		groups.set(key, list);
	}

	const hiddenKeys = new Set<string>();
	for (const group of groups.values()) {
		let newestPending: EmailRow | null = null;
		let newestAccepted: EmailRow | null = null;
		for (const row of group) {
			if (isPendingStatus(row.record.status)) {
				if (!newestPending || isNewer(row, newestPending)) newestPending = row;
			} else if (row.record.status === "Accepted") {
				if (!newestAccepted || isNewer(row, newestAccepted)) newestAccepted = row;
			}
		}
		const suppressed =
			newestPending !== null &&
			newestAccepted !== null &&
			isNewer(newestAccepted, newestPending);
		for (const row of group) {
			if (!isPendingStatus(row.record.status)) continue;
			if (row !== newestPending || suppressed) hiddenKeys.add(row.key);
		}
	}

	const kept: EmailRow[] = [];
	const hidden: EmailRow[] = [];
	for (const row of rows) {
		if (hiddenKeys.has(row.key)) hidden.push(row);
		else kept.push(row);
	}
	return { kept, hidden };
}

function matchesStatus(row: EmailRow, status: EmailStatus | "all"): boolean {
	if (status === "all") return row.record.status !== "Rejected";
	return row.record.status === status;
}

function haystack(row: EmailRow): string {
	return [
		row.customerName,
		row.record.contact,
		row.record.email,
		row.record.summaryZh,
		row.record.subject,
	]
		.join(" ")
		.toLowerCase();
}

/**
 * 先做去重判定，再做状态 / 客户 / 搜索过滤；搜索不会命中被隐藏的旧草稿。
 * `hiddenDuplicateCount` 只统计「通过当前过滤、但被合并」的行，保证文案与开关数字对得上。
 */
export function filterEmailRows(
	rows: EmailRow[],
	query: EmailListQuery,
): EmailListResult {
	const { hidden } = dedupePendingRows(rows, query.scope ?? "customer");
	const hiddenKeys = new Set(hidden.map((row) => row.key));
	const search = query.search.trim().toLowerCase();
	const passed = rows.filter((row) => {
		if (!matchesStatus(row, query.status)) return false;
		if (!matchesCustomerFilter(row, query.customer)) return false;
		if (search && !haystack(row).includes(search)) return false;
		return true;
	});
	let hiddenDuplicateCount = 0;
	const visible: EmailRow[] = [];
	for (const row of passed) {
		if (hiddenKeys.has(row.key)) {
			hiddenDuplicateCount++;
			if (query.showDuplicatePending) visible.push(row);
			continue;
		}
		visible.push(row);
	}
	return { visible, hiddenDuplicateCount };
}
