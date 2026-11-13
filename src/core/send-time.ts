import { parseFollowUpCount } from "./follow-up";
import { guessLanguage } from "./language";
import type { EmailRecord } from "./types";

/**
 * 发送时间规则（全部可在这一处调整）：
 * - 客户当地时间工作日 09:30；
 * - 首次联系安排下个工作日；
 * - 第 1/2/3+ 次跟进分别间隔 3/5/7 个工作日；
 * - 同一客户多封邮件每多一封顺延 1 个工作日，最多顺延 3 天。
 */
const PREFERRED_HOUR = 9;
const PREFERRED_MINUTE = 30;
const BEIJING_TIMEZONE = "Asia/Shanghai";

const WEEKDAY_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 多时区国家里常见的城市/区域关键词，优先于国家默认时区。 */
const REGION_TIMEZONE_HINTS: { pattern: RegExp; timezone: string }[] = [
	{
		pattern: /(美国|usa|united states).*(西部|加州|太平洋|洛杉矶|旧金山|西雅图)|(?:洛杉矶|旧金山|西雅图)/i,
		timezone: "America/Los_Angeles",
	},
	{
		pattern: /(美国|usa|united states).*(中部|芝加哥|德州|达拉斯|休斯顿)|(?:芝加哥|达拉斯|休斯顿|奥斯汀)/i,
		timezone: "America/Chicago",
	},
	{
		pattern: /(美国|usa|united states).*(东部|纽约|波士顿|费城)|(?:纽约|波士顿|费城)/i,
		timezone: "America/New_York",
	},
	{
		pattern: /(加拿大|canada).*(温哥华)|(?:温哥华)/i,
		timezone: "America/Vancouver",
	},
	{
		pattern: /(加拿大|canada).*(卡尔加里|埃德蒙顿)|(?:卡尔加里|埃德蒙顿)/i,
		timezone: "America/Edmonton",
	},
	{
		pattern: /(澳大利亚|australia).*(西部|珀斯)|(?:珀斯)/i,
		timezone: "Australia/Perth",
	},
	{
		pattern: /(澳大利亚|australia).*(昆士兰|布里斯班)|(?:布里斯班)/i,
		timezone: "Australia/Brisbane",
	},
	{
		pattern: /(澳大利亚|australia).*(南部|阿德莱德)|(?:阿德莱德)/i,
		timezone: "Australia/Adelaide",
	},
	{
		pattern: /(俄罗斯|russia).*(新西伯利亚)|(?:新西伯利亚)/i,
		timezone: "Asia/Novosibirsk",
	},
	{
		pattern: /(俄罗斯|russia).*(叶卡捷琳堡|乌拉尔)|(?:叶卡捷琳堡)/i,
		timezone: "Asia/Yekaterinburg",
	},
	{
		pattern: /(俄罗斯|russia).*(远东|符拉迪沃斯托克|海参崴)|(?:符拉迪沃斯托克|海参崴)/i,
		timezone: "Asia/Vladivostok",
	},
	{
		pattern: /(巴西|brazil).*(马瑙斯)|(?:马瑙斯)/i,
		timezone: "America/Manaus",
	},
];

export interface SendHistory {
	/** 客户 frontmatter 的「跟进次数」。 */
	followUpCount: number;
	/** 客户 frontmatter 的「最近联系时间」。 */
	lastContact: string | null;
	/** 已发送邮件的 sent_at / updated_at / generated_at。 */
	sentDates: string[];
}

export interface SendTimePlan {
	/** `YYYY-MM-DD HH:mm`，客户当地时间。 */
	suggestedTime: string;
	/** IANA 时区。 */
	timezone: string;
	/** 中文说明，包含北京时间对照和跟进节奏。 */
	timeReason: string;
	/** 归一化 UTC 时间，便于测试/排序。 */
	utcIso: string;
}

interface DateParts {
	year: number;
	month: number;
	day: number;
}

