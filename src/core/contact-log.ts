import { parseFollowUpCount } from "./follow-up";

/** 客户 frontmatter 里联系记录的两个字段。 */
export const CONTACT_LOG_LAST_CONTACT_KEY = "最近联系时间";
export const CONTACT_LOG_FOLLOW_UP_KEY = "跟进次数";

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

/** 本机日期，只到天：`YYYY-MM-DD`。 */
export function formatContactLogDate(now: Date = new Date()): string {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface ContactLogPlan {
	/** 只到天的日期字符串。 */
	lastContact: string;
	/** 确认发送后的跟进次数。 */
	followUpCount: number;
}

/** 勾选提醒并确认后要写入客户 frontmatter 的值。 */
export function planContactLog(
	fm: Record<string, unknown>,
	now: Date = new Date(),
): ContactLogPlan {
	return {
		lastContact: formatContactLogDate(now),
		followUpCount: parseFollowUpCount(fm[CONTACT_LOG_FOLLOW_UP_KEY]) + 1,
	};
}
