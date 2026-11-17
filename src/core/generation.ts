import { customerNameFromAIFile } from "./filenames";
import type { CustomerRecord, EmailRecord, EmailStatus } from "./types";
import { parseSingleWikilink, pathToLinkTarget } from "./wikilinks";

/**
 * 客户「最近生成开发邮件」的推导。
 *
 * 唯一真源是输出目录里 AI 开发信息文件的邮件块 `generated_at`：客户笔记零写入。
 * 老文件可能没有 `generated_at`，回退到第一个版本的标题时间。
 */

export type GenerationState = "known" | "never" | "unknown";

export interface CustomerGeneration {
	state: GenerationState;
	/** 最近一次有效生成时间，保留原始 ISO 偏移；没有有效生成时为 null。 */
	lastGeneratedAt: string | null;
	lastGeneratedMs: number | null;
	/** 有效邮件数（status !== "Rejected" 且能解析出时间）。 */
	emailCount: number;
	/** 含已拒绝的总邮件数。 */
	totalEmailCount: number;
	/** 所有邮件都被拒绝（用于区分「已拒绝」和「时间无法解析」）。 */
	allRejected: boolean;
	/** 待审邮件数（Generated），用于开发状态单元格的「✉」角标。 */
	pendingCount: number;
	/** 匹配到的 AI 开发信息文件路径；没有匹配 / 从未生成时为 null。 */
	filePath: string | null;
	/** 最近一封有效邮件的状态，用于 tooltip。 */
	lastStatus: EmailStatus | null;
}

export type GenerationFilterMode = "off" | "stale" | "fresh" | "never";

export interface GenerationFilter {
	mode: GenerationFilterMode;
	/** stale / fresh 的窗口天数，允许 0.5（= 12 小时）；默认 1。 */
	days: number;
	/** stale 时是否把「从未生成 / 只有已拒绝」的客户也算进来。 */
	includeNever: boolean;
}

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const MINUTE_MS = 60000;

const GENERATION_MODES: GenerationFilterMode[] = [
	"off",
	"stale",
	"fresh",
	"never",
];

export const NEVER_GENERATION: CustomerGeneration = {
	state: "never",
	lastGeneratedAt: null,
	lastGeneratedMs: null,
	emailCount: 0,
	totalEmailCount: 0,
	allRejected: false,
	pendingCount: 0,
	filePath: null,
	lastStatus: null,
};

// -------------------------------------------------------------- time parsing

/**
 * 自己解析生成时间，不依赖 `Date.parse` 对 `YYYY-MM-DD HH:mm` 的实现差异。
 * 带偏移（或 Z）的按绝对时间；不带偏移的（含 `YYYY-MM-DD HH:mm` 与纯日期）
 * 按运行机器本地时间解释，和旧文件写入时的语义一致。
 */
const TIME_RE =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validParts(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number,
): boolean {
	if (!Number.isInteger(year) || year < 1970 || year > 9999) return false;
	if (!Number.isInteger(month) || month < 1 || month > 12) return false;
	if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
		return false;
	}
	if (hour < 0 || hour > 23) return false;
	if (minute < 0 || minute > 59) return false;
	if (second < 0 || second > 59) return false;
	return true;
}

export function parseGenerationTime(value: string): number | null {
	const trimmed = (value ?? "").trim();
	if (!trimmed) return null;
	const match = TIME_RE.exec(trimmed);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = match[4] === undefined ? 0 : Number(match[4]);
	const minute = match[5] === undefined ? 0 : Number(match[5]);
	const second = match[6] === undefined ? 0 : Number(match[6]);
	if (!validParts(year, month, day, hour, minute, second)) return null;
	const zone = match[7];
	if (!zone) {
		const local = new Date(year, month - 1, day, hour, minute, second, 0);
		if (
			local.getFullYear() !== year ||
			local.getMonth() !== month - 1 ||
			local.getDate() !== day
		) {
			return null;
		}
		return local.getTime();
	}
	let offsetMinutes = 0;
	if (zone !== "Z") {
		const sign = zone.startsWith("-") ? -1 : 1;
		const offsetHours = Number(zone.slice(1, 3));
		const offsetMins = Number(zone.slice(4, 6));
		if (offsetHours > 23 || offsetMins > 59) return null;
		offsetMinutes = sign * (offsetHours * 60 + offsetMins);
	}
	const utc = Date.UTC(year, month - 1, day, hour, minute, second) -
		offsetMinutes * MINUTE_MS;
	const check = new Date(utc);
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== day
	) {
		return null;
	}
	return utc;
}

