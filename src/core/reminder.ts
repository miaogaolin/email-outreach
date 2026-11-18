import { parseCustomerAIFile, renderCustomerAIFile } from "./ai-file";
import { channelDisplayLabel } from "./channel-labels";
import { formatBeijingTime } from "./send-time";
import type { ContactChannel } from "./types";
import { toWikilink } from "./wikilinks";

/**
 * 已验收邮件的 Reminder 任务。
 *
 * 任务写在 AI 开发信息文件末尾的 `## 发送提醒` 区段（属于文件的 trailing），
 * 用隐藏的 `<!-- eo-reminder: ID -->` 标记与邮件 ID 关联，方便重复验收时
 * 替换而不是追加。时间用北京时间，格式与 Reminder 插件兼容：
 * `(@YYYY-MM-DD HH:mm)`。
 *
 * 邮件内容与提醒在同一个文件里，所以邮件链接直接用同文件标题链接
 * `[[#邮件 NNN · 联系人 · 状态]]`，不带文件路径。
 */

export const REMINDER_SECTION_HEADING = "## 发送提醒";

const SECTION_HEADING_RE = /^##\s+发送提醒\s*$/;
const TASK_LINE_RE = /^- \[[ xX]\] /;
const CHECKED_TASK_RE = /^- \[[xX]\] /;
const EMAIL_MARKER_PREFIX = "<!-- eo-reminder:";
const CONTACT_MARKER_PREFIX = "<!-- eo-reminder-contact:";
const DONE_MARKER_PREFIX = "<!-- eo-reminder-sent:";
const H1_H2_RE = /^#{1,2}\s+/;

export type ReminderKind = "email" | "contact";

export interface EmailReminderInput {
	customerName: string;
	/** 客户双链目标，例如 `BDG Safety`。 */
	customerLink: string;
	emailId: string;
	/** 邮件块标题（不含 `### `），由 `emailHeadingText` 生成。 */
	emailHeading: string;
	contact: string;
	email: string;
	summaryZh: string;
	/** 客户当地时间的建议发送时间。 */
	suggestedTime: string | null;
	timezone: string | null;
	/** 联系人的 `#Contact/...` 渠道。 */
	channels?: ContactChannel[];
}

export interface EmailReminder {
	emailId: string;
	kind: ReminderKind;
	/** 北京时间 `YYYY-MM-DD HH:mm`。 */
	time: string;
	/** 隐藏标记，用于幂等更新/删除。 */
	marker: string;
	/** 完整 Markdown 任务块（含子项与标记）。 */
	block: string;
}

export interface EmailReminderSet {
	email: EmailReminder | null;
	contact: EmailReminder | null;
}

export interface ReminderTaskInfo {
	emailId: string;
	kind: ReminderKind;
	checked: boolean;
	done: boolean;
	/** 任务块原文（含子项与标记）。 */
	block: string;
}

interface MarkerRef {
	index: number;
	kind: ReminderKind;
	emailId: string;
}

interface TaskRange {
	start: number;
	end: number;
	ref: MarkerRef;
}

function oneLine(value: string | null | undefined): string {
	return (value ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
}

function markerFor(prefix: string, emailId: string): string {
	return `${prefix} ${oneLine(emailId)} -->`;
}

export function reminderMarker(emailId: string): string {
	return markerFor(EMAIL_MARKER_PREFIX, emailId);
}

export function contactReminderMarker(emailId: string): string {
	return markerFor(CONTACT_MARKER_PREFIX, emailId);
}

export function reminderSentMarker(emailId: string): string {
	return markerFor(DONE_MARKER_PREFIX, emailId);
}

function markerId(line: string, prefix: string): string | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith(prefix) || !trimmed.endsWith("-->")) return null;
	const id = trimmed.slice(prefix.length, -3).trim();
	return id || null;
}

function isAnyMarkerLine(line: string): boolean {
	const trimmed = line.trim();
	return (
		markerId(trimmed, EMAIL_MARKER_PREFIX) !== null ||
		markerId(trimmed, CONTACT_MARKER_PREFIX) !== null ||
		markerId(trimmed, DONE_MARKER_PREFIX) !== null
	);
}

function customerTarget(input: EmailReminderInput): string {
	return oneLine(input.customerLink) || oneLine(input.customerName) || "客户";
}

