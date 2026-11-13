/**
 * AI 请求日志。
 *
 * 记录每次真正发出的 AI 请求：完整系统提示词、用户提示词、模型参数、
 * HTTP 状态、原始返回、耗时与错误。设置页「AI 请求日志」直接读它，
 * 用户可据此核对「插件到底让 AI 写了什么」。
 *
 * 纯数据逻辑，禁止 import "obsidian"。
 */

/** 内存与设置页里最多保留的条数；磁盘文件在读取时也会按这个上限裁剪。 */
export const AI_LOG_MAX_ENTRIES = 50;

/** 相对于输出目录的日志文件位置，与 `.state/` 下的其他诊断文件放在一起。 */
export const AI_LOG_STATE_DIR = ".state";
export const AI_LOG_FILE_NAME = "ai-log.jsonl";

export type AILogKind =
	| "email"
	| "email-repair"
	| "regenerate"
	| "rule";

export type AILogStatus = "ok" | "error" | "canceled";

export interface AILogUsage {
	promptTokens: number | null;
	completionTokens: number | null;
	totalTokens: number | null;
}

export interface AILogRequest {
	url: string;
	method: string;
	model: string;
	temperature: number | null;
	responseFormat: string | null;
	stream: boolean;
	/** 实际发给 AI 的系统提示词，完整保留。 */
	system: string;
	/** 实际发给 AI 的用户提示词，完整保留。 */
	user: string;
	systemChars: number;
	userChars: number;
	totalChars: number;
}

export interface AILogResponse {
	/** HTTP 状态码；请求还没发出去就失败时为 null。 */
	status: number | null;
	/** 从 choices[0].message.content 取出的内容。 */
	content: string | null;
	finishReason: string | null;
	usage: AILogUsage | null;
	/** 接口返回的原始响应体；解析失败时也能看出服务端说了什么。 */
	rawBody: string | null;
	error: string | null;
}

export interface AILogEntry {
	id: string;
	/** 请求开始时间，带本地时区偏移。 */
	at: string;
	finishedAt: string;
	durationMs: number;
	attempt: number;
	maxAttempts: number;
	kind: AILogKind;
	/** 面向用户的标题，例如「客户名 · 生成开发邮件」。 */
	label: string;
	customerName: string | null;
	customerPath: string | null;
	status: AILogStatus;
	request: AILogRequest;
	response: AILogResponse;
}

export interface AILogEntryInput {
	id: string;
	at: string;
	finishedAt?: string;
	durationMs: number;
	attempt?: number;
	maxAttempts?: number;
	kind: AILogKind;
	label: string;
	customerName?: string | null;
	customerPath?: string | null;
	status: AILogStatus;
	request: {
		url: string;
		method?: string;
		model: string;
		temperature?: number | null;
		responseFormat?: string | null;
		stream?: boolean;
		system: string;
		user: string;
	};
	response?: Partial<AILogResponse> | null;
}

function emptyUsage(): AILogUsage {
	return {
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
	};
}

function normalizeUsage(value: unknown): AILogUsage | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const usage = emptyUsage();
	let found = false;
	for (const [key, target] of [
		["promptTokens", "promptTokens"],
		["completionTokens", "completionTokens"],
		["totalTokens", "totalTokens"],
	] as const) {
		const number = record[key];
		if (typeof number === "number" && Number.isFinite(number)) {
			usage[target] = number;
			found = true;
		}
	}
	return found ? usage : null;
}

function normalizeResponse(value: Partial<AILogResponse> | null | undefined): AILogResponse {
	const record = (value ?? {}) as Record<string, unknown>;
	const stringOrNull = (input: unknown): string | null =>
		typeof input === "string" ? input : null;
	return {
		status:
			typeof record.status === "number" && Number.isFinite(record.status)
				? record.status
				: null,
		content: stringOrNull(record.content),
		finishReason: stringOrNull(record.finishReason),
		usage: normalizeUsage(record.usage),
		rawBody: stringOrNull(record.rawBody),
		error: stringOrNull(record.error),
	};
}