/** 单封邮件的生成时间：`generatedAt` 优先，老文件回退到第一个版本的时间。 */
export function emailGeneratedAt(email: EmailRecord): string {
	const direct = (email.generatedAt ?? "").trim();
	if (direct) return direct;
	return (email.versions?.[0]?.at ?? "").trim();
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

/** `2026-11-10 20:19`，本地时间，用于 tooltip 里的精确时间。 */
export function formatGenerationDate(ms: number): string {
	const date = new Date(ms);
	return `${formatDateOnly(ms)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** `2026-11-10`，本地时间，用于「超过 30 天」的展示。 */
export function formatDateOnly(ms: number): string {
	const date = new Date(ms);
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// ------------------------------------------------------------------ summary

export function summarizeGeneration(
	emails: EmailRecord[],
	hasAIFile: boolean,
): CustomerGeneration {
	const totalEmailCount = emails.length;
	let lastGeneratedAt: string | null = null;
	let lastGeneratedMs: number | null = null;
	let emailCount = 0;
	let pendingCount = 0;
	let lastStatus: EmailStatus | null = null;
	let rejected = 0;
	for (const email of emails) {
		if (email.status === "Rejected") {
			rejected++;
			continue;
		}
		if (email.status === "Generated") {
			pendingCount++;
		}
		const raw = emailGeneratedAt(email);
		const ms = parseGenerationTime(raw);
		if (ms === null) continue;
		emailCount++;
		if (lastGeneratedMs === null || ms > lastGeneratedMs) {
			lastGeneratedMs = ms;
			lastGeneratedAt = raw;
			lastStatus = email.status;
		}
	}
	const allRejected = totalEmailCount > 0 && rejected === totalEmailCount;
	const state: GenerationState =
		totalEmailCount > 0 ? "known" : hasAIFile ? "unknown" : "never";
	return {
		state,
		lastGeneratedAt,
		lastGeneratedMs,
		emailCount,
		totalEmailCount,
		allRejected,
		pendingCount,
		filePath: null,
		lastStatus,
	};
}

// ---------------------------------------------------------------------- index

export interface GenerationFileInput {
	path: string;
	customerLink: string;
	emails: EmailRecord[];
}

export interface GenerationCustomerInput {
	path: string;
	name: string;
	/** 客户属性里指向 AI 文件的双链目标（已去 .md）。 */
	linkedAIPaths: string[];
}

export interface GenerationIndex {
	byCustomer: Map<string, CustomerGeneration>;
	/** 找不到对应客户的 AI 文件路径。 */
	unmatchedFiles: string[];
}

function linkKey(value: string | null | undefined): string {
	const trimmed = (value ?? "").trim().replace(/\\/g, "/");
	if (!trimmed) return "";
	return pathToLinkTarget(trimmed).replace(/^\.\//, "").replace(/^\/+/, "");
}

function baseNameOf(key: string): string {
	return key.split("/").pop() ?? "";
}

export function buildGenerationIndex(
	files: GenerationFileInput[],
	customers: GenerationCustomerInput[],
): GenerationIndex {
	const byCustomer = new Map<string, CustomerGeneration>();
	const unmatchedFiles: string[] = [];
	const byPath = new Map<string, GenerationCustomerInput>();
	const byName = new Map<string, GenerationCustomerInput[]>();
	const byLinkedAI = new Map<string, string>();

	for (const customer of customers) {
		const customerKey = linkKey(customer.path);
		if (customerKey) byPath.set(customerKey, customer);
		const list = byName.get(customer.name) ?? [];
		if (!list.includes(customer)) list.push(customer);
		byName.set(customer.name, list);
		for (const linked of customer.linkedAIPaths) {
			const key = linkKey(linked);
			if (key) byLinkedAI.set(key, customer.path);
		}
	}

	const matched = new Map<string, GenerationFileInput[]>();
	const markAmbiguous = (customerPath: string): void => {
		if (matched.has(customerPath) || byCustomer.has(customerPath)) return;
		byCustomer.set(customerPath, {
			...NEVER_GENERATION,
			state: "unknown",
		});
	};
	const attach = (
		customerPath: string,
		file: GenerationFileInput,
	): void => {
		const list = matched.get(customerPath) ?? [];
		list.push(file);
		matched.set(customerPath, list);
	};

	for (const file of files) {
		const fileKey = linkKey(file.path);
		const target = linkKey(file.customerLink);

		// 1. 双链带目录：与客户路径完全一致。
		if (target.includes("/")) {
			const customer = byPath.get(target);
			if (customer) {
				attach(customer.path, file);
				continue;
			}
		}

		// 2. 客户属性 AI开发信息 的双链反查（客户改名后仍有效）。
		const viaLink = byLinkedAI.get(fileKey);
		if (viaLink) {
			attach(viaLink, file);
			continue;
		}

		// 3. basename 唯一时按名字归属：先用双链的 basename，
		//    对不上（例如客户改名但旧双链还在）再用 AI 文件名推导。
		const linkedBase = baseNameOf(target);
		const derivedBase = customerNameFromAIFile(baseNameOf(fileKey));
		const linkedCandidates = linkedBase
			? (byName.get(linkedBase) ?? [])
			: [];
		const candidates =
			linkedCandidates.length > 0
				? linkedCandidates
				: derivedBase && derivedBase !== linkedBase
					? (byName.get(derivedBase) ?? [])
					: [];
		if (candidates.length === 1) {
			attach(candidates[0]!.path, file);
			continue;
		}
		if (candidates.length > 1) {
			for (const candidate of candidates) markAmbiguous(candidate.path);
			unmatchedFiles.push(file.path);
			continue;
		}

		unmatchedFiles.push(file.path);
	}

	for (const [customerPath, customerFiles] of matched) {
		const emails = customerFiles.flatMap((file) => file.emails);
		const info = summarizeGeneration(emails, true);
		let best: { path: string; ms: number } | null = null;
		for (const file of customerFiles) {
			const summary = summarizeGeneration(file.emails, true);
			if (summary.lastGeneratedMs === null) continue;
			if (!best || summary.lastGeneratedMs > best.ms) {
				best = { path: file.path, ms: summary.lastGeneratedMs };
			}
		}
		info.filePath = best?.path ?? customerFiles[0]?.path ?? null;
		byCustomer.set(customerPath, info);
	}

	return { byCustomer, unmatchedFiles };
}

// --------------------------------------------------------------------- filter

export function normalizeGenerationFilter(value: unknown): GenerationFilter {
	const fallback: GenerationFilter = {
		mode: "off",
		days: 1,
		includeNever: true,
	};
	if (typeof value !== "object" || value === null) return fallback;
	const record = value as Record<string, unknown>;
	const mode = GENERATION_MODES.includes(record.mode as GenerationFilterMode)
		? (record.mode as GenerationFilterMode)
		: fallback.mode;
	const rawDays = Number(record.days);
	const days =
		Number.isFinite(rawDays) && rawDays > 0
			? Math.min(rawDays, 3650)
			: fallback.days;
	const includeNever =
		typeof record.includeNever === "boolean"
			? record.includeNever
			: fallback.includeNever;
	return { mode, days, includeNever };
}

function windowMsOf(filter: GenerationFilter): number {
	const days = Number.isFinite(filter.days) && filter.days > 0 ? filter.days : 1;
	return days * DAY_MS;
}

/** 「从未 / 只有已拒绝」：没有任何有效生成事实。 */
export function isNeverGeneration(
	info: CustomerGeneration | undefined,
): boolean {
	if (!info) return true;
	if (info.state === "never") return true;
	return info.state === "known" && info.allRejected;
}

export function matchesGenerationFilter(
	info: CustomerGeneration | undefined,
	filter: GenerationFilter,
	now: Date,
): boolean {
	if (filter.mode === "off") return true;
	const nowMs = now.getTime();
	const windowMs = windowMsOf(filter);
	if (filter.mode === "never") return isNeverGeneration(info);
	if (filter.mode === "fresh") {
		if (!info || info.state !== "known") return false;
		if (info.lastGeneratedMs === null) return false;
		return nowMs - info.lastGeneratedMs < windowMs;
	}
	// stale
	if (isNeverGeneration(info)) return filter.includeNever;
	if (!info || info.state !== "known" || info.lastGeneratedMs === null) {
		// 未知状态永远不参与「未生成」筛选。
		return false;
	}
	return nowMs - info.lastGeneratedMs >= windowMs;
}

/**
 * 生成前冷却判断。
 *
 * 锚点取 `max(AI 文件的最近生成时间, 上次「已生成」尝试的时间)`，
 * 这样 AI 文件被删/损坏时仍能拦住短时间内的重复生成。
 * 未来时间（系统时间被调早）按放行处理，避免长期锁死。
 */
export function withinCooldown(
	info: CustomerGeneration | undefined,
	now: Date,
	hours: number,
	fallbackMs?: number | null,
): boolean {
	if (!Number.isFinite(hours) || hours <= 0) return false;
	const candidates: number[] = [];
	if (info?.lastGeneratedMs !== null && info?.lastGeneratedMs !== undefined) {
		candidates.push(info.lastGeneratedMs);
	}
	if (typeof fallbackMs === "number" && Number.isFinite(fallbackMs)) {
		candidates.push(fallbackMs);
	}
	if (candidates.length === 0) return false;
	const anchor = Math.max(...candidates);
	const age = now.getTime() - anchor;
	if (age < 0) return false;
	return age < hours * HOUR_MS;
}

// ------------------------------------------------------------------- display

export function formatElapsed(ms: number, now: Date): string {
	const delta = Math.max(0, now.getTime() - ms);
	if (delta < MINUTE_MS) return "刚刚";
	const minutes = Math.floor(delta / MINUTE_MS);
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.floor(delta / HOUR_MS);
	if (hours < 24) return `${hours} 小时前`;
	if (hours < 48) return "昨天";
	const days = Math.floor(delta / DAY_MS);
	if (days < 30) return `${days} 天前`;
	return formatDateOnly(ms);
}

export function formatGenerationAge(
	info: CustomerGeneration | undefined,
	now: Date,
): string {
	if (!info || info.state === "never") return "从未";
	if (info.state === "unknown") return "未知";
	if (info.lastGeneratedMs !== null) {
		return formatElapsed(info.lastGeneratedMs, now);
	}
	if (info.allRejected) return "已拒绝";
	return "未知";
}

export function generationTooltip(
	info: CustomerGeneration | undefined,
): string {
	if (!info || info.state === "never") return "从未生成开发邮件";
	if (info.state === "unknown") {
		return "AI 开发信息文件存在，但无法解析出邮件块";
	}
	const lines: string[] = [];
	if (info.lastGeneratedMs !== null) {
		lines.push(`最近生成：${formatGenerationDate(info.lastGeneratedMs)}`);
	}
	if (info.allRejected) {
		lines.push(`全部 ${info.totalEmailCount} 封邮件已拒绝`);
	} else if (info.totalEmailCount > 0) {
		lines.push(`有效 ${info.emailCount} 封 / 共 ${info.totalEmailCount} 封`);
	} else {
		lines.push("AI 开发信息文件里没有邮件块");
	}
	if (info.pendingCount > 0) lines.push(`待审 ${info.pendingCount} 封`);
	return lines.join("\n");
}

/** 兼容旧名字：tooltip 的生成部分。 */
export function formatGenerationTitle(
	info: CustomerGeneration | undefined,
): string {
	return generationTooltip(info);
}

function formatDays(days: number): string {
	return Number.isInteger(days) ? String(days) : String(Math.round(days * 100) / 100);
}

export function describeGenerationFilter(filter: GenerationFilter): string {
	switch (filter.mode) {
		case "stale":
			return `≥${formatDays(filter.days)} 天未生成${filter.includeNever ? "（含从未生成）" : ""}`;
		case "fresh":
			return `${formatDays(filter.days)} 天内生成过`;
		case "never":
			return "从未生成";
		case "off":
		default:
			return "不限";
	}
}

// ------------------------------------------------------------- customer input

export function customerGenerationInput(
	record: CustomerRecord,
	linkPropertyName: string,
): GenerationCustomerInput {
	const linked = parseSingleWikilink(record.fm[linkPropertyName]);
	const linkedAIPaths: string[] = [];
	if (linked) {
		const target = pathToLinkTarget(linked).trim();
		if (target) linkedAIPaths.push(target);
	}
	return { path: record.path, name: record.name, linkedAIPaths };
}
