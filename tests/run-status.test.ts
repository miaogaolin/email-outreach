import {
	parseRunStatusFile,
	statusLabel,
	statusNeedsAttention,
	summarizeRunStatuses,
} from "../src/core/run-status";
import type { DevStatusMap } from "../src/core/types";
import { assert, assertEqual, suite, test } from "./harness";

function map(): DevStatusMap {
	return {
		"a.md": {
			kind: "generated",
			customerName: "A",
			emailCount: 2,
			message: "已生成 2 封",
			at: "2026-11-13T10:00:00+08:00",
		},
		"b.md": {
			kind: "no_contact",
			customerName: "B",
			emailCount: 0,
			message: "没有联系人",
			at: "2026-11-13T10:00:00+08:00",
		},
		"c.md": {
			kind: "no_suitable",
			customerName: "C",
			emailCount: 0,
			message: "没有合适联系人",
			at: "2026-11-13T10:00:00+08:00",
		},
		"d.md": {
			kind: "failed",
			customerName: "D",
			emailCount: 0,
			message: "失败",
			at: "2026-11-13T10:00:00+08:00",
		},
	};
}

suite("run status");
test("labels and attention", () => {
	const data = map();
	assertEqual(statusLabel(data["a.md"]!), "已生成 2 封", "生成文案");
	assertEqual(statusLabel(data["b.md"]!), "无可用联系人", "无联系人文案");
	assertEqual(statusLabel(data["c.md"]!), "未找到合适联系人", "无合适文案");
	assertEqual(statusLabel(data["d.md"]!), "执行失败", "失败文案");
	assert(!statusNeedsAttention(data["a.md"]!), "生成成功不需要提醒");
	assert(statusNeedsAttention(data["b.md"]!), "无联系人需要提醒");
});

test("summary counts generated emails and attention", () => {
	const summary = summarizeRunStatuses(map());
	assertEqual(summary.generatedCustomers, 1, "生成客户数");
	assertEqual(summary.generatedEmailCount, 2, "生成邮件数");
	assertEqual(summary.noContact, 1, "无联系人");
	assertEqual(summary.noSuitable, 1, "无合适联系人");
	assertEqual(summary.failed, 1, "失败");
	assertEqual(summary.attention.length, 3, "提醒数量");
	assertEqual(
		summary.attention.map((status) => status.customerName),
		["B", "C", "D"],
		"提醒按客户名排序",
	);
});

test("parses a valid status file", () => {
	const parsed = parseRunStatusFile({
		at: "2026-11-13T10:00:00+08:00",
		customers: map(),
	});
	assert(parsed, "应解析成功");
	assertEqual(Object.keys(parsed!.customers).length, 4, "四个客户");
	assertEqual(parsed!.customers["a.md"]?.emailCount, 2, "邮件数");
});

test("rejects invalid status files", () => {
	assertEqual(parseRunStatusFile("not json"), null, "非 JSON");
	assertEqual(parseRunStatusFile({ customers: [] }), null, "customers 不是对象");
	const invalidEntry = parseRunStatusFile({
		at: "",
		customers: { "a.md": { kind: "unknown" } },
	});
	assert(invalidEntry, "文件结构仍然可读");
	assertEqual(
		Object.keys(invalidEntry!.customers).length,
		0,
		"非法条目被忽略",
	);
});
