const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

export function sanitizeFileName(name: string): string {
	let cleaned = name.replace(ILLEGAL_FILENAME_CHARS, "-");
	cleaned = cleaned.replace(/\s+/g, " ").trim();
	cleaned = cleaned.replace(/^[.\s]+|[.\s]+$/g, "");
	cleaned = cleaned.replace(/-{2,}/g, "-");
	if (cleaned.length > 100) cleaned = cleaned.slice(0, 100).trim();
	return cleaned || "untitled";
}

export const AI_FILE_SUFFIX = " - AI开发信息";

export function aiFileName(customerBaseName: string): string {
	return `${sanitizeFileName(customerBaseName)}${AI_FILE_SUFFIX}`;
}

export function normalizeDir(dir: string): string {
	return dir.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "").trim();
}

export function joinPath(...parts: string[]): string {
	return parts
		.filter((part) => part !== undefined && part !== null && part !== "")
		.map((part) => part.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
		.join("/");
}

export function aiFilePath(outputDir: string, customerBaseName: string): string {
	return joinPath(normalizeDir(outputDir), `${aiFileName(customerBaseName)}.md`);
}

export function feedbackFilePath(
	outputDir: string,
	configuredPath?: string | null,
): string {
	if (configuredPath && configuredPath.trim()) {
		return configuredPath.replace(/\\/g, "/").replace(/\.md$/i, "") + ".md";
	}
	return joinPath(normalizeDir(outputDir), "Feedback.md");
}

export interface DailyStamp {
	date: string;
	time: string;
}

export function localStamp(now: Date = new Date()): DailyStamp {
	const pad = (value: number): string => String(value).padStart(2, "0");
	return {
		date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
		time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
	};
}

export function isoNow(now: Date = new Date()): string {
	const pad = (value: number): string => String(value).padStart(2, "0");
	const offsetMinutes = -now.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const abs = Math.abs(offsetMinutes);
	return (
		`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
		`T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}

/** `2026-11-10 16:30` in local time, used in version headings. */
export function shortStamp(now: Date = new Date()): string {
	const stamp = localStamp(now);
	return `${stamp.date} ${stamp.time}`;
}

/** Split an AI file name back into the customer base name. */
export function customerNameFromAIFile(baseName: string): string {
	if (baseName.endsWith(AI_FILE_SUFFIX)) {
		return baseName.slice(0, baseName.length - AI_FILE_SUFFIX.length);
	}
	return baseName;
}