interface DateTimeParts extends DateParts {
	hour: number;
	minute: number;
	second: number;
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function formatDate(parts: DateParts): string {
	return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function compareDate(a: DateParts, b: DateParts): number {
	return a.year - b.year || a.month - b.month || a.day - b.day;
}

function maxDate(a: DateParts | null, b: DateParts | null): DateParts | null {
	if (!a) return b;
	if (!b) return a;
	return compareDate(a, b) >= 0 ? a : b;
}

function datePartsFromText(value: unknown): DateParts | null {
	if (typeof value !== "string") return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const check = new Date(Date.UTC(year, month - 1, day));
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== day
	) {
		return null;
	}
	return { year, month, day };
}

function partsInZone(date: Date, timezone: string): DateTimeParts {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	const parts: Record<string, string> = {};
	for (const part of formatter.formatToParts(date)) {
		parts[part.type] = part.value;
	}
	return {
		year: Number(parts.year),
		month: Number(parts.month),
		day: Number(parts.day),
		hour: Number(parts.hour) % 24,
		minute: Number(parts.minute),
		second: Number(parts.second),
	};
}

function zoneOffsetMs(instant: Date, timezone: string): number {
	const parts = partsInZone(instant, timezone);
	const asUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
	return asUtc - instant.getTime();
}

/** 把「某时区的本地日期时间」转成 UTC 时间；迭代处理夏令时偏移。 */
function zonedTimeToUtc(
	parts: DateParts & { hour: number; minute: number },
	timezone: string,
): Date {
	const target = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		0,
	);
	let guess = target;
	for (let index = 0; index < 4; index++) {
		const offset = zoneOffsetMs(new Date(guess), timezone);
		const next = target - offset;
		if (next === guess) break;
		guess = next;
	}
	return new Date(guess);
}

function addCalendarDays(parts: DateParts, delta: number): DateParts {
	const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + delta));
	return {
		year: next.getUTCFullYear(),
		month: next.getUTCMonth() + 1,
		day: next.getUTCDate(),
	};
}

function weekdayOf(parts: DateParts): number {
	return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function rollToBusinessDay(parts: DateParts): DateParts {
	let result = parts;
	while (weekdayOf(result) === 0 || weekdayOf(result) === 6) {
		result = addCalendarDays(result, 1);
	}
	return result;
}

function addBusinessDays(parts: DateParts, days: number): DateParts {
	let result = parts;
	let remaining = Math.max(0, Math.floor(days));
	if (remaining === 0) return rollToBusinessDay(result);
	while (remaining > 0) {
		result = addCalendarDays(result, 1);
		if (weekdayOf(result) !== 0 && weekdayOf(result) !== 6) {
			remaining--;
		}
	}
	return result;
}

function safeTimezone(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
		return value;
	} catch {
		return null;
	}
}

/**
 * 把「客户当地时间 + 客户时区」换算成北京时间，用于界面展示。
 *
 * 落盘仍然保存客户当地时间 + 时区，这样跟进节奏和客户作息不变；
 * 展示时统一换算，避免团队每次自己心算时差。
 */
export function formatBeijingTime(
	suggestedTime: string | null | undefined,
	timezone?: string | null,
): string | null {
	if (typeof suggestedTime !== "string") return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(
		suggestedTime.trim(),
	);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	if (
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > 31 ||
		hour > 23 ||
		minute > 59
	) {
		return null;
	}
	const check = new Date(Date.UTC(year, month - 1, day));
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== day
	) {
		return null;
	}
	const sourceZone = safeTimezone(timezone) ?? BEIJING_TIMEZONE;
	const target = zonedTimeToUtc(
		{ year, month, day, hour, minute },
		sourceZone,
	);
	const beijing = partsInZone(target, BEIJING_TIMEZONE);
	return `${formatDate(beijing)} ${pad(beijing.hour)}:${pad(beijing.minute)}`;
}

/**
 * 根据「地区」解析客户时区。
 * 多时区国家先看城市/区域关键词，再看国家默认时区，最后回退北京时间。
 */
export function resolveTimezone(region: unknown): {
	timezone: string;
	source: "city" | "country" | "fallback";
} {
	const text = typeof region === "string" ? region.trim() : "";
	if (text) {
		for (const hint of REGION_TIMEZONE_HINTS) {
			if (!hint.pattern.test(text)) continue;
			const timezone = safeTimezone(hint.timezone);
			if (timezone) return { timezone, source: "city" };
		}
	}
	const info = guessLanguage(region);
	const countryTimezone = safeTimezone(info?.timezone ?? null);
	if (countryTimezone) {
		return { timezone: countryTimezone, source: "country" };
	}
	return { timezone: BEIJING_TIMEZONE, source: "fallback" };
}

function asText(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	const text = String(value).trim();
	return text || null;
}

/** 从客户 frontmatter + 已有邮件记录提取发送节奏依据。 */
export function sendHistoryFrom(
	fm: Record<string, unknown>,
	emails: EmailRecord[],
): SendHistory {
	const sentDates: string[] = [];
	for (const email of emails) {
		if (!email.sent) continue;
		const candidate =
			email.sentAt ||
			email.updatedAt ||
			email.generatedAt ||
			email.versions[email.versions.length - 1]?.at ||
			"";
		if (datePartsFromText(candidate)) sentDates.push(candidate);
	}
	return {
		followUpCount: parseFollowUpCount(fm["跟进次数"]),
		lastContact: asText(fm["最近联系时间"]),
		sentDates,
	};
}

