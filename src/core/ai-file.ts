import { isoNow, shortStamp } from "./filenames";
import { parseSingleWikilink } from "./wikilinks";
import type {
	AnalysisRecord,
	AnalysisResult,
	CustomerAIFile,
	EmailRecord,
	EmailStatus,
	EmailVersion,
} from "./types";
import { EMAIL_STATUSES } from "./types";

export interface ParsedEmailBlock {
	record: EmailRecord;
	startLine: number;
	endLine: number;
}

export interface ParsedAIFile {
	file: CustomerAIFile;
	blocks: ParsedEmailBlock[];
}

const EMAIL_HEADING_RE =
	/^###\s+邮件\s+([0-9A-Za-z_-]+)\s*·\s*(.*)\s*·\s*(Generated|Revision|Accepted|Rejected)\s*$/;
const VERSION_HEADING_RE = /^#####\s+v(\d+)\s*·\s*(.*)$/;
const META_RE = /^-\s+([A-Za-z_][\w]*)\s*:\s?(.*)$/;
const SECTION_RE = /^####\s+(Subject|Body|修改历史)\s*$/;
const H2_RE = /^##\s+/;

export function emptyCustomerAIFile(customerLink: string): CustomerAIFile {
	return {
		customerLink,
		updated: isoNow(),
		emailCount: 0,
		lastStatus: "",
		analysis: null,
		analysisHistory: [],
		emails: [],
		extraFrontmatter: {},
		trailing: "",
		warnings: [],
	};
}

function splitLines(content: string): string[] {
	return content.replace(/\r\n?/g, "\n").split("\n");
}

function isHeading2(line: string): boolean {
	return /^##\s+/.test(line);
}

function isHeading3(line: string): boolean {
	return /^###\s+/.test(line);
}

function isHeading4(line: string): boolean {
	return /^####\s+/.test(line);
}

function stripQuotes(value: string): string {
	let result = value.trim();
	if (
		(result.startsWith('"') && result.endsWith('"')) ||
		(result.startsWith("'") && result.endsWith("'"))
	) {
		result = result.slice(1, -1);
	}
	return result.replace(/\\"/g, '"');
}

function parseFrontmatter(
	lines: string[],
	warnings: string[],
): { frontmatter: Record<string, string>; bodyStart: number } {
	const frontmatter: Record<string, string> = {};
	if ((lines[0] ?? "").trim() !== "---") {
		return { frontmatter, bodyStart: 0 };
	}
	let end = -1;
	for (let i = 1; i < lines.length; i++) {
		if ((lines[i] ?? "").trim() === "---") {
			end = i;
			break;
		}
	}
	if (end < 0) {
		warnings.push("AI 文件 frontmatter 没有闭合的 ---");
		return { frontmatter, bodyStart: 0 };
	}
	for (let i = 1; i < end; i++) {
		const line = lines[i] ?? "";
		const match = line.match(/^([^:\s][^:]*):\s?(.*)$/);
		if (!match) continue;
		frontmatter[(match[1] ?? "").trim()] = stripQuotes(match[2] ?? "");
	}
	return { frontmatter, bodyStart: end + 1 };
}

function parseAnalysis(
	lines: string[],
	warnings: string[],
): { analysis: AnalysisRecord | null; history: string[] } {
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^##\s+AI\s*分析\s*$/.test(lines[i] ?? "")) {
			start = i + 1;
			break;
		}
	}
	if (start < 0) return { analysis: null, history: [] };

	let end = lines.length;
	for (let i = start; i < lines.length; i++) {
		if (isHeading2(lines[i] ?? "")) {
			end = i;
			break;
		}
	}

	const parseScore = (text: string): number | null => {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const value = Number(trimmed);
		return Number.isFinite(value) ? value : null;
	};

	let customerType: string | null = null;
	let fit: number | null = null;
	let intent: number | null = null;
	let potential: number | null = null;
	let risk: number | null = null;
	const riskNotes: string[] = [];
	const unknownFields: string[] = [];
	let notes = "";
	const history: string[] = [];
	let sawAny = false;
	let inRiskNotes = false;
	let inHistory = false;

	for (let i = start; i < end; i++) {
		const raw = lines[i] ?? "";
		const line = raw.trim();
		if (!line) {
			inRiskNotes = false;
			continue;
		}
		if (/^###\s+分析历史\s*$/.test(line)) {
			inHistory = true;
			inRiskNotes = false;
			continue;
		}
		if (/^###\s+/.test(line)) {
			inHistory = false;
			inRiskNotes = false;
			continue;
		}
		if (inHistory) {
			if (line.startsWith("- ")) {
				history.push(line.slice(2).trim());
			}
			continue;
		}
		if (line.startsWith("- 客户类型:")) {
			sawAny = true;
			const value = line.slice("- 客户类型:".length).trim();
			customerType = value || null;
			continue;
		}
		const numberMatch = line.match(/^-\s+(fit|indent|potential|risk)\s*:\s*(.*)$/);
		if (numberMatch) {
			sawAny = true;
			const key = numberMatch[1];
			const parsed = parseScore(numberMatch[2] ?? "");
			if (key === "fit") fit = parsed;
			if (key === "indent") intent = parsed;
			if (key === "potential") potential = parsed;
			if (key === "risk") risk = parsed;
			inRiskNotes = false;
			continue;
		}
		if (line === "- 风险说明:" || line.startsWith("- 风险说明:")) {
			sawAny = true;
			inRiskNotes = true;
			const inline = line.slice("- 风险说明:".length).trim();
			if (inline) riskNotes.push(inline);
			continue;
		}
		if (inRiskNotes && /^-\s+/.test(line)) {
			if (
				line.startsWith("- 未确定字段:") ||
				line.startsWith("- 分析备注:") ||
				line.startsWith("- 客户类型:")
			) {
				// fall through to the dedicated branches below
			} else {
				riskNotes.push(line.slice(1).trim());
				continue;
			}
		}
		if (line.startsWith("- 未确定字段:")) {
			sawAny = true;
			const value = line.slice("- 未确定字段:".length).trim();
			unknownFields.push(
				...value
					.split(/[,，、]/)
					.map((item) => item.trim())
					.filter(Boolean),
			);
			inRiskNotes = false;
			continue;
		}
		if (line.startsWith("- 分析备注:")) {
			sawAny = true;
			notes = line.slice("- 分析备注:".length).trim();
			inRiskNotes = false;
			continue;
		}
		if (line.startsWith("- ")) {
			// Unknown analysis bullet, keep it as a note so nothing is lost.
			warnings.push(`AI 分析区段中有未识别条目：${line}`);
		}
	}

	if (!sawAny) return { analysis: null, history };
	return {
		analysis: {
			customerType,
			fit,
			intent,
			potential,
			risk,
			riskNotes,
			unknownFields,
			notes,
		},
		history,
	};
}