function contactLabel(input: EmailReminderInput): string {
	return oneLine(input.contact) || oneLine(input.email) || "联系人";
}

/**
 * 同文件标题链接。标题里有 `|` / `#` / `[]` 或联系人为空时，Obsidian 的
 * wikilink 解析不可靠，降级成纯文本邮件编号。
 */
function emailLink(input: EmailReminderInput): string {
	const heading = oneLine(input.emailHeading);
	if (!heading || !oneLine(input.contact) || /[\[\]|#\r\n]/.test(heading)) {
		return `邮件 ${oneLine(input.emailId) || "001"}`;
	}
	return `[[#${heading}]]`;
}

/** 为一个已验收邮件构建主任务与（有渠道时的）其它渠道任务。 */
export function buildEmailReminders(input: EmailReminderInput): EmailReminderSet {
	const time = formatBeijingTime(input.suggestedTime, input.timezone);
	if (!time) return { email: null, contact: null };

	const emailId = oneLine(input.emailId) || "001";
	const customerLink = toWikilink(customerTarget(input));
	const contact = contactLabel(input);
	const link = emailLink(input);

	const emailLines: string[] = [
		`- [ ] ${customerLink} · 发送邮件给 ${contact} (@${time})`,
		`    - 邮件：${link}`,
	];
	const email = oneLine(input.email);
	if (email) emailLines.push(`    - 邮箱：${email}`);
	const summary = oneLine(input.summaryZh);
	if (summary) emailLines.push(`    - 摘要：${summary}`);
	const suggested = oneLine(input.suggestedTime);
	const timezone = oneLine(input.timezone);
	if (suggested && timezone && timezone !== "Asia/Shanghai") {
		emailLines.push(`    - 客户当地时间：${suggested} · ${timezone}`);
	}
	const emailMarker = reminderMarker(emailId);
	emailLines.push(emailMarker);

	const emailReminder: EmailReminder = {
		emailId,
		kind: "email",
		time,
		marker: emailMarker,
		block: emailLines.join("\n"),
	};

	const channels = (input.channels ?? []).filter(
		(channel) => oneLine(channel.tag) !== "",
	);
	let contactReminder: EmailReminder | null = null;
	if (channels.length > 0) {
		const lines: string[] = [
			`- [ ] ${customerLink} · 其它渠道联系 ${contact} (@${time})`,
			`    - 邮件：${link}`,
		];
		for (const channel of channels) {
			const label = channelDisplayLabel(oneLine(channel.tag));
			const content = oneLine(channel.content);
			lines.push(content ? `    - ${label}：${content}` : `    - ${label}`);
		}
		const marker = contactReminderMarker(emailId);
		lines.push(marker);
		contactReminder = {
			emailId,
			kind: "contact",
			time,
			marker,
			block: lines.join("\n"),
		};
	}

	return { email: emailReminder, contact: contactReminder };
}

function findSection(lines: string[]): { start: number; end: number } | null {
	const start = lines.findIndex((line) => SECTION_HEADING_RE.test(line.trim()));
	if (start < 0) return null;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (H1_H2_RE.test(lines[i] ?? "")) {
			end = i;
			break;
		}
	}
	return { start, end };
}

/** 从标记行往上找到所属任务行；遇到别的标记/标题就返回 -1。 */
function findTaskStart(lines: string[], markerIndex: number): number {
	for (let i = markerIndex - 1; i >= 0; i--) {
		const line = lines[i] ?? "";
		if (TASK_LINE_RE.test(line)) return i;
		if (isAnyMarkerLine(line)) return -1;
		if (H1_H2_RE.test(line)) return -1;
	}
	return -1;
}

/**
 * 任务块结束位置：下一条顶级任务/标题，或第一条不属于任务的顶级内容。
 * 缩进子项、标记行和空行都算任务块的一部分。
 */
function findTaskEnd(lines: string[], start: number): number {
	let end = start + 1;
	while (end < lines.length) {
		const line = lines[end] ?? "";
		if (H1_H2_RE.test(line) || TASK_LINE_RE.test(line)) break;
		if (line.trim() === "" || /^\s/.test(line) || isAnyMarkerLine(line)) {
			end++;
			continue;
		}
		break;
	}
	return end;
}

