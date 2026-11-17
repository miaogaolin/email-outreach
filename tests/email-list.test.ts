import {
	dedupePendingRows,
	emailRecencyMs,
	filterEmailRows,
	isPendingStatus,
	matchesCustomerFilter,
	normalizeEmail,
	type EmailListQuery,
} from "../src/core/email-list";
import type { EmailRow, EmailStatus } from "../src/core/types";
import { assert, assertEqual, suite, test } from "./harness";

function row(options: {
	id: string;
	status: EmailStatus;
	email?: string;
	filePath?: string;
	customerName?: string;
	customerLink?: string;
	updatedAt?: string;
	summaryZh?: string;
	subject?: string;
}): EmailRow {
	const filePath = options.filePath ?? "输出/Acme - AI开发信息.md";
	const customerName = options.customerName ?? "Acme";
	const customerLink = options.customerLink ?? "Acme";
	const updatedAt = options.updatedAt ?? "2026-11-17T09:12:00+08:00";
	return {
		key: `${filePath}#${options.id}`,
		filePath,
		customerName,
		customerLink,
		record: {
			id: options.id,
			contact: "John",
			email: options.email ?? "john@acme.com",
			language: "en",
			languageLabel: "英语",
			summaryZh: options.summaryZh ?? "摘要",
			suggestedTime: null,
			timezone: null,
			timeReason: null,
			status: options.status,
			generatedAt: updatedAt,
			updatedAt,
			sent: false,
			sentAt: null,
			subject: options.subject ?? "Subject",
			body: "Body",
			versions: [],
			extraMeta: {},
		},
	};
}

function query(overrides: Partial<EmailListQuery> = {}): EmailListQuery {
	return {
		status: "all",
		search: "",
		customer: null,
		showDuplicatePending: false,
		...overrides,
	};
}

suite("email list");

test("isPendingStatus", () => {
	assert(isPendingStatus("Generated"), "Generated 待审");
	assert(!isPendingStatus("Accepted"), "Accepted 不是待审");
	assert(!isPendingStatus("Rejected"), "Rejected 不是待审");
});

test("normalizeEmail 忽略大小写与首尾空格", () => {
	assertEqual(normalizeEmail("  John@Acme.COM "), "john@acme.com", "归一化");
	assertEqual(normalizeEmail(""), "", "空串");
	assertEqual(normalizeEmail("   "), "", "只有空格");
});

test("同一客户同一邮箱：只保留最新待审，顺序不变", () => {
	const older = row({
		id: "1",
		status: "Generated",
		updatedAt: "2026-11-16T18:30:00+08:00",
	});
	const newer = row({
		id: "2",
		status: "Generated",
		updatedAt: "2026-11-17T09:12:00+08:00",
	});
	const other = row({ id: "3", status: "Generated", email: "mary@acme.com" });
	const result = dedupePendingRows([older, newer, other]);
	assertEqual(result.kept.map((item) => item.key), [newer.key, other.key], "保留最新");
	assertEqual(result.hidden.map((item) => item.key), [older.key], "隐藏旧的");
});

test("同一邮箱属于两个客户：默认各自保留，global 只留最新", () => {
	const a = row({
		id: "1",
		status: "Generated",
		filePath: "输出/A - AI开发信息.md",
		customerName: "A",
		customerLink: "A",
		updatedAt: "2026-11-16T09:00:00+08:00",
	});
	const b = row({
		id: "1",
		status: "Generated",
		filePath: "输出/B - AI开发信息.md",
		customerName: "B",
		customerLink: "B",
		updatedAt: "2026-11-17T09:00:00+08:00",
	});
	assertEqual(dedupePendingRows([a, b]).hidden.length, 0, "customer scope 都保留");
	const global = dedupePendingRows([a, b], "global");
	assertEqual(global.hidden.map((item) => item.key), [a.key], "global 只留最新");
});

test("最新已验收时旧待审也隐藏", () => {
	const pending = row({
		id: "1",
		status: "Generated",
		updatedAt: "2026-11-16T09:00:00+08:00",
	});
	const accepted = row({
		id: "2",
		status: "Accepted",
		updatedAt: "2026-11-17T09:00:00+08:00",
	});
	const result = dedupePendingRows([pending, accepted]);
	assertEqual(result.hidden.map((item) => item.key), [pending.key], "旧待审隐藏");
	assertEqual(result.kept.map((item) => item.key), [accepted.key], "已验收保留");
});

test("最新待审比旧验收新时，两封都显示", () => {
	const accepted = row({
		id: "1",
		status: "Accepted",
		updatedAt: "2026-11-16T09:00:00+08:00",
	});
	const pending = row({
		id: "2",
		status: "Generated",
		updatedAt: "2026-11-17T09:00:00+08:00",
	});
	const result = dedupePendingRows([accepted, pending]);
	assertEqual(result.hidden.length, 0, "旧 Accepted 不被隐藏");
});

test("更新的已拒绝不抑制旧待审", () => {
	const pending = row({
		id: "1",
		status: "Generated",
		updatedAt: "2026-11-16T09:00:00+08:00",
	});
	const rejected = row({
		id: "2",
		status: "Rejected",
		updatedAt: "2026-11-17T09:00:00+08:00",
	});
	const result = dedupePendingRows([pending, rejected]);
	assertEqual(result.hidden.length, 0, "拒绝不抑制旧待审");
	assertEqual(result.kept.length, 2, "两封都保留");
});

test("时间相同按邮件 ID 数字大者优先", () => {
	const low = row({ id: "9", status: "Generated" });
	const high = row({ id: "12", status: "Generated" });
	const result = dedupePendingRows([low, high]);
	assertEqual(result.kept.map((item) => item.key), [high.key], "保留 ID 大的");
});

