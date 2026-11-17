import { describeDevState } from "../src/core/dev-state";
import { NEVER_GENERATION, type CustomerGeneration } from "../src/core/generation";
import type { CustomerDevStatus } from "../src/core/types";
import { assert, assertEqual, suite, test } from "./harness";

const NOW = new Date("2026-11-17T10:00:00+08:00");
const NOW_MS = NOW.getTime();
const HOUR = 3600000;
const DAY = 86400000;

function generated(deltaMs: number): CustomerGeneration {
	const ms = NOW_MS - deltaMs;
	return {
		...NEVER_GENERATION,
		state: "known",
		lastGeneratedAt: new Date(ms).toISOString(),
		lastGeneratedMs: ms,
		emailCount: 1,
		totalEmailCount: 1,
	};
}

function attempt(
	kind: CustomerDevStatus["kind"],
	atMs: number | null,
	message = "",
): CustomerDevStatus {
	return {
		kind,
		customerName: "Acme",
		emailCount: 0,
		message,
		at: atMs === null ? "" : new Date(atMs).toISOString(),
	};
}

suite("dev state");

test("3 天前生成、没有尝试记录", () => {
	const view = describeDevState(generated(3 * DAY), null, NOW);
	assertEqual(view.text, "3 天前", "主行是时间");
	assertEqual(view.detail, null, "没有副行");
	assertEqual(view.level, "none", "超过 24h 用中性色");
	assertEqual(view.detailLevel, null, "没有副行颜色");
});

test("3 天前生成、2 小时前失败", () => {
	const view = describeDevState(
		generated(3 * DAY),
		attempt("failed", NOW_MS - 2 * HOUR),
		NOW,
	);
	assertEqual(view.text, "3 天前", "主行");
	assertEqual(view.detail, "⚠ 上次失败 · 2 小时前", "副行");
	assertEqual(view.detailLevel, "error", "失败用 error");
});

test("失败之后又生成成功，旧提醒隐藏", () => {
	const view = describeDevState(
		generated(HOUR),
		attempt("failed", NOW_MS - 2 * HOUR),
		NOW,
	);
	assertEqual(view.text, "1 小时前", "主行");
	assertEqual(view.detail, null, "旧失败已解决");
	assertEqual(view.level, "ok", "24h 内用成功色");
});

test("从未生成、上次无可用联系人", () => {
	const view = describeDevState(
		NEVER_GENERATION,
		attempt("no_contact", NOW_MS - 2 * HOUR),
		NOW,
	);
	assertEqual(view.text, "从未", "主行");
	assertEqual(view.detail, "⚠ 无可用联系人 · 2 小时前", "副行");
	assertEqual(view.detailLevel, "warn", "无联系人用 warn");
});

test("上次记录已生成但文件缺失", () => {
	const view = describeDevState(
		NEVER_GENERATION,
		attempt("generated", NOW_MS - HOUR),
		NOW,
	);
	assertEqual(view.text, "从未", "主行保持从未");
	assertEqual(view.detail, "⚠ 上次已生成但文件缺失 · 1 小时前", "副行提示文件缺失");
	assertEqual(view.level, "warn", "提醒用 warn");

	const unknownFile = describeDevState(
		{ ...NEVER_GENERATION, state: "unknown" },
		attempt("generated", NOW_MS - HOUR),
		NOW,
	);
	assertEqual(unknownFile.text, "未知", "文件存在但解析不出");
	assertEqual(
		unknownFile.detail,
		"⚠ 上次已生成但文件缺失 · 1 小时前",
		"同样带副行",
	);
});

test("全部已拒绝显示已拒绝", () => {
	const view = describeDevState(
		{ ...NEVER_GENERATION, state: "known", allRejected: true, totalEmailCount: 1 },
		null,
		NOW,
	);
	assertEqual(view.text, "已拒绝", "主行");
	assertEqual(view.level, "none", "中性色");
});

test("未知状态用警告色", () => {
	const view = describeDevState(
		{ ...NEVER_GENERATION, state: "unknown" },
		null,
		NOW,
	);
	assertEqual(view.text, "未知", "主行");
	assertEqual(view.level, "warn", "警告色");
});

test("tooltip 含精确时间与邮件数", () => {
	const info = {
		...generated(2 * HOUR),
		emailCount: 2,
		totalEmailCount: 3,
		pendingCount: 1,
	};
	const view = describeDevState(
		info,
		attempt("no_suitable", NOW_MS - HOUR),
		NOW,
	);
	assert(view.title.includes("最近生成："), "含最近生成时间");
	assert(view.title.includes("有效 2 封 / 共 3 封"), "含邮件数");
	assert(view.title.includes("待审 1 封"), "含待审数");
	assert(view.title.includes("上次尝试："), "含上次尝试时间");
	assert(view.title.includes("未找到合适联系人"), "含尝试原因");
});

test("未来时间不产生负数文案", () => {
	const view = describeDevState(generated(-2 * HOUR), null, NOW);
	assertEqual(view.text, "刚刚", "未来按刚刚");
	assertEqual(view.level, "ok", "仍然在 24h 内");
});

test("attempt.at 非法时副行只有原因", () => {
	const view = describeDevState(
		NEVER_GENERATION,
		{ ...attempt("no_contact", null), at: "不是时间" },
		NOW,
	);
	assertEqual(view.detail, "⚠ 无可用联系人", "不带相对时间");
});