function findMarkerRefs(lines: string[]): MarkerRef[] {
	const refs: MarkerRef[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const emailId = markerId(line, EMAIL_MARKER_PREFIX);
		if (emailId) {
			refs.push({ index: i, kind: "email", emailId });
			continue;
		}
		const contactId = markerId(line, CONTACT_MARKER_PREFIX);
		if (contactId) refs.push({ index: i, kind: "contact", emailId: contactId });
	}
	return refs;
}

function taskRanges(
	lines: string[],
	predicate: (ref: MarkerRef) => boolean,
): TaskRange[] {
	const ranges: TaskRange[] = [];
	for (const ref of findMarkerRefs(lines)) {
		if (!predicate(ref)) continue;
		const start = findTaskStart(lines, ref.index);
		if (start < 0) continue;
		ranges.push({ start, end: findTaskEnd(lines, start), ref });
	}
	return ranges;
}

function removeRanges(lines: string[], ranges: TaskRange[]): string[] {
	if (ranges.length === 0) return lines;
	const next = [...lines];
	for (const range of [...ranges].sort((a, b) => b.start - a.start)) {
		next.splice(range.start, range.end - range.start);
	}
	return next;
}

function hasDoneMarker(lines: string[], emailId: string): boolean {
	const marker = reminderSentMarker(emailId);
	return lines.some((line) => line.trim() === marker);
}

function joinTrailing(lines: string[]): string {
	return lines.join("\n").trim();
}

/** 列出 trailing 里的发送提醒任务；已勾选/已处理状态也一并返回。 */
export function listEmailReminderTasks(content: string): ReminderTaskInfo[] {
	const parsed = parseCustomerAIFile(content);
	const lines = parsed.file.trailing
		? parsed.file.trailing.split("\n")
		: [];
	const tasks: ReminderTaskInfo[] = [];
	for (const ref of findMarkerRefs(lines)) {
		const start = findTaskStart(lines, ref.index);
		if (start < 0) continue;
		const end = findTaskEnd(lines, start);
		const blockLines = lines.slice(start, end);
		const doneMarker = reminderSentMarker(ref.emailId);
		tasks.push({
			emailId: ref.emailId,
			kind: ref.kind,
			checked: CHECKED_TASK_RE.test(lines[start] ?? ""),
			done: blockLines.some((line) => line.trim() === doneMarker),
			block: blockLines.join("\n").trim(),
		});
	}
	return tasks;
}

/**
 * 旧版提醒格式：标题带“发送开发邮件给”、邮件子项是文件链接，或
 * 主任务下直接挂了 `#Contact/...` 渠道行。
 */
export function isLegacyReminderBlock(block: string): boolean {
	const lines = block.split("\n");
	if ((lines[0] ?? "").includes("发送开发邮件给")) return true;
	if (/^\s+- #Contact\//m.test(block)) return true;
	const emailLine = lines.find((line) => /^\s+- 邮件：/.test(line));
	if (!emailLine) return false;
	const value = emailLine.replace(/^\s+- 邮件：/, "").trim();
	return value.startsWith("[[") && !value.startsWith("[[#");
}

function insertBlocks(lines: string[], blocks: string[]): string[] {
	if (blocks.length === 0) return lines;
	const blockLines: string[] = [];
	for (let index = 0; index < blocks.length; index++) {
		if (index > 0) blockLines.push("");
		blockLines.push(...blocks[index]!.split("\n"));
	}

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
		const next = lines.slice(0, insertAt);
		if (next.length > 0 && next[next.length - 1]!.trim() !== "") {
			next.push("");
		}
		next.push(...blockLines);
		if (insertAt < lines.length && (lines[insertAt] ?? "").trim() !== "") {
			next.push("");
		}
		next.push(...lines.slice(insertAt));
		return next;
	}

	const next = [...lines];
	while (next.length > 0 && next[next.length - 1]!.trim() === "") {
		next.pop();
	}
	if (next.length > 0) next.push("");
	next.push(REMINDER_SECTION_HEADING, "", ...blockLines);
	return next;
}

/**
 * 在 AI 文件内容里写入一整套提醒（主任务 + 渠道任务）。
 *
 * - 同一邮件 ID 的旧主任务/渠道任务会被整块替换；
 * - 已存在的 sent 标记会保留，并把主任务保持为勾选，避免重复验收清掉已确认状态；
 * - 没有 `## 发送提醒` 区段时在文件末尾新建；
 * - 不触碰 trailing 里的其他用户内容。
 */