function readFencedBlock(
	lines: string[],
	startIndex: number,
): { text: string; nextIndex: number } | null {
	let index = startIndex;
	while (index < lines.length && !(lines[index] ?? "").trim()) index++;
	const fenceLine = (lines[index] ?? "").trim();
	const fenceMatch = fenceLine.match(/^(`{3,})/);
	if (!fenceMatch) return null;
	const fence = fenceMatch[1] ?? "```";
	const collected: string[] = [];
	index++;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (line.trim().startsWith(fence)) {
			return { text: collected.join("\n"), nextIndex: index + 1 };
		}
		collected.push(line);
		index++;
	}
	return { text: collected.join("\n"), nextIndex: index };
}

function parseVersions(
	lines: string[],
	warnings: string[],
): EmailVersion[] {
	const versions: EmailVersion[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		const heading = line.match(VERSION_HEADING_RE);
		if (!heading) {
			index++;
			continue;
		}
		const version = Number(heading[1] ?? "0") || versions.length + 1;
		const tail = heading[2] ?? "";
		const tailParts = tail.split("·").map((item) => item.trim());
		const at = tailParts[0] ?? "";
		const action = tailParts[1] ?? "Generated";
		index++;
		let userComment = "";
		let subject = "";
		let body = "";
		while (index < lines.length) {
			const current = lines[index] ?? "";
			if (VERSION_HEADING_RE.test(current)) break;
			if (/^####\s/.test(current) || /^###\s/.test(current) || /^##\s/.test(current)) {
				break;
			}
			const commentMatch = current.match(/^-\s+用户意见:\s?(.*)$/);
			if (commentMatch) {
				userComment = (commentMatch[1] ?? "").trim();
				index++;
				continue;
			}
			if (/^-\s+Subject:\s*$/.test(current)) {
				const fenced = readFencedBlock(lines, index + 1);
				if (fenced) {
					subject = fenced.text;
					index = fenced.nextIndex;
				} else {
					index++;
				}
				continue;
			}
			if (/^-\s+Body:\s*$/.test(current)) {
				const fenced = readFencedBlock(lines, index + 1);
				if (fenced) {
					body = fenced.text;
					index = fenced.nextIndex;
				} else {
					index++;
				}
				continue;
			}
			index++;
		}
		if (!subject && !body) {
			warnings.push(`版本 v${version} 缺少 Subject/Body 内容`);
		}
		versions.push({
			version,
			at,
			action,
			userComment,
			subject,
			body,
		});
	}
	return versions;
}

function parseEmailBlock(
	lines: string[],
	start: number,
	end: number,
	warnings: string[],
): EmailRecord | null {
	const heading = lines[start] ?? "";
	const headingMatch = heading.match(EMAIL_HEADING_RE);
	if (!headingMatch) {
		warnings.push(`无法解析邮件标题：${heading}`);
		return null;
	}
	const id = headingMatch[1] ?? "001";
	const headingContact = (headingMatch[2] ?? "").trim();
	const headingStatus = headingMatch[3] as EmailStatus;

	const meta: Record<string, string> = {};
	let index = start + 1;
	while (index < end) {
		const line = (lines[index] ?? "").trim();
		if (isHeading4(line)) break;
		const match = line.match(META_RE);
		if (match) meta[match[1] ?? ""] = (match[2] ?? "").trim();
		index++;
	}

	const sections: { subject: string[]; body: string[]; history: string[] } = {
		subject: [],
		body: [],
		history: [],
	};
	let current: keyof typeof sections | null = null;
	const sectionOffsets: Record<string, number> = {};
	const sectionKeys: Record<string, keyof typeof sections> = {
		Subject: "subject",
		Body: "body",
		修改历史: "history",
	};
	while (index < end) {
		const line = lines[index] ?? "";
		const headingMatch2 = line.match(SECTION_RE);
		if (headingMatch2) {
			const name = headingMatch2[1] ?? "";
			const key = sectionKeys[name];
			if (key) {
				current = key;
				sectionOffsets[key] = index;
			} else {
				current = null;
			}
			index++;
			continue;
		}
		if (/^####\s+/.test(line)) {
			current = null;
			index++;
			continue;
		}
		if (current) sections[current].push(line);
		index++;
	}

	const subject = sections.subject.join("\n").trim();
	const body = sections.body.join("\n").trim();

	const versionsStart = sectionOffsets["history"];
	const versionLines =
		versionsStart !== undefined ? lines.slice(versionsStart + 1, end) : [];
	let versions = parseVersions(versionLines, warnings);
	const storedVersions = Number(meta["versions"] ?? "0");
	if (versions.length === 0 && subject && body) {
		versions = [
			{
				version: 1,
				at: meta["generated_at"] ?? "",
				action: "Generated",
				userComment: "",
				subject,
				body,
			},
		];
	} else if (Number.isFinite(storedVersions) && versions.length < storedVersions) {
		warnings.push(
			`邮件 ${id} 的版本数少于记录值（${versions.length}/${storedVersions}）`,
		);
	}

	const statusRaw = (meta["status"] ?? headingStatus) as EmailStatus;
	const status = EMAIL_STATUSES.includes(statusRaw) ? statusRaw : headingStatus;
	const knownKeys = new Set([
		"contact",
		"email",
		"language",
		"language_label",
		"email_summary_zh",
		"suggested_send_time",
		"timezone",
		"time_reason",
		"status",
		"generated_at",
		"updated_at",
		"sent",
		"sent_at",
		"versions",
	]);
	const extraMeta: Record<string, string> = {};
	for (const [key, value] of Object.entries(meta)) {
		if (!knownKeys.has(key)) extraMeta[key] = value;
	}

	const record: EmailRecord = {
		id,
		contact: meta["contact"] ?? headingContact,
		email: meta["email"] ?? "",
		language: meta["language"] ?? "",
		languageLabel: meta["language_label"] ?? "",
		summaryZh: meta["email_summary_zh"] ?? "",
		suggestedTime: meta["suggested_send_time"] || null,
		timezone: meta["timezone"] || null,
		timeReason: meta["time_reason"] || null,
		status,
		generatedAt: meta["generated_at"] ?? "",
		updatedAt: meta["updated_at"] ?? "",
		sent: (meta["sent"] ?? "").toLowerCase() === "true",
		sentAt: meta["sent_at"] || null,
		subject,
		body,
		versions,
		extraMeta,
	};
	return record;
}

export function parseCustomerAIFile(content: string): ParsedAIFile {
	const lines = splitLines(content);
	const warnings: string[] = [];
	const { frontmatter, bodyStart } = parseFrontmatter(lines, warnings);

	const customerLink = parseSingleWikilink(frontmatter["customer"]) ?? "";
	const extraFrontmatter: Record<string, string> = {};
	const knownFrontmatter = new Set([
		"type",
		"customer",
		"updated",
		"email_count",
		"last_status",
	]);
	for (const [key, value] of Object.entries(frontmatter)) {
		if (!knownFrontmatter.has(key)) extraFrontmatter[key] = value;
	}

	const bodyLines = lines.slice(bodyStart);
	const { analysis, history } = parseAnalysis(bodyLines, warnings);

	// Locate the email section.
	let mailStart = -1;
	for (let i = 0; i < bodyLines.length; i++) {
		if (/^##\s+邮件\s*$/.test(bodyLines[i] ?? "")) {
			mailStart = i + 1;
			break;
		}
	}

	const emails: EmailRecord[] = [];
	const blocks: ParsedEmailBlock[] = [];
	let trailing = "";
	if (mailStart >= 0) {
		let i = mailStart;
		while (i < bodyLines.length) {
			const line = bodyLines[i] ?? "";
			if (isHeading3(line) && EMAIL_HEADING_RE.test(line)) {
				let end = i + 1;
				while (end < bodyLines.length) {
					const candidate = bodyLines[end] ?? "";
					if (isHeading2(candidate) || (isHeading3(candidate) && EMAIL_HEADING_RE.test(candidate))) {
						break;
					}
					end++;
				}
				const record = parseEmailBlock(bodyLines, i, end, warnings);
				if (record) {
					emails.push(record);
					blocks.push({ record, startLine: bodyStart + i, endLine: bodyStart + end });
				}
				i = end;
				continue;
			}
			if (isHeading2(line)) {
				trailing = bodyLines.slice(i).join("\n").trim();
				break;
			}
			i++;
		}
	}

	const lastStatus = emails.length > 0 ? (emails[emails.length - 1]?.status ?? "") : "";

	return {
		file: {
			customerLink,
			updated: frontmatter["updated"] ?? "",
			emailCount: emails.length,
			lastStatus,
			analysis,
			analysisHistory: history,
			emails,
			extraFrontmatter,
			trailing,
			warnings,
		},
		blocks,
	};
}

function sanitizeMetaValue(value: string | null | undefined): string {
	if (!value) return "";
	return value.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

function renderAnalysis(analysis: AnalysisRecord | null, history: string[]): string {
	const lines: string[] = ["## AI 分析", ""];
	if (!analysis) {
		lines.push("- （尚未确认分析）");
	} else {
		lines.push(`- 客户类型: ${analysis.customerType ?? ""}`.trimEnd());
		lines.push(`- fit: ${analysis.fit ?? ""}`.trimEnd());
		lines.push(`- indent: ${analysis.intent ?? ""}`.trimEnd());
		lines.push(`- potential: ${analysis.potential ?? ""}`.trimEnd());
		lines.push(`- risk: ${analysis.risk ?? ""}`.trimEnd());
		if (analysis.riskNotes.length > 0) {
			lines.push("- 风险说明:");
			for (const note of analysis.riskNotes) {
				lines.push(`  - ${sanitizeMetaValue(note)}`);
			}
		} else {
			lines.push("- 风险说明:");
		}
		lines.push(
			`- 未确定字段: ${analysis.unknownFields.join(", ")}`.trimEnd(),
		);
		lines.push(`- 分析备注: ${sanitizeMetaValue(analysis.notes)}`.trimEnd());
	}
	if (history.length > 0) {
		lines.push("");
		lines.push("### 分析历史");
		lines.push("");
		for (const entry of history) {
			lines.push(`- ${sanitizeMetaValue(entry)}`);
		}
	}
	return lines.join("\n");
}

function fenceFor(text: string): string {
	const maxRun = (text.match(/`+/g) ?? []).reduce(
		(max, run) => Math.max(max, run.length),
		0,
	);
	return "`".repeat(Math.max(4, maxRun + 1));
}

function renderVersions(versions: EmailVersion[]): string {
	const lines: string[] = ["#### 修改历史", ""];
	for (const version of versions) {
		lines.push(`##### v${version.version} · ${version.at} · ${version.action}`);
		lines.push(`- 用户意见: ${sanitizeMetaValue(version.userComment) || "（无）"}`);
		lines.push("- Subject:");
		const subjectFence = fenceFor(version.subject);
		lines.push(subjectFence);
		lines.push(version.subject.replace(/\r\n?/g, "\n"));
		lines.push(subjectFence);
		lines.push("- Body:");
		const bodyFence = fenceFor(version.body);
		lines.push(bodyFence);
		lines.push(version.body.replace(/\r\n?/g, "\n"));
		lines.push(bodyFence);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

export function renderEmailBlock(record: EmailRecord): string {
	const lines: string[] = [];
	lines.push(
		`### 邮件 ${record.id} · ${sanitizeMetaValue(record.contact)} · ${record.status}`,
	);
	lines.push("");
	lines.push(`- contact: ${sanitizeMetaValue(record.contact)}`);
	lines.push(`- email: ${sanitizeMetaValue(record.email)}`);
	lines.push(`- language: ${sanitizeMetaValue(record.language)}`);
	lines.push(`- language_label: ${sanitizeMetaValue(record.languageLabel)}`);
	lines.push(`- email_summary_zh: ${sanitizeMetaValue(record.summaryZh)}`);
	lines.push(
		`- suggested_send_time: ${sanitizeMetaValue(record.suggestedTime)}`,
	);
	lines.push(`- timezone: ${sanitizeMetaValue(record.timezone)}`);
	lines.push(`- time_reason: ${sanitizeMetaValue(record.timeReason)}`);
	lines.push(`- status: ${record.status}`);
	lines.push(`- generated_at: ${sanitizeMetaValue(record.generatedAt)}`);
	lines.push(`- updated_at: ${sanitizeMetaValue(record.updatedAt)}`);
	lines.push(`- sent: ${record.sent ? "true" : "false"}`);
	lines.push(`- sent_at: ${sanitizeMetaValue(record.sentAt)}`);
	lines.push(`- versions: ${record.versions.length}`);
	for (const [key, value] of Object.entries(record.extraMeta)) {
		if (!/^[A-Za-z_][\w]*$/.test(key)) continue;
		lines.push(`- ${key}: ${sanitizeMetaValue(value)}`);
	}
	lines.push("");
	lines.push("#### Subject");
	lines.push("");
	lines.push(record.subject.replace(/\r\n?/g, "\n").trim());
	lines.push("");
	lines.push("#### Body");
	lines.push("");
	lines.push(record.body.replace(/\r\n?/g, "\n").trim());
	lines.push("");
	lines.push(renderVersions(record.versions));
	return lines.join("\n");
}

function displayNameFromLink(link: string): string {
	const target = link.split("|")[0]?.split("#")[0]?.trim() ?? "";
	const parts = target.split("/");
	return parts[parts.length - 1] || "客户";
}

export function renderCustomerAIFile(file: CustomerAIFile): string {
	const lines: string[] = ["---"];
	lines.push("type: AI开发信息");
	lines.push(`customer: "[[${file.customerLink}]]"`);
	lines.push(`updated: ${file.updated || isoNow()}`);
	lines.push(`email_count: ${file.emails.length}`);
	lines.push(`last_status: ${file.lastStatus || ""}`.trimEnd());
	for (const [key, value] of Object.entries(file.extraFrontmatter)) {
		if (!/^[A-Za-z_][\w]*$/.test(key)) continue;
		if (key === "type" || key === "customer") continue;
		lines.push(`${key}: ${value}`);
	}
	lines.push("---");
	lines.push("");
	lines.push(`# ${displayNameFromLink(file.customerLink)} · AI 开发信息`);
	lines.push("");
	lines.push(renderAnalysis(file.analysis, file.analysisHistory));
	lines.push("");
	lines.push("## 邮件");
	lines.push("");
	for (const email of file.emails) {
		lines.push(renderEmailBlock(email));
		lines.push("");
	}
	if (file.trailing.trim()) {
		lines.push(file.trailing.trim());
		lines.push("");
	}
	return lines.join("\n").trimEnd() + "\n";
}

export function analysisRecordToResult(
	record: AnalysisRecord | null,
): AnalysisResult | null {
	if (!record) return null;
	return {
		customerType: record.customerType,
		fit: record.fit,
		intent: record.intent,
		potential: record.potential,
		risk: record.risk,
		riskNotes: record.riskNotes,
		unknownFields: record.unknownFields,
		analysisNotes: record.notes,
		contactPriority: [],
		recommendedContactId: null,
		languageSuggestion: null,
	};
}

export function setEmailStatus(
	record: EmailRecord,
	status: EmailStatus,
	now: Date = new Date(),
): EmailRecord {
	return {
		...record,
		status,
		updatedAt: isoNow(now),
	};
}

export function nextEmailId(emails: EmailRecord[]): string {	let max = 0;
	for (const email of emails) {
		const numeric = Number.parseInt(email.id.replace(/\D/g, ""), 10);
		if (Number.isFinite(numeric)) max = Math.max(max, numeric);
	}
	return String(max + 1).padStart(3, "0");
}

export function makeEmailVersion(
	version: number,
	action: string,
	userComment: string,
	subject: string,
	body: string,
	at: string = shortStamp(),
): EmailVersion {
	return { version, at, action, userComment, subject, body };
}

export interface NewEmailInput {
	contactRaw: string;
	email: string;
	language: string;
	languageLabel: string;
	summaryZh: string;
	subject: string;
	body: string;
	suggestedTime: string | null;
	timezone: string | null;
	timeReason: string | null;
	now?: Date;
}

export function createEmailRecord(input: NewEmailInput): EmailRecord {
	const now = input.now ?? new Date();
	const iso = isoNow(now);
	const stamp = shortStamp(now);
	const id = "001";
	return {
		id,
		contact: input.contactRaw,
		email: input.email,
		language: input.language,
		languageLabel: input.languageLabel,
		summaryZh: input.summaryZh,
		suggestedTime: input.suggestedTime,
		timezone: input.timezone,
		timeReason: input.timeReason,
		status: "Generated",
		generatedAt: iso,
		updatedAt: iso,
		sent: false,
		sentAt: null,
		subject: input.subject,
		body: input.body,
		versions: [
			makeEmailVersion(1, "Generated", "", input.subject, input.body, stamp),
		],
		extraMeta: {},
	};
}

export interface VersionPatch {
	subject?: string;
	body?: string;
	action: string;
	comment: string;
	status: EmailStatus;
	now?: Date;
}

/** Create a new version for an existing email record (edit or regeneration). */
export function addEmailVersion(
	record: EmailRecord,
	patch: VersionPatch,
): EmailRecord {
	const now = patch.now ?? new Date();
	const nextVersion = record.versions.length + 1;
	const subject = patch.subject ?? record.subject;
	const body = patch.body ?? record.body;
	const version = makeEmailVersion(
		nextVersion,
		patch.action,
		patch.comment,
		subject,
		body,
		shortStamp(now),
	);
	return {
		...record,
		subject,
		body,
		status: patch.status,
		updatedAt: isoNow(now),
		versions: [...record.versions, version],
	};
}

export function appendEmailToContent(
	content: string | null,
	customerLink: string,
	record: EmailRecord,
): string {
	const parsed = content
		? parseCustomerAIFile(content)
		: { file: emptyCustomerAIFile(customerLink), blocks: [] };
	const file = parsed.file;
	file.customerLink = file.customerLink || customerLink;
	const nextId = nextEmailId(file.emails);
	const withId: EmailRecord = { ...record, id: nextId, extraMeta: record.extraMeta };
	file.emails = [...file.emails, withId];
	file.emailCount = file.emails.length;
	file.lastStatus = withId.status;
	file.updated = isoNow();
	return renderCustomerAIFile(file);
}

export function updateEmailInContent(
	content: string,
	record: EmailRecord,
): string {
	const parsed = parseCustomerAIFile(content);
	const file = parsed.file;
	const index = file.emails.findIndex((email) => email.id === record.id);
	if (index < 0) {
		throw new Error(`AI 文件中找不到邮件 ${record.id}`);
	}
	file.emails = file.emails.map((email) =>
		email.id === record.id ? record : email,
	);
	file.emailCount = file.emails.length;
	file.lastStatus = record.status;
	file.updated = isoNow();
	return renderCustomerAIFile(file);
}

export function updateAnalysisInContent(
	content: string,
	analysis: AnalysisRecord,
	historyLine: string,
): string {
	const parsed = parseCustomerAIFile(content);
	const file = parsed.file;
	file.analysis = analysis;
	file.analysisHistory = [...file.analysisHistory, historyLine];
	file.updated = isoNow();
	return renderCustomerAIFile(file);
}

/**
 * Kept for symmetry with renderEmailBlock; produces the text that would be
 * stored for a version's content, used when showing diffs in the UI.
 */
export function versionSnapshotText(version: EmailVersion): string {
	return [
		`v${version.version} · ${version.at} · ${version.action}`,
		version.userComment ? `用户意见：${version.userComment}` : "",
		"",
		version.subject,
		"",
		version.body,
	].join("\n");
}
