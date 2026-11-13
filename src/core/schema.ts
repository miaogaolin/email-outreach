import {
	isKnownLanguage,
	isPlausibleLanguageCode,
} from "./language";
import { summaryWarnings } from "./summary";
import type { EmailDraft } from "./types";
import { MAX_EMAILS_PER_CUSTOMER } from "./types";

export interface ValidationContext {
	contactIds: Set<string>;
	contactEmails: Map<string, string[]>;
	maxBodyChars: number;
}

export interface ValidationIssue {
	field: string;
	message: string;
}

export interface ValidationResult {
	ok: boolean;
	errors: ValidationIssue[];
	warnings: string[];
	emails: EmailDraft[];
	noSuitableContactReason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function asString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}

function extractJsonObject(text: string): string | null {
	let body = text.trim();
	const fenced = body.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
	if (fenced && fenced[1]) body = fenced[1].trim();
	const start = body.indexOf("{");
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < body.length; i++) {
		const char = body[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === "{") depth++;
		else if (char === "}") {
			depth--;
			if (depth === 0) return body.slice(start, i + 1);
		}
	}
	return null;
}

export function parseJsonLoose(text: string): unknown {
	const candidate = extractJsonObject(text);
	if (!candidate) return null;
	try {
		return JSON.parse(candidate);
	} catch {
		return null;
	}
}

interface DraftParseResult {
	draft: EmailDraft | null;
	issues: ValidationIssue[];
	warnings: string[];
}

function parseEmailDraft(
	value: unknown,
	index: number,
	ctx: ValidationContext,
	seenContacts: Set<string>,
	seenEmails: Set<string>,
): DraftParseResult {
	const field = `emails[${index}]`;
	const issues: ValidationIssue[] = [];
	const warnings: string[] = [];
	const emailRaw = asRecord(value);
	if (Object.keys(emailRaw).length === 0) {
		issues.push({ field, message: "邮件条目不是对象" });
		return { draft: null, issues, warnings };
	}

	const contactId =
		asString(emailRaw.contact_id) ?? asString(emailRaw.contactId);
	if (!contactId || !ctx.contactIds.has(contactId)) {
		issues.push({
			field: `${field}.contact_id`,
			message: `收件人 ${contactId ?? "（空）"} 不在该客户联系人列表中`,
		});
		return { draft: null, issues, warnings };
	}
	const localEmails = ctx.contactEmails.get(contactId) ?? [];
	if (localEmails.length === 0) {
		issues.push({
			field: `${field}.contact_id`,
			message: `联系人 ${contactId} 没有可用邮箱`,
		});
		return { draft: null, issues, warnings };
	}
	const claimedEmail =
		asString(emailRaw.email) ?? asString(emailRaw.to);
	if (claimedEmail) {
		const matches = localEmails.some(
			(address) => address.toLowerCase() === claimedEmail.toLowerCase(),
		);
		if (!matches) {
			issues.push({
				field: `${field}.email`,
				message: `AI 返回的邮箱与本地联系人资料不一致：${claimedEmail}`,
			});
			return { draft: null, issues, warnings };
		}
	}
	const normalizedEmail = localEmails[0]!.toLowerCase();
	if (seenContacts.has(contactId)) {
		warnings.push(`联系人 ${contactId} 重复返回，只保留第一封`);
		return { draft: null, issues, warnings };
	}
	if (seenEmails.has(normalizedEmail)) {
		warnings.push(`邮箱 ${localEmails[0]} 重复使用，只保留第一封`);
		return { draft: null, issues, warnings };
	}

	const languageRaw = asString(emailRaw.language);
	const language = (languageRaw ?? "").toLowerCase();
	if (!language) {
		issues.push({ field: `${field}.language`, message: "缺少邮件语言" });
		return { draft: null, issues, warnings };
	}
	if (!isPlausibleLanguageCode(language)) {
		issues.push({
			field: `${field}.language`,
			message: `邮件语言代码不合法：${language}`,
		});
		return { draft: null, issues, warnings };
	}
	if (!isKnownLanguage(language)) {
		warnings.push(`邮件语言 ${language} 不在内置语言表中`);
	}

	let subject = asString(emailRaw.subject) ?? "";
	if (!subject) {
		issues.push({ field: `${field}.subject`, message: "缺少邮件主题" });
		return { draft: null, issues, warnings };
	}
	if (/[\r\n]/.test(subject)) {
		warnings.push(`${field}.subject 包含换行，已合并为一行`);
		subject = subject.replace(/\s*[\r\n]+\s*/g, " ").trim();
	}
	if (subject.length > 250) {
		warnings.push(`${field}.subject 超过 250 字，已截断`);
		subject = subject.slice(0, 250).trim();
	}

	let body = asString(emailRaw.body) ?? "";
	body = body.replace(/\r\n?/g, "\n");
	if (!body) {
		issues.push({ field: `${field}.body`, message: "缺少邮件正文" });
		return { draft: null, issues, warnings };
	}
	if (body.length > ctx.maxBodyChars) {
		issues.push({
			field: `${field}.body`,
			message: `邮件正文超过 ${ctx.maxBodyChars} 字上限`,
		});
		return { draft: null, issues, warnings };
	}

	const summary =
		asString(emailRaw.email_summary_zh) ??
		asString(emailRaw.emailSummaryZh) ??
		"";
	if (!summary) {
		issues.push({
			field: `${field}.email_summary_zh`,
			message: "缺少中文摘要",
		});
		return { draft: null, issues, warnings };
	}
	warnings.push(...summaryWarnings(summary, subject));

	seenContacts.add(contactId);
	seenEmails.add(normalizedEmail);
	return {
		draft: {
			contactId,
			language,
			emailSummaryZh: summary,
			subject,
			body,
		},
		issues,
		warnings,
	};
}

