import { parseCustomerAIFile, renderCustomerAIFile } from "./ai-file";
import { formatBeijingTime } from "./send-time";
import type { ContactChannel } from "./types";
import { pathToLinkTarget, toWikilink } from "./wikilinks";

/**
 * 已验收邮件的 Reminder 任务。
 *
 * 任务写在 AI 开发信息文件末尾的 `## 发送提醒` 区段（属于文件的 trailing），
 * 用隐藏的 `<!-- eo-reminder: ID -->` 标记与邮件 ID 关联，方便重复验收时
 * 替换而不是追加。时间用北京时间，格式与 Reminder 插件兼容：
 * `(@YYYY-MM-DD HH:mm)`。
 */

export const REMINDER_SECTION_HEADING = "## 发送提醒";

const SECTION_HEADING_RE = /^##\s+发送提醒\s*$/;
const TASK_LINE_RE = /^- \[[ xX]\] /;
const MARKER_PREFIX = "<!-- eo-reminder:";

export interface EmailReminderInput {
	customerName: string;
	emailId: string;
	/** AI 开发信息文件路径；提醒里链接回这个文件。 */
	aiFilePath: string;
	contact: string;
	email: string;
	subject: string;
	summaryZh: string;
	/** 客户当地时间的建议发送时间。 */
	suggestedTime: string | null;
	timezone: string | null;
	/** 联系人的 `#Contact/...` 渠道。 */
	channels?: ContactChannel[];
}

export interface EmailReminder {
	emailId: string;
	/** 北京时间 `YYYY-MM-DD HH:mm`。 */
	time: string;
	/** 隐藏标记，用于幂等更新/删除。 */
	marker: string;
	/** 完整 Markdown 任务块（含子项与标记）。 */
	block: string;
}

function oneLine(value: string | null | undefined): string {
	return (value ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
}

export function reminderMarker(emailId: string): string {
	return `${MARKER_PREFIX} ${oneLine(emailId)} -->`;
}

/** 为一个已验收邮件构建 Reminder 任务；没有可用的建议发送时间时返回 null。 */
export function buildEmailReminder(
	input: EmailReminderInput,
): EmailReminder | null {
	const time = formatBeijingTime(input.suggestedTime, input.timezone);
	if (!time) return null;

	const emailId = oneLine(input.emailId) || "001";
	const contact = oneLine(input.contact) || oneLine(input.email) || "联系人";
	const customer = oneLine(input.customerName);
	const subject = oneLine(input.subject) || "（无主题）";
	const title = `${customer ? `${customer} · ` : ""}发送开发邮件给 ${contact}：${subject}`;

	const lines: string[] = [
		`- [ ] ${title} (@${time})`,
		`    - 邮件：${toWikilink(pathToLinkTarget(input.aiFilePath))} · 邮件 ${emailId}`,
	];
	const email = oneLine(input.email);
	if (email) lines.push(`    - 邮箱：${email}`);
	const summary = oneLine(input.summaryZh);
	if (summary) lines.push(`    - 摘要：${summary}`);
	const suggested = oneLine(input.suggestedTime);
	const timezone = oneLine(input.timezone);
	if (suggested && timezone && timezone !== "Asia/Shanghai") {
		lines.push(`    - 客户当地时间：${suggested} · ${timezone}`);
	}
	for (const channel of input.channels ?? []) {
		const tag = oneLine(channel.tag);
		if (!tag) continue;
		const content = oneLine(channel.content);
		lines.push(content ? `    - ${tag}：${content}` : `    - ${tag}`);
	}

	const marker = reminderMarker(emailId);
	lines.push(marker);
	return { emailId, time, marker, block: lines.join("\n") };
}

function findSection(lines: string[]): { start: number; end: number } | null {
	const start = lines.findIndex((line) => SECTION_HEADING_RE.test(line.trim()));
	if (start < 0) return null;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^#{1,2}\s+/.test(lines[i] ?? "")) {
			end = i;
			break;
		}
	}
	return { start, end };
}

