import type { AnalysisResult, TaskSelection } from "./types";

export interface FieldCandidate {
	key: string;
	label: string;
	value: string | number;
	oldValue: unknown;
	conflict: boolean;
	selected: boolean;
}

export function normalizeComparable(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (Array.isArray(value)) {
		return value.map((item) => normalizeComparable(item)).join(", ");
	}
	if (typeof value === "number") return String(value);
	return String(value).trim();
}

export function sameValue(left: unknown, right: string | number): boolean {
	const leftText = normalizeComparable(left);
	const rightText = normalizeComparable(right);
	if (!leftText || !rightText) return leftText === rightText;
	const leftNumber = Number(leftText);
	const rightNumber = Number(rightText);
	if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
		return leftNumber === rightNumber;
	}
	return leftText.toLowerCase() === rightText.toLowerCase();
}

export function isEmptyProperty(value: unknown): boolean {
	return normalizeComparable(value) === "";
}

/**
 * Turn an analysis result into the per-field write plan.
 *
 * - Fields whose task was not selected are not offered.
 * - A non-empty existing value that differs is marked as a conflict and left
 *   unchecked, so the plugin never silently overwrites customer data.
 */
export function buildCandidates(
	fm: Record<string, unknown>,
	analysis: AnalysisResult,
	tasks: TaskSelection,
): FieldCandidate[] {
	const out: FieldCandidate[] = [];

	const add = (
		key: string,
		label: string,
		value: string | number | null,
	): void => {
		if (value === null || value === undefined) return;
		if (typeof value === "string" && value.trim() === "") return;
		const oldValue = fm[key];
		const conflict = !isEmptyProperty(oldValue) && !sameValue(oldValue, value);
		out.push({
			key,
			label,
			value,
			oldValue,
			conflict,
			selected: !conflict,
		});
	};

	if (tasks.customerType) add("客户类型", "客户类型", analysis.customerType);
	if (tasks.opportunity) {
		add("fit", "Fit", analysis.fit);
		add("indent", "Intent (indent)", analysis.intent);
		add("potential", "Potential", analysis.potential);
	}
	if (tasks.risk) add("risk", "Risk", analysis.risk);
	return out;
}

export function selectedPatch(candidates: FieldCandidate[]): Record<string, string | number> {
	const patch: Record<string, string | number> = {};
	for (const candidate of candidates) {
		if (candidate.selected) patch[candidate.key] = candidate.value;
	}
	return patch;
}

export function nextFollowUpCount(current: unknown): number {
	const value = Number(normalizeComparable(current));
	if (Number.isFinite(value) && value >= 0) return Math.floor(value) + 1;
	return 1;
}