test("空邮箱不参与合并", () => {
	const first = row({ id: "1", status: "Generated", email: "  " });
	const second = row({ id: "2", status: "Generated", email: "" });
	const result = dedupePendingRows([first, second]);
	assertEqual(result.hidden.length, 0, "没有隐藏");
	assertEqual(result.kept.length, 2, "都保留");
});

suite("email list filters");

test("客户筛选：AI 文件路径 / 双链 basename / 客户路径", () => {
	const target = row({
		id: "1",
		status: "Generated",
		filePath: "输出/Acme - AI开发信息.md",
		customerName: "Acme",
		customerLink: "Acme",
	});
	const otherCustomer = row({
		id: "2",
		status: "Generated",
		filePath: "输出/Beta - AI开发信息.md",
		customerName: "Beta",
		customerLink: "客户/Beta",
	});
	const byFile = {
		path: "客户/Acme.md",
		name: "Acme",
		aiFilePath: "输出/Acme - AI开发信息.md",
	};
	assert(matchesCustomerFilter(target, byFile), "AI 文件路径命中");
	assert(!matchesCustomerFilter(otherCustomer, byFile), "别的客户不命中");

	const byName = { path: "客户/Acme.md", name: "Acme", aiFilePath: null };
	assert(matchesCustomerFilter(target, byName), "basename / 客户名兜底");

	const byPath = {
		path: "客户/Beta.md",
		name: "Beta",
		aiFilePath: null,
	};
	assert(matchesCustomerFilter(otherCustomer, byPath), "客户路径命中");
	assert(!matchesCustomerFilter(target, byPath), "路径不同不命中");

	assert(matchesCustomerFilter(target, null), "没有客户筛选时全部通过");
});

test("hiddenDuplicateCount 只统计通过过滤的隐藏行", () => {
	const older = row({ id: "1", status: "Generated", summaryZh: "旧草稿" });
	const newer = row({ id: "2", status: "Generated", summaryZh: "新草稿" });
	const rejected = row({ id: "3", status: "Rejected", email: "bob@acme.com" });

	const all = filterEmailRows([older, newer, rejected], query());
	assertEqual(all.visible.map((item) => item.key), [newer.key], "all 排除 Rejected");
	assertEqual(all.hiddenDuplicateCount, 1, "隐藏 1 封旧待审");

	const onlyRejected = filterEmailRows(
		[older, newer, rejected],
		query({ status: "Rejected" }),
	);
	assertEqual(onlyRejected.visible.length, 1, "已拒绝可见");
	assertEqual(onlyRejected.hiddenDuplicateCount, 0, "被隐藏的待审不通过状态过滤");

	const shown = filterEmailRows(
		[older, newer, rejected],
		query({ showDuplicatePending: true }),
	);
	assertEqual(shown.visible.map((item) => item.key), [older.key, newer.key], "打开开关后旧待审也可见");
	assertEqual(shown.hiddenDuplicateCount, 1, "仍然报告隐藏数");
});

test("搜索只命中旧待审时给出被合并提示", () => {
	const older = row({
		id: "1",
		status: "Generated",
		summaryZh: "旧草稿关键词",
	});
	const newer = row({ id: "2", status: "Generated", summaryZh: "新草稿" });
	const hiddenSearch = filterEmailRows(
		[older, newer],
		query({ search: "旧草稿关键词" }),
	);
	assertEqual(hiddenSearch.visible.length, 0, "默认看不到被隐藏的旧草稿");
	assertEqual(hiddenSearch.hiddenDuplicateCount, 1, "提示有 1 封被合并");

	const shown = filterEmailRows(
		[older, newer],
		query({ search: "旧草稿关键词", showDuplicatePending: true }),
	);
	assertEqual(shown.visible.map((item) => item.key), [older.key], "打开开关后能搜到");
});

test("客户筛选与状态筛选叠加", () => {
	const a = row({
		id: "1",
		status: "Accepted",
		filePath: "输出/A - AI开发信息.md",
		customerName: "A",
		customerLink: "A",
	});
	const b = row({
		id: "2",
		status: "Accepted",
		filePath: "输出/B - AI开发信息.md",
		customerName: "B",
		customerLink: "B",
	});
	const result = filterEmailRows(
		[a, b],
		query({
			status: "Accepted",
			customer: { path: "客户/A.md", name: "A", aiFilePath: null },
		}),
	);
	assertEqual(result.visible.map((item) => item.key), [a.key], "只留 A 的已验收");
});

suite("email recency");

test("emailRecencyMs 优先 updatedAt，回退到 generatedAt / 版本时间", () => {
	const updated = row({ id: "1", status: "Generated" });
	assertEqual(
		emailRecencyMs(updated),
		new Date("2026-11-17T09:12:00+08:00").getTime(),
		"用 updatedAt",
	);

	const generated = row({ id: "2", status: "Generated" });
	generated.record.updatedAt = "";
	assertEqual(
		emailRecencyMs(generated),
		new Date("2026-11-17T09:12:00+08:00").getTime(),
		"回退 generatedAt",
	);

	const legacy = row({ id: "3", status: "Generated" });
	legacy.record.updatedAt = "";
	legacy.record.generatedAt = "";
	legacy.record.versions = [
		{
			version: 1,
			at: "2026-11-10 20:19",
			action: "Generated",
			userComment: "",
			subject: "s",
			body: "b",
		},
	];
	assertEqual(
		emailRecencyMs(legacy),
		new Date(2026, 10, 10, 20, 19, 0, 0).getTime(),
		"回退版本时间",
	);

	const invalid = row({ id: "4", status: "Generated" });
	invalid.record.updatedAt = "不是时间";
	invalid.record.generatedAt = "";
	assertEqual(emailRecencyMs(invalid), 0, "非法时间按 0");
});
