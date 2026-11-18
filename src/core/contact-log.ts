/** 客户 frontmatter 里记录最近联系时间的字段。 */
export const CONTACT_LOG_LAST_CONTACT_KEY = "最近联系时间";

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

/** 本机日期，只到天：`YYYY-MM-DD`。 */
export function formatContactLogDate(now: Date = new Date()): string {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
