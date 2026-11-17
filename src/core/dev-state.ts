import {
	formatElapsed,
	formatGenerationAge,
	formatGenerationDate,
	generationTooltip,
	parseGenerationTime,
	type CustomerGeneration,
} from "./generation";
import type { CustomerDevStatus } from "./types";

const DAY_MS = 86400000;

const ATTENTION_KINDS: CustomerDevStatus["kind"][] = [
	"no_contact",
	"no_suitable",
	"failed",
];

const DETAIL_LABELS: Record<string, string> = {
	no_contact: "无可用联系人",
	no_suitable: "未找到合适联系人",
	failed: "上次失败",
};

export interface CustomerDevView {
	/** 主行：最近生成时间 / 从未 / 已拒绝 / 未知。 */
	text: string;
	/** 副行：未解决的上次尝试提醒；没有则为 null。 */
	detail: string | null;
	level: "none" | "ok" | "warn" | "error";
	detailLevel: "warn" | "error" | null;
	/** 悬浮 tooltip，含精确时间。 */
	title: string;
}

function attemptLabel(attempt: CustomerDevStatus): string {
	return DETAIL_LABELS[attempt.kind] ?? "上次尝试未成功";
}

/** 副行文案；时间解析不出来时只显示原因。 */
function attemptDetail(
	attempt: CustomerDevStatus,
	label: string,
	atMs: number | null,
	now: Date,
): string {
	const relative = atMs === null ? "" : ` · ${formatElapsed(atMs, now)}`;
	return `⚠ ${label}${relative}`;
}

/**
 * 把一个客户的「最近生成」（AI 文件推导）与「上次尝试结果」
 * （`.state/customer-status.json`）合并成列表里的一列。
 */
export function describeDevState(
	info: CustomerGeneration | undefined,
	attempt: CustomerDevStatus | null,
	now: Date,
): CustomerDevView {
	const generatedMs = info?.lastGeneratedMs ?? null;
	const hasGeneration = generatedMs !== null;

	let text: string;
	let level: CustomerDevView["level"];
	if (!info || info.state === "never") {
		text = "从未";
		level = "none";
	} else if (info.state === "unknown") {
		text = "未知";
		level = "warn";
	} else if (hasGeneration) {
		text = formatGenerationAge(info, now);
		level = now.getTime() - generatedMs < DAY_MS ? "ok" : "none";
	} else if (info.allRejected) {
		text = "已拒绝";
		level = "none";
	} else {
		text = "未知";
		level = "warn";
	}

	let detail: string | null = null;
	let detailLevel: CustomerDevView["detailLevel"] = null;
	const titleLines = [generationTooltip(info)];
	// `email_count: 0` 的显式空文件不是「文件缺失」，不要吓用户。
	const explicitlyEmptyFile =
		info?.state === "never" && Boolean(info.filePath);

	if (attempt) {
		const atMs = parseGenerationTime(attempt.at);
		const attemptLine = atMs === null
			? `上次尝试：${(attempt.at ?? "").trim() || "时间未知"} · ${attemptLabel(attempt)}`
			: `上次尝试：${formatGenerationDate(atMs)} · ${attemptLabel(attempt)}`;

		if (!explicitlyEmptyFile && !hasGeneration && attempt.kind === "generated") {
			// AI 文件被删 / 移走 / 损坏，但记录说生成过：提示，并让冷却继续生效。
			detail = attemptDetail(attempt, "上次已生成但文件缺失", atMs, now);
			detailLevel = "warn";
			if (level === "none") level = "warn";
			titleLines.push(attemptLine);
		} else if (ATTENTION_KINDS.includes(attempt.kind)) {
			const unresolved = !hasGeneration || atMs === null || atMs >= generatedMs;
			if (unresolved) {
				detail = attemptDetail(attempt, attemptLabel(attempt), atMs, now);
				detailLevel = attempt.kind === "failed" ? "error" : "warn";
				titleLines.push(attemptLine);
			}
		}
	}

	return {
		text,
		detail,
		level,
		detailLevel,
		title: titleLines.filter(Boolean).join("\n"),
	};
}