/** 由请求现场数据组装一条日志；字数在这里统一算，避免各调用方口径不一致。 */
export function createAILogEntry(input: AILogEntryInput): AILogEntry {
	const system = input.request.system ?? "";
	const user = input.request.user ?? "";
	return {
		id: input.id,
		at: input.at,
		finishedAt: input.finishedAt ?? input.at,
		durationMs:
			Number.isFinite(input.durationMs) && input.durationMs >= 0
				? Math.round(input.durationMs)
				: 0,
		attempt: Math.max(1, Math.round(input.attempt ?? 1)),
		maxAttempts: Math.max(1, Math.round(input.maxAttempts ?? 1)),
		kind: input.kind,
		label: input.label.trim() || aiLogKindLabel(input.kind),
		customerName: input.customerName?.trim() || null,
		customerPath: input.customerPath?.trim() || null,
		status: input.status,
		request: {
			url: input.request.url,
			method: input.request.method ?? "POST",
			model: input.request.model,
			temperature:
				typeof input.request.temperature === "number" &&
				Number.isFinite(input.request.temperature)
					? input.request.temperature
					: null,
			responseFormat: input.request.responseFormat ?? null,
			stream: input.request.stream ?? false,
			system,
			user,
			systemChars: system.length,
			userChars: user.length,
			totalChars: system.length + user.length,
		},
		response: normalizeResponse(input.response),
	};
}

function isKind(value: unknown): value is AILogKind {
	return (
		value === "email" ||
		value === "email-repair" ||
		value === "regenerate" ||
		value === "rule"
	);
}

function isStatus(value: unknown): value is AILogStatus {
	return value === "ok" || value === "error" || value === "canceled";
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/**
 * 解析一条日志。文件可能被中断写入或手工改坏，所以这里对每个字段都做
 * 宽松校验：字段缺失用默认值，结构不对返回 null 让调用方跳过这一行。
 */
export function parseAILogEntry(value: unknown): AILogEntry | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	const id = asString(raw.id)?.trim();
	const at = asString(raw.at)?.trim();
	if (!id || !at) return null;

	const requestRaw = raw.request;
	if (!requestRaw || typeof requestRaw !== "object") return null;
	const req = requestRaw as Record<string, unknown>;
	const system = asString(req.system);
	const user = asString(req.user);
	if (system === null || user === null) return null;

	const responseRaw = raw.response;
	const response =
		responseRaw && typeof responseRaw === "object"
			? (responseRaw as Record<string, unknown>)
			: {};

	const status: AILogStatus = isStatus(raw.status) ? raw.status : "error";
	const kind: AILogKind = isKind(raw.kind) ? raw.kind : "email";
	const duration = Number(raw.durationMs);
	const attempt = Number(raw.attempt);
	const maxAttempts = Number(raw.maxAttempts);

	return createAILogEntry({
		id,
		at,
		finishedAt: asString(raw.finishedAt) ?? at,
		durationMs: Number.isFinite(duration) ? duration : 0,
		attempt: Number.isFinite(attempt) ? attempt : 1,
		maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : 1,
		kind,
		label: asString(raw.label)?.trim() || aiLogKindLabel(kind),
		customerName: asString(raw.customerName),
		customerPath: asString(raw.customerPath),
		status,
		request: {
			url: asString(req.url) ?? "",
			method: asString(req.method) ?? "POST",
			model: asString(req.model) ?? "",
			temperature:
				typeof req.temperature === "number" && Number.isFinite(req.temperature)
					? req.temperature
					: null,
			responseFormat: asString(req.responseFormat),
			stream: req.stream === true,
			system,
			user,
		},
		response: {
			status:
				typeof response.status === "number" &&
				Number.isFinite(response.status)
					? response.status
					: null,
			content: asString(response.content),
			finishReason: asString(response.finishReason),
			usage: normalizeUsage(response.usage),
			rawBody: asString(response.rawBody),
			error: asString(response.error),
		},
	});
}

/** 每个条目一行 JSONL；坏行跳过，不让一条损坏记录拖垮整份日志。 */
export function parseAILogLines(text: string): AILogEntry[] {
	const entries: AILogEntry[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const entry = parseAILogEntry(parsed);
		if (entry) entries.push(entry);
	}
	return entries;
}