function followUpGapDays(count: number): number {
	if (count <= 0) return 0;
	if (count === 1) return 3;
	if (count === 2) return 5;
	return 7;
}

/**
 * 为一封邮件计算发送时间。
 *
 * `sequence` 是同客户本次生成的第几封（0 起），用于错峰；
 * `history` 来自 `sendHistoryFrom`，决定跟进节奏。
 */
export function planSendTime(input: {
	region: unknown;
	now?: Date;
	history?: SendHistory;
	sequence?: number;
}): SendTimePlan {
	const now = input.now ?? new Date();
	const resolved = resolveTimezone(input.region);
	const timezone = resolved.timezone;
	const history: SendHistory = input.history ?? {
		followUpCount: 0,
		lastContact: null,
		sentDates: [],
	};

	const today = partsInZone(now, timezone);
	const parsedSentDates = history.sentDates
		.map((value) => datePartsFromText(value))
		.filter((value): value is DateParts => value !== null)
		.filter((value) => compareDate(value, today) <= 0);
	let latestSent: DateParts | null = null;
	for (const date of parsedSentDates) {
		latestSent = maxDate(latestSent, date);
	}
	let lastContact = datePartsFromText(history.lastContact);
	if (lastContact && compareDate(lastContact, today) > 0) lastContact = null;
	const latest = maxDate(lastContact, latestSent);

	const effectiveFollowUp = Math.max(
		history.followUpCount,
		parsedSentDates.length,
		latest ? 1 : 0,
	);
	const gapDays = followUpGapDays(effectiveFollowUp);
	const sequence = Math.min(Math.max(Math.floor(input.sequence ?? 0), 0), 3);
	const staggerDays = sequence;

	let base: DateParts = latest
		? addBusinessDays(latest, gapDays)
		: { year: today.year, month: today.month, day: today.day };
	if (compareDate(base, today) < 0) {
		base = { year: today.year, month: today.month, day: today.day };
	}
	base = rollToBusinessDay(base);
	if (staggerDays > 0) base = addBusinessDays(base, staggerDays);

	let target = zonedTimeToUtc(
		{ ...base, hour: PREFERRED_HOUR, minute: PREFERRED_MINUTE },
		timezone,
	);
	const sameDay = compareDate(base, today) === 0;
	const nowMinutes = today.hour * 60 + today.minute;
	const preferredMinutes = PREFERRED_HOUR * 60 + PREFERRED_MINUTE;
	if (
		target.getTime() <= now.getTime() ||
		(sameDay && nowMinutes >= preferredMinutes)
	) {
		base = addBusinessDays(base, 1);
		target = zonedTimeToUtc(
			{ ...base, hour: PREFERRED_HOUR, minute: PREFERRED_MINUTE },
			timezone,
		);
	}

	const local = partsInZone(target, timezone);
	const suggestedTime = `${formatDate(local)} ${pad(local.hour)}:${pad(local.minute)}`;
	const beijing = partsInZone(target, BEIJING_TIMEZONE);
	const beijingTime = `${formatDate(beijing)} ${pad(beijing.hour)}:${pad(beijing.minute)}`;
	const weekday = WEEKDAY_ZH[weekdayOf(local)] ?? "";

	const reasons: string[] = [];
	reasons.push(`客户当地时间 ${suggestedTime}（${weekday}，${timezone}）`);
	reasons.push(`北京时间 ${beijingTime}`);
	if (resolved.source === "fallback") {
		reasons.push("地区未识别，暂按北京时间安排，请补充客户地区");
	}
	if (effectiveFollowUp <= 0) {
		reasons.push("首次联系，安排在下个工作日 09:30");
	} else {
		const latestText = latest ? formatDate(latest) : "（无记录）";
		reasons.push(
			`已跟进 ${effectiveFollowUp} 次，最近联系 ${latestText}，按 ${gapDays} 个工作日节奏安排`,
		);
	}
	if (sequence > 0) {
		reasons.push(
			`同客户本次第 ${sequence + 1} 封，顺延 ${sequence} 个工作日避免集中发送`,
		);
	}

	return {
		suggestedTime,
		timezone,
		timeReason: reasons.join("；"),
		utcIso: target.toISOString(),
	};
}
