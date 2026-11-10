import {
	isKnownLanguage,
	isPlausibleLanguageCode,
	languageLabel,
} from "./language";
import { summaryWarnings } from "./summary";
import type {
	AnalysisResult,
	ContactPriority,
	EmailDraft,
	LanguageSuggestion,
} from "./types";

export type AIRequestMode = "analysis" | "email";

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
	analysis: AnalysisResult | null;
	email: EmailDraft | null;
}

const UNKNOWN_FIELDS = [
	"customer_type",
	"opportunity_fit",
	"opportunity_intent",
	"opportunity_potential",
	"risk",
];

const CONFIDENCE_VALUES = new Set(["high", "medium", "low", "unknown"]);

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

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
}

function asScore(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
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

function validateLanguageSuggestion(
	value: unknown,
	warnings: string[],
): LanguageSuggestion | null {
	const record = asRecord(value);
	const code = asString(record.code);
	if (!code) return null;
	const normalized = code.toLowerCase();
	if (!isPlausibleLanguageCode(normalized)) {
		warnings.push(`语言建议代码不合法：${code}`);
		return null;
	}
	const confidenceRaw = asString(record.confidence) ?? "unknown";
	const confidence = CONFIDENCE_VALUES.has(confidenceRaw)
		? (confidenceRaw as LanguageSuggestion["confidence"])
		: "unknown";
	return {
		code: normalized,
		label: asString(record.label) ?? languageLabel(normalized),
		reason: asString(record.reason) ?? "",
		confidence,
	};
}

function validateContactPriority(
	value: unknown,
	ctx: ValidationContext,
	warnings: string[],
): ContactPriority[] {
	if (!Array.isArray(value)) return [];
	const out: ContactPriority[] = [];
	let invalid = 0;
	value.forEach((item, index) => {
		const record = asRecord(item);
		const contactId = asString(record.contact_id) ?? asString(record.contactId);
		if (!contactId || !ctx.contactIds.has(contactId)) {
			invalid++;
			return;
		}
		const rank = asScore(record.rank) ?? index + 1;
		out.push({
			contactId,
			rank,
			reason: asString(record.reason) ?? "",
		});
	});
	if (invalid > 0) {
		warnings.push(`${invalid} 条联系人优先级引用了不存在的联系人，已忽略`);
	}
	return out.sort((a, b) => a.rank - b.rank).map((item) => item);
}

export function validateAIResult(
	raw: unknown,
	ctx: ValidationContext,
	mode: AIRequestMode,
): ValidationResult {
	const errors: ValidationIssue[] = [];
	const warnings: string[] = [];
	const data = asRecord(raw);

	if (!isRecord(raw)) {
		return {
			ok: false,
			errors: [{ field: "$", message: "返回内容不是 JSON 对象" }],
			warnings,
			analysis: null,
			email: null,
		};
	}

	// ---------- analysis section ----------
	const customerType = asString(data.customer_type);
	const fit = asScore(data.opportunity_fit);
	const intent = asScore(data.opportunity_intent);
	const potential = asScore(data.opportunity_potential);
	const risk = asScore(data.risk);
	const riskNotes = asStringArray(data.risk_notes).slice(0, 12);
	const unknownFields = asStringArray(data.unknown_fields).filter((field) =>
		UNKNOWN_FIELDS.includes(field),
	);
	const analysisNotes = asString(data.analysis_notes) ?? "";

	const scoreEntries: [string, number | null][] = [
		["opportunity_fit", fit],
		["opportunity_intent", intent],
		["opportunity_potential", potential],
		["risk", risk],
	];
	for (const [field, value] of scoreEntries) {
		if (value === null) continue;
		if (value < 1 || value > 10) {
			errors.push({
				field,
				message: `评分必须在 1–10 之间，收到 ${value}`,
			});
		}
		if (unknownFields.includes(field)) {
			warnings.push(`${field} 同时给出了数值和“未确定”标记，已按未确定处理`);
		}
	}

	if (customerType && customerType.length > 120) {
		warnings.push("customer_type 过长，已截断到 120 字");
	}

	const safeFit = unknownFields.includes("opportunity_fit") ? null : fit;
	const safeIntent = unknownFields.includes("opportunity_intent") ? null : intent;
	const safePotential = unknownFields.includes("opportunity_potential")
		? null
		: potential;
	const safeRisk = unknownFields.includes("risk") ? null : risk;

	const contactPriority = validateContactPriority(
		data.contact_priority,
		ctx,
		warnings,
	);
	let recommendedContactId =
		asString(data.recommended_contact_id) ??
		asString(data.recommendedContactId) ??
		null;
	if (recommendedContactId && !ctx.contactIds.has(recommendedContactId)) {
		errors.push({
			field: "recommended_contact_id",
			message: `推荐联系人 ${recommendedContactId} 不在该客户联系人列表中`,
		});
		recommendedContactId = null;
	}

	const analysis: AnalysisResult = {
		customerType: customerType ? customerType.slice(0, 120) : null,
		fit: safeFit,
		intent: safeIntent,
		potential: safePotential,
		risk: safeRisk,
		riskNotes,
		unknownFields,
		analysisNotes,
		contactPriority,
		recommendedContactId,
		languageSuggestion: validateLanguageSuggestion(
			data.language_suggestion,
			warnings,
		),
	};

	const hasAnalysisValue =
		analysis.customerType !== null ||
		analysis.fit !== null ||
		analysis.intent !== null ||
		analysis.potential !== null ||
		analysis.risk !== null ||
		analysis.contactPriority.length > 0;

	if (mode === "analysis" && !hasAnalysisValue) {
		errors.push({
			field: "$",
			message: "没有返回任何可用的分析字段",
		});
	}

	// ---------- email section ----------
	const emailsRaw = Array.isArray(data.emails) ? data.emails : [];
	if (emailsRaw.length > 1) {
		warnings.push(`返回了 ${emailsRaw.length} 封邮件，只采用第一封`);
	}

	let email: EmailDraft | null = null;
	if (mode === "email" || emailsRaw.length > 0) {
		const emailRaw = asRecord(emailsRaw[0]);
		if (Object.keys(emailRaw).length === 0) {
			errors.push({ field: "emails", message: "没有返回邮件内容" });
		} else {
			const contactId =
				asString(emailRaw.contact_id) ?? asString(emailRaw.contactId);
			if (!contactId || !ctx.contactIds.has(contactId)) {
				errors.push({
					field: "emails[0].contact_id",
					message: "邮件收件人不在该客户联系人列表中",
				});
			} else {
				const localEmails = ctx.contactEmails.get(contactId) ?? [];
				if (localEmails.length === 0) {
					errors.push({
						field: "emails[0].contact_id",
						message: `联系人 ${contactId} 没有可用邮箱`,
					});
				}
				const claimedEmail =
					asString(emailRaw.email) ?? asString(emailRaw.to);
				if (claimedEmail) {
					const matches = localEmails.some(
						(address) =>
							address.toLowerCase() === claimedEmail.toLowerCase(),
					);
					if (!matches) {
						errors.push({
							field: "emails[0].email",
							message: `AI 返回的邮箱与本地联系人资料不一致：${claimedEmail}`,
						});
					}
				}

				const languageRaw = asString(emailRaw.language);
				const language = (languageRaw ?? "").toLowerCase();
				if (!language) {
					errors.push({
						field: "emails[0].language",
						message: "缺少邮件语言",
					});
				} else if (!isPlausibleLanguageCode(language)) {
					errors.push({
						field: "emails[0].language",
						message: `邮件语言代码不合法：${language}`,
					});
				} else if (!isKnownLanguage(language)) {
					warnings.push(`邮件语言 ${language} 不在内置语言表中`);
				}

				let subject = asString(emailRaw.subject) ?? "";
				if (!subject) {
					errors.push({
						field: "emails[0].subject",
						message: "缺少邮件主题",
					});
				} else {
					if (/[\r\n]/.test(subject)) {
						warnings.push("Subject 包含换行，已合并为一行");
						subject = subject.replace(/\s*[\r\n]+\s*/g, " ").trim();
					}
					if (subject.length > 250) {
						warnings.push("Subject 超过 250 字，已截断");
						subject = subject.slice(0, 250).trim();
					}
				}

				let body = asString(emailRaw.body) ?? "";
				body = body.replace(/\r\n?/g, "\n");
				if (!body) {
					errors.push({
						field: "emails[0].body",
						message: "缺少邮件正文",
					});
				} else if (body.length > ctx.maxBodyChars) {
					errors.push({
						field: "emails[0].body",
						message: `邮件正文超过 ${ctx.maxBodyChars} 字上限`,
					});
				}

				const summary =
					asString(emailRaw.email_summary_zh) ??
					asString(emailRaw.emailSummaryZh) ??
					"";
				if (!summary) {
					errors.push({
						field: "emails[0].email_summary_zh",
						message: "缺少中文摘要",
					});
				} else {
					warnings.push(...summaryWarnings(summary, subject));
				}

				const suggestedSendTime =
					asString(emailRaw.suggested_send_time_local) ??
					asString(emailRaw.suggested_send_time) ??
					null;
				const timezone = asString(emailRaw.timezone);
				const timeReason =
					asString(emailRaw.time_reason) ??
					asString(emailRaw.timeReason) ??
					null;

				if (suggestedSendTime) {
					const timePattern = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$/;
					if (!timePattern.test(suggestedSendTime)) {
						warnings.push(
							`建议发送时间格式不标准：${suggestedSendTime}`,
						);
					}
				}
				if (timezone) {
					const timezonePattern = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+\-/]+)+$/;
					if (!timezonePattern.test(timezone)) {
						warnings.push(`时区格式不标准：${timezone}`);
					}
				}

				if (subject && body && summary) {
					email = {
						contactId,
						language,
						emailSummaryZh: summary,
						subject,
						body,
						suggestedSendTime,
						timezone,
						timeReason,
					};
				}
			}
		}
	}

	return {
		ok: errors.length === 0,
		errors,
		warnings,
		analysis,
		email,
	};
}