export function serializeAILogEntry(entry: AILogEntry): string {
	return JSON.stringify(entry);
}

/** 只保留最近的条目；入参按时间从旧到新排列。 */
export function trimAILog(
	entries: AILogEntry[],
	limit: number = AI_LOG_MAX_ENTRIES,
): AILogEntry[] {
	const cap = Math.max(1, Math.round(limit));
	return entries.length > cap ? entries.slice(entries.length - cap) : entries.slice();
}

export function aiLogKindLabel(kind: AILogKind): string {
	switch (kind) {
		case "email":
			return "生成开发邮件";
		case "email-repair":
			return "校验失败后自动修复";
		case "regenerate":
			return "重新生成邮件";
		case "rule":
			return "提炼经验规则";
	}
}

export function aiLogStatusLabel(status: AILogStatus): string {
	switch (status) {
		case "ok":
			return "成功";
		case "error":
			return "失败";
		case "canceled":
			return "已取消";
	}
}

export function formatAILogDuration(durationMs: number): string {
	if (!Number.isFinite(durationMs) || durationMs < 0) return "—";
	if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
	return `${(durationMs / 1000).toFixed(1)} 秒`;
}

/** ISO 时间 → `2026-11-13 14:22:31`；保留原字符串里的本地时间。 */
export function formatAILogTime(at: string): string {
	const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(at);
	return match ? `${match[1]} ${match[2]}` : at;
}

function thousands(value: number): string {
	return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function section(title: string, content: string | null | undefined): string | null {
	if (content === null || content === undefined || content === "") return null;
	return `----- ${title} -----\n${content}`;
}

/** 单条日志的完整纯文本，用于复制给他人或在控制台里查看。 */
export function formatAILogEntry(entry: AILogEntry): string {
	const request = entry.request;
	const response = entry.response;
	const lines: string[] = [];
	lines.push(
		`记录：${entry.label}`,
		`时间：${formatAILogTime(entry.at)}（${entry.at}）`,
		`状态：${aiLogStatusLabel(entry.status)} · 耗时 ${formatAILogDuration(entry.durationMs)}`,
		`类型：${aiLogKindLabel(entry.kind)}`,
	);
	if (entry.customerName) lines.push(`客户：${entry.customerName}`);
	if (entry.customerPath) lines.push(`客户文件：${entry.customerPath}`);
	lines.push(
		`尝试：第 ${entry.attempt} / ${entry.maxAttempts} 次`,
		`模型：${request.model || "（未设置）"}`,
		`接口：${request.method} ${request.url || "（未设置）"}`,
		`参数：temperature=${request.temperature ?? "—"} · response_format=${request.responseFormat ?? "—"} · stream=${request.stream}`,
		`提示词：系统 ${thousands(request.systemChars)} 字 + 用户 ${thousands(request.userChars)} 字 = ${thousands(request.totalChars)} 字`,
	);
	if (response.status !== null) lines.push(`HTTP 状态：${response.status}`);
	if (response.finishReason) lines.push(`finish_reason：${response.finishReason}`);
	if (response.usage) {
		const usage = response.usage;
		lines.push(
			`tokens：prompt ${usage.promptTokens ?? "—"} / completion ${usage.completionTokens ?? "—"} / total ${usage.totalTokens ?? "—"}`,
		);
	}
	if (response.error) lines.push(`错误：${response.error}`);

	const parts = [lines.join("\n")];
	for (const block of [
		section("系统提示词", request.system),
		section("用户提示词", request.user),
		section("AI 返回内容", response.content),
		section("原始响应体", response.rawBody),
	]) {
		if (block) parts.push(block);
	}
	return parts.join("\n\n");
}

/** 多条日志的纯文本；入参约定为「最新在前」。 */
export function formatAILogEntries(entries: AILogEntry[]): string {
	if (entries.length === 0) return "（没有 AI 请求日志）";
	const header = `Email Outreach · AI 请求日志（共 ${entries.length} 条，最新在前）`;
	const body = entries
		.map((entry, index) => `#${index + 1}\n${formatAILogEntry(entry)}`)
		.join(`\n\n${"=".repeat(64)}\n\n`);
	return `${header}\n\n${body}`;
}
