import type { CustomerRecord } from "./types";

export type FilterOp =
	| "eq"
	| "neq"
	| "contains"
	| "not_contains"
	| "gt"
	| "lt"
	| "between"
	| "empty"
	| "not_empty";

export interface FilterCondition {
	key: string;
	op: FilterOp;
	value: string;
	value2?: string;
}

export interface FilterConfig {
	conditions: FilterCondition[];
	showExcluded: boolean;
}

export interface ExclusionRules {
	tags: string[];
	progressPrefixes: string[];
}

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
	eq: "等于",
	neq: "不等于",
	contains: "包含",
	not_contains: "不包含",
	gt: "大于",
	lt: "小于",
	between: "区间",
	empty: "为空",
	not_empty: "非空",
};

const PREFERRED_KEYS = [
	"客户类型",
	"地区",
	"进度",
	"开发方式",
	"主营业务",
	"fit",
	"indent",
	"potential",
	"risk",
	"跟进次数",
	"最近联系时间",
	"需求产品",
	"询问产品",
	"行业",
	"官网",
	"邮箱",
	"tags",
];

export function normalizeTag(tag: string): string {
	return tag.trim().replace(/^#/, "").toLowerCase();
}

export function asArray(value: unknown): unknown[] {
	if (value === undefined || value === null) return [];
	if (Array.isArray(value)) return value;
	return [value];
}

export function valueToString(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "object") {
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}
	return String(value);
}

export function isEmptyValue(value: unknown): boolean {
	if (value === undefined || value === null) return true;
	if (typeof value === "string") return value.trim() === "";
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

function toNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

export function isExcluded(
	record: CustomerRecord,
	rules: ExclusionRules,
): boolean {
	const excludedTags = new Set(
		(rules.tags ?? []).map(normalizeTag).filter(Boolean),
	);
	if (excludedTags.size > 0) {
		for (const tag of record.tags) {
			if (excludedTags.has(normalizeTag(tag))) return true;
		}
	}
	const prefixes = (rules.progressPrefixes ?? [])
		.map((prefix) => prefix.trim())
		.filter(Boolean);
	if (prefixes.length > 0) {
		const progress = record.fm["进度"];
		for (const item of asArray(progress)) {
			const text = valueToString(item);
			if (prefixes.some((prefix) => text.startsWith(prefix))) return true;
		}
	}
	return false;
}

function stringEquals(left: unknown, right: string): boolean {
	const a = valueToString(left).trim().toLowerCase();
	const b = right.trim().toLowerCase();
	if (!a || !b) return a === b;
	const na = toNumber(a);
	const nb = toNumber(b);
	if (na !== null && nb !== null) return na === nb;
	return a === b;
}

function stringContains(left: unknown, right: string): boolean {
	return valueToString(left).toLowerCase().includes(right.trim().toLowerCase());
}

export function matchCondition(
	record: CustomerRecord,
	condition: FilterCondition,
): boolean {
	const values = asArray(record.fm[condition.key]);
	const target = condition.value ?? "";
	switch (condition.op) {
		case "empty":
			return values.length === 0 || values.every(isEmptyValue);
		case "not_empty":
			return values.some((value) => !isEmptyValue(value));
		case "eq":
			return values.some((value) => stringEquals(value, target));
		case "neq":
			return !values.some((value) => stringEquals(value, target));
		case "contains":
			return values.some((value) => stringContains(value, target));
		case "not_contains":
			return !values.some((value) => stringContains(value, target));
		case "gt": {
			const threshold = toNumber(target);
			if (threshold === null) return true;
			return values.some((value) => {
				const num = toNumber(value);
				return num !== null && num > threshold;
			});
		}
		case "lt": {
			const threshold = toNumber(target);
			if (threshold === null) return true;
			return values.some((value) => {
				const num = toNumber(value);
				return num !== null && num < threshold;
			});
		}
		case "between": {
			const low = toNumber(target);
			const high = toNumber(condition.value2 ?? "");
			if (low === null || high === null) return true;
			const min = Math.min(low, high);
			const max = Math.max(low, high);
			return values.some((value) => {
				const num = toNumber(value);
				return num !== null && num >= min && num <= max;
			});
		}
		default:
			return true;
	}
}

export function matchesFilters(
	record: CustomerRecord,
	config: FilterConfig,
): boolean {
	return config.conditions.every((condition) => {
		if (!condition.key) return true;
		return matchCondition(record, condition);
	});
}

export function applyFilters(
	records: CustomerRecord[],
	config: FilterConfig,
	rules: ExclusionRules,
): { included: CustomerRecord[]; excluded: CustomerRecord[] } {
	const included: CustomerRecord[] = [];
	const excluded: CustomerRecord[] = [];
	for (const record of records) {
		if (!matchesFilters(record, config)) continue;
		if (!config.showExcluded && isExcluded(record, rules)) {
			excluded.push(record);
			continue;
		}
		included.push(record);
	}
	return { included, excluded };
}

export type PropertyType = "number" | "date" | "tags" | "text" | "empty";

export function inferPropertyType(
	records: CustomerRecord[],
	key: string,
): PropertyType {
	let sawNumber = false;
	let sawDate = false;
	let sawArray = false;
	let sawText = false;
	const dateRe = /^\d{4}-\d{2}-\d{2}/;
	for (const record of records.slice(0, 80)) {
		const value = record.fm[key];
		if (isEmptyValue(value)) continue;
		for (const item of asArray(value)) {
			if (Array.isArray(record.fm[key])) sawArray = true;
			if (typeof item === "number") sawNumber = true;
			else if (typeof item === "string") {
				if (dateRe.test(item)) sawDate = true;
				else if (item.trim() !== "") sawText = true;
			} else sawText = true;
		}
	}
	if (sawNumber) return "number";
	if (sawDate) return "date";
	if (sawArray) return "tags";
	if (sawText) return "text";
	return "empty";
}

export function collectPropertyKeys(records: CustomerRecord[]): string[] {
	const keys = new Set<string>();
	for (const record of records) {
		for (const key of Object.keys(record.fm)) {
			if (key === "position") continue;
			keys.add(key);
		}
	}
	const ordered: string[] = [];
	for (const key of PREFERRED_KEYS) {
		if (keys.has(key)) {
			ordered.push(key);
			keys.delete(key);
		}
	}
	ordered.push(...Array.from(keys).sort((a, b) => a.localeCompare(b, "zh-CN")));
	return ordered;
}

export function distinctValues(
	records: CustomerRecord[],
	key: string,
	limit = 40,
): string[] {
	const values = new Map<string, string>();
	for (const record of records) {
		for (const item of asArray(record.fm[key])) {
			const text = valueToString(item).trim();
			if (!text) continue;
			const lowered = text.toLowerCase();
			if (!values.has(lowered)) values.set(lowered, text);
			if (values.size >= limit * 2) break;
		}
	}
	return Array.from(values.values())
		.sort((a, b) => a.localeCompare(b, "zh-CN"))
		.slice(0, limit);
}