function findMarkerIndex(lines: string[], marker: string): number {
	return lines.findIndex((line) => line.trim() === marker);
}

/** 从标记行往上找到所属任务行；遇到别的标记/标题就停，避免误伤。 */
function findTaskStart(lines: string[], markerIndex: number): number {
	for (let i = markerIndex - 1; i >= 0; i--) {
		const line = lines[i] ?? "";
		if (TASK_LINE_RE.test(line)) return i;
		if (line.trim().startsWith(MARKER_PREFIX)) return markerIndex;
		if (/^#{1,2}\s+/.test(line)) return markerIndex;
	}
	return markerIndex;
}

function joinTrailing(lines: string[]): string {
	return lines.join("\n").trim();
}

/**
 * 在 AI 文件内容里追加或更新一条发送提醒。
 *
 * - 同一邮件 ID 的旧任务会被整块替换；
 * - 没有 `## 发送提醒` 区段时在文件末尾新建；
 * - 不触碰 trailing 里的其他用户内容。
 */
export function upsertEmailReminderInContent(
	content: string,
	reminder: EmailReminder,
): string {
	const parsed = parseCustomerAIFile(content);
	const lines = parsed.file.trailing
		? parsed.file.trailing.split("\n")
		: [];
	const blockLines = reminder.block.split("\n");
	const markerIndex = findMarkerIndex(lines, reminder.marker);

	let next: string[];
	if (markerIndex >= 0) {
		const start = findTaskStart(lines, markerIndex);
		next = [
			...lines.slice(0, start),
			...blockLines,
			...lines.slice(markerIndex + 1),
		];
	} else {
		const section = findSection(lines);
		if (section) {
			// 插到区段最后一个非空行之后；保留区段尾部的空行。
			let insertAt = section.end;
			while (
				insertAt > section.start + 1 &&
				(lines[insertAt - 1] ?? "").trim() === ""
			) {
				insertAt--;
			}
			next = lines.slice(0, insertAt);
			if (next.length > 0 && next[next.length - 1]!.trim() !== "") {
				next.push("");
			}
			next.push(...blockLines);
			if (
				insertAt < lines.length &&
				(lines[insertAt] ?? "").trim() !== ""
			) {
				next.push("");
			}
			next.push(...lines.slice(insertAt));
		} else {
			next = [...lines];
			while (next.length > 0 && next[next.length - 1]!.trim() === "") {
				next.pop();
			}
			if (next.length > 0) next.push("");
			next.push(REMINDER_SECTION_HEADING, "", ...blockLines);
		}
	}

	parsed.file.trailing = joinTrailing(next);
	return renderCustomerAIFile(parsed.file);
}

/**
 * 删除某封邮件的提醒。没有对应标记时原样返回，避免无意义地重写文件。
 * 区段删空后连同 `## 发送提醒` 标题一起移除；区段里还有用户内容或其他任务
 * 时保留标题。
 */
export function removeEmailReminderFromContent(
	content: string,
	emailId: string,
): string {
	const parsed = parseCustomerAIFile(content);
	const lines = parsed.file.trailing
		? parsed.file.trailing.split("\n")
		: [];
	const markerIndex = findMarkerIndex(lines, reminderMarker(emailId));
	if (markerIndex < 0) return content;

	const start = findTaskStart(lines, markerIndex);
	let next = [
		...lines.slice(0, start),
		...lines.slice(markerIndex + 1),
	];

	const section = findSection(next);
	if (section) {
		const body = next.slice(section.start + 1, section.end);
		if (body.every((line) => line.trim() === "")) {
			next = [...next.slice(0, section.start), ...next.slice(section.end)];
		}
	}

	parsed.file.trailing = joinTrailing(next);
	return renderCustomerAIFile(parsed.file);
}
