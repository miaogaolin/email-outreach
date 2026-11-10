export function countCJK(text: string): number {
	const matches = text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g);
	return matches ? matches.length : 0;
}

export function looksChinese(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	const cjk = countCJK(trimmed);
	return cjk > 0 && cjk / trimmed.length >= 0.35;
}

export function normalizeForCompare(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[。.!！?？:：]/g, "");
}

/** Non-fatal warnings for the Chinese summary field. */
export function summaryWarnings(
	summary: string,
	subject: string,
): string[] {
	const warnings: string[] = [];
	const trimmed = summary.trim();
	if (!trimmed) {
		warnings.push("中文摘要为空");
		return warnings;
	}
	if (!looksChinese(trimmed)) {
		warnings.push("中文摘要不是简体中文");
	}
	const cjk = countCJK(trimmed);
	if (cjk < 10) warnings.push("中文摘要过短（建议 30–60 字）");
	else if (cjk > 120) warnings.push("中文摘要过长（建议 30–60 字）");
	else if (cjk < 30 || cjk > 60) warnings.push("中文摘要长度不在 30–60 字建议区间");
	if (normalizeForCompare(trimmed) === normalizeForCompare(subject)) {
		warnings.push("中文摘要与 Subject 相同");
	}
	return warnings;
}