export function upsertEmailRemindersInContent(
	content: string,
	set: EmailReminderSet,
): string {
	const emailId = set.email?.emailId ?? set.contact?.emailId;
	if (!emailId) return content;

	const parsed = parseCustomerAIFile(content);
	const lines = parsed.file.trailing
		? parsed.file.trailing.split("\n")
		: [];
	const wasDone = hasDoneMarker(lines, emailId);
	const ranges = taskRanges(lines, (ref) => ref.emailId === emailId);
	let next = removeRanges(lines, ranges);
	const doneMarker = reminderSentMarker(emailId);
	next = next.filter((line) => line.trim() !== doneMarker);

	const blocks: string[] = [];
	if (set.email) {
		let block = set.email.block;
		if (wasDone) {
			block = block.replace(/^- \[ \] /, "- [x] ");
			block += `\n${doneMarker}`;
		}
		blocks.push(block);
	}
	if (set.contact) blocks.push(set.contact.block);

	parsed.file.trailing = joinTrailing(insertBlocks(next, blocks));
	return renderCustomerAIFile(parsed.file);
}

/**
 * 删除某封邮件的全部提醒（主任务 + 渠道任务 + sent 标记）。
 * 没有对应标记时原样返回，避免无意义地重写文件。
 * 区段删空后连同 `## 发送提醒` 标题一起移除。
 */
export function removeEmailReminderFromContent(
	content: string,
	emailId: string,
): string {
	const parsed = parseCustomerAIFile(content);
	const lines = parsed.file.trailing
		? parsed.file.trailing.split("\n")
		: [];
	const doneMarker = reminderSentMarker(emailId);
	const ranges = taskRanges(lines, (ref) => ref.emailId === emailId);
	const hasOrphanDone = lines.some((line) => line.trim() === doneMarker);
	if (ranges.length === 0 && !hasOrphanDone) return content;

	let next = removeRanges(lines, ranges);
	next = next.filter((line) => line.trim() !== doneMarker);

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

/** 在已勾选的主任务标记下一行写入 sent 标记；幂等。 */
export function markEmailReminderSentInContent(
	content: string,
	emailId: string,
): string {
	const parsed = parseCustomerAIFile(content);
	const lines = parsed.file.trailing
		? parsed.file.trailing.split("\n")
		: [];
	const doneMarker = reminderSentMarker(emailId);
	if (lines.some((line) => line.trim() === doneMarker)) return content;

	const ref = findMarkerRefs(lines).find(
		(item) => item.kind === "email" && item.emailId === emailId,
	);
	if (!ref) return content;
	const start = findTaskStart(lines, ref.index);
	if (start < 0) return content;
	if (!CHECKED_TASK_RE.test(lines[start] ?? "")) {
		lines[start] = (lines[start] ?? "").replace(/^- \[ \] /, "- [x] ");
	}

	lines.splice(ref.index + 1, 0, doneMarker);
	parsed.file.trailing = joinTrailing(lines);
	return renderCustomerAIFile(parsed.file);
}

/**
 * 把指定主任务恢复为未勾选，并移除 sent 标记。
 *
 * 用于取消确认框、或写客户属性失败后的回滚。已勾选但没有 sent 标记的
 * 用户内容不受影响。
 */
export function uncheckEmailReminderInContent(
	content: string,
	emailId: string,
): string {
	const parsed = parseCustomerAIFile(content);
	const lines = parsed.file.trailing
		? parsed.file.trailing.split("\n")
		: [];
	const doneMarker = reminderSentMarker(emailId);
	const ref = findMarkerRefs(lines).find(
		(item) => item.kind === "email" && item.emailId === emailId,
	);
	let changed = false;
	if (ref) {
		const start = findTaskStart(lines, ref.index);
		if (start >= 0) {
			const line = lines[start] ?? "";
			if (CHECKED_TASK_RE.test(line)) {
				lines[start] = line.replace(/^- \[[xX]\] /, "- [ ] ");
				changed = true;
			}
		}
	}
	const next = lines.filter((line) => line.trim() !== doneMarker);
	if (next.length !== lines.length) changed = true;
	if (!changed) return content;

	parsed.file.trailing = joinTrailing(next);
	return renderCustomerAIFile(parsed.file);
}