/**
 * 校验 AI 返回。
 *
 * 每封邮件独立校验：非法的那封丢弃并给出 warning，至少一封有效就允许落盘；
 * 如果 AI 返回了非空 emails 却全部非法，则 ok=false，由调用方触发一次修复重试。
 * `emails: []` 是合法结果，表示没有合适联系人。
 */
export function validateAIResult(
	raw: unknown,
	ctx: ValidationContext,
): ValidationResult {
	const errors: ValidationIssue[] = [];
	const warnings: string[] = [];
	const emails: EmailDraft[] = [];
	let noSuitableContactReason: string | null = null;

	if (!isRecord(raw)) {
		return {
			ok: false,
			errors: [{ field: "$", message: "返回内容不是 JSON 对象" }],
			warnings,
			emails,
			noSuitableContactReason,
		};
	}

	const emailsRaw = Array.isArray(raw.emails) ? raw.emails : null;
	if (!emailsRaw) {
		errors.push({ field: "emails", message: "返回内容缺少 emails 数组" });
		return {
			ok: false,
			errors,
			warnings,
			emails,
			noSuitableContactReason,
		};
	}
	if (emailsRaw.length > MAX_EMAILS_PER_CUSTOMER) {
		warnings.push(
			`返回了 ${emailsRaw.length} 封邮件，只采用前 ${MAX_EMAILS_PER_CUSTOMER} 封`,
		);
	}

	const seenContacts = new Set<string>();
	const seenEmails = new Set<string>();
	const slice = emailsRaw.slice(0, MAX_EMAILS_PER_CUSTOMER);
	slice.forEach((item, index) => {
		const parsed = parseEmailDraft(
			item,
			index,
			ctx,
			seenContacts,
			seenEmails,
		);
		warnings.push(...parsed.warnings);
		if (parsed.draft) {
			emails.push(parsed.draft);
			return;
		}
		for (const issue of parsed.issues) {
			warnings.push(`${issue.field}：${issue.message}，已跳过这封邮件`);
		}
	});

	if (slice.length > 0 && emails.length === 0) {
		errors.push({
			field: "emails",
			message: "返回的邮件全部未通过校验",
		});
	}

	if (emailsRaw.length === 0) {
		noSuitableContactReason =
			asString(raw.no_suitable_contact_reason) ??
			asString(raw.noSuitableContactReason);
		if (!noSuitableContactReason) {
			warnings.push("AI 没有说明没有合适联系人的原因，已使用默认提示");
			noSuitableContactReason = "AI 未找到适合发送开发邮件的联系人";
		}
		noSuitableContactReason = noSuitableContactReason.slice(0, 300);
	}

	return {
		ok: errors.length === 0,
		errors,
		warnings,
		emails,
		noSuitableContactReason,
	};
}
