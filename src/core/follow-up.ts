/** 客户 frontmatter 里的「跟进次数」可能是数字，也可能是字符串。 */
export function parseFollowUpCount(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return Math.floor(value);
	}
	const text = value === undefined || value === null ? "" : String(value).trim();
	if (!text) return 0;
	const parsed = Number(text);
	if (!Number.isFinite(parsed) || parsed < 0) return 0;
	return Math.floor(parsed);
}

/** 「标记已发送」时把跟进次数 +1。 */
export function nextFollowUpCount(current: unknown): number {
	return parseFollowUpCount(current) + 1;
}
