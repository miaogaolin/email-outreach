import {
	formatBeijingTime,
	planSendTime,
	resolveTimezone,
	sendHistoryFrom,
} from "../src/core/send-time";
import { createEmailRecord } from "../src/core/ai-file";
import type { EmailRecord } from "../src/core/types";
import { assert, assertEqual, suite, test } from "./harness";

const US = "美国";

suite("send time");

test("首次联系：客户当地时间下一个工作日 09:30", () => {
	const plan = planSendTime({
		region: US,
		now: new Date("2026-11-13T12:00:00Z"), // 纽约 07:00（周五）
	});
	assertEqual(plan.timezone, "America/New_York", "美国默认时区");
	assertEqual(plan.suggestedTime, "2026-11-13 09:30", "当天 09:30");
	assertEqual(plan.utcIso, "2026-11-13T14:30:00.000Z", "EST 偏移");
	assert(plan.timeReason.includes("北京时间"), "包含北京时间对照");
});

test("已过 09:30 或周末：顺延到下一个工作日", () => {
	const after = planSendTime({
		region: US,
		now: new Date("2026-11-13T16:00:00Z"), // 纽约 11:00（周五）
	});
	assertEqual(after.suggestedTime, "2026-11-16 09:30", "周五已过 → 周一");

	const weekend = planSendTime({
		region: US,
		now: new Date("2026-11-14T12:00:00Z"), // 纽约 07:00（周六）
	});
	assertEqual(weekend.suggestedTime, "2026-11-16 09:30", "周末 → 周一");
});

test("跟进节奏：第 2 次跟进间隔 5 个工作日", () => {
	const plan = planSendTime({
		region: US,
		now: new Date("2026-11-13T12:00:00Z"),
		history: {
			followUpCount: 2,
			lastContact: "2026-11-11",
			sentDates: [],
		},
	});
	assertEqual(plan.suggestedTime, "2026-11-18 09:30", "11-11 + 5 个工作日");
	assert(plan.timeReason.includes("5 个工作日"), "理由说明间隔");
});

test("已发送记录多于跟进次数时按发送记录计算", () => {
	const plan = planSendTime({
		region: US,
		now: new Date("2026-11-13T12:00:00Z"),
		history: {
			followUpCount: 0,
			lastContact: null,
			sentDates: ["2026-11-11T15:00:00+08:00"],
		},
	});
	assertEqual(plan.suggestedTime, "2026-11-16 09:30", "按最近发送 + 3 个工作日");
	assert(plan.timeReason.includes("已跟进 1 次"), "按发送记录算 1 次");
});

test("同客户多封邮件按工作日错峰", () => {
	const base = {
		region: US,
		now: new Date("2026-11-13T12:00:00Z"),
	};
	assertEqual(
		planSendTime({ ...base, sequence: 0 }).suggestedTime,
		"2026-11-13 09:30",
		"第一封",
	);
	assertEqual(
		planSendTime({ ...base, sequence: 1 }).suggestedTime,
		"2026-11-16 09:30",
		"第二封顺延 1 个工作日",
	);
	assertEqual(
		planSendTime({ ...base, sequence: 2 }).suggestedTime,
		"2026-11-17 09:30",
		"第三封顺延 2 个工作日",
	);
});

test("夏令时切换后使用正确偏移", () => {
	const plan = planSendTime({
		region: US,
		now: new Date("2026-03-09T12:00:00Z"), // 纽约 08:00，EDT
	});
	assertEqual(plan.suggestedTime, "2026-03-09 09:30", "本地 09:30");
	assertEqual(plan.utcIso, "2026-03-09T13:30:00.000Z", "EDT 偏移 -4");
});

test("多时区国家按城市关键词解析", () => {
	assertEqual(
		resolveTimezone("美国 加州").timezone,
		"America/Los_Angeles",
		"美国西部",
	);
	assertEqual(
		resolveTimezone("澳大利亚 珀斯").timezone,
		"Australia/Perth",
		"澳洲西部",
	);
	assertEqual(
		resolveTimezone("俄罗斯 新西伯利亚").timezone,
		"Asia/Novosibirsk",
		"俄罗斯新西伯利亚",
	);
	assertEqual(
		resolveTimezone("美国 纽约").timezone,
		"America/New_York",
		"美国东部",
	);
});

test("未知地区回退北京时间并提示", () => {
	const resolved = resolveTimezone("火星");
	assertEqual(resolved.timezone, "Asia/Shanghai", "回退北京时间");
	assertEqual(resolved.source, "fallback", "标记为回退");
	const plan = planSendTime({
		region: "火星",
		now: new Date("2026-11-13T00:00:00Z"), // 北京 08:00
	});
	assertEqual(plan.suggestedTime, "2026-11-13 09:30", "北京时间 09:30");
	assert(plan.timeReason.includes("地区未识别"), "理由提示补充地区");
});

test("未来的最近联系时间按今天处理", () => {
	const plan = planSendTime({
		region: US,
		now: new Date("2026-11-13T12:00:00Z"),
		history: {
			followUpCount: 0,
			lastContact: "2099-01-01",
			sentDates: [],
		},
	});
	assertEqual(plan.suggestedTime, "2026-11-13 09:30", "不排到未来日期");
});

test("建议发送时间换算成北京时间展示", () => {
	assertEqual(
		formatBeijingTime("2026-11-13 09:30", "America/New_York"),
		"2026-11-13 22:30",
		"EST 换算",
	);
	assertEqual(
		formatBeijingTime("2026-03-09 09:30", "America/New_York"),
		"2026-03-09 21:30",
		"EDT 换算",
	);
	assertEqual(
		formatBeijingTime("2026-11-13 09:30", "Asia/Shanghai"),
		"2026-11-13 09:30",
		"北京时间不变",
	);
	assertEqual(
		formatBeijingTime("2026-11-13 09:30", "Mars/Olympus"),
		"2026-11-13 09:30",
		"未知时区回退北京时间",
	);
	assertEqual(
		formatBeijingTime("不是时间", "America/New_York"),
		null,
		"无法解析返回 null",
	);
});

test("sendHistoryFrom 只统计已发送邮件", () => {
	const sent = createEmailRecord({
		contactRaw: "A",
		email: "a@example.com",
		language: "en",
		languageLabel: "英语",
		summaryZh: "摘要",
		subject: "s",
		body: "b",
		suggestedTime: null,
		timezone: null,
		timeReason: null,
	});
	const unsent = createEmailRecord({
		contactRaw: "B",
		email: "b@example.com",
		language: "en",
		languageLabel: "英语",
		summaryZh: "摘要",
		subject: "s",
		body: "b",
		suggestedTime: null,
		timezone: null,
		timeReason: null,
	});
	const sentRecord: EmailRecord = {
		...sent,
		sent: true,
		sentAt: "2026-11-10T10:00:00+08:00",
	};
	const history = sendHistoryFrom(
		{ 跟进次数: "2", 最近联系时间: "2026-11-10" },
		[sentRecord, unsent],
	);
	assertEqual(history.followUpCount, 2, "跟进次数");
	assertEqual(history.lastContact, "2026-11-10", "最近联系时间");
	assertEqual(history.sentDates.length, 1, "只统计已发送");
});
