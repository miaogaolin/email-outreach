import {
	buildGenerationIndex,
	customerGenerationInput,
	describeGenerationFilter,
	emailGeneratedAt,
	formatElapsed,
	formatGenerationAge,
	matchesGenerationFilter,
	NEVER_GENERATION,
	normalizeGenerationFilter,
	parseGenerationTime,
	summarizeGeneration,
	withinCooldown,
	type CustomerGeneration,
	type GenerationFileInput,
} from "../src/core/generation";
import type {
	CustomerRecord,
	EmailRecord,
	EmailStatus,
} from "../src/core/types";
import { assert, assertEqual, suite, test } from "./harness";

const NOW = new Date("2026-11-17T10:00:00+08:00");
const NOW_MS = NOW.getTime();

function email(
	id: string,
	status: EmailStatus,
	generatedAt = "2026-11-16T09:12:00+08:00",
	extra: Partial<EmailRecord> = {},
): EmailRecord {
	return {
		id,
		contact: "John",
		email: "john@acme.com",
		language: "en",
		languageLabel: "英语",
		summaryZh: "摘要",
		suggestedTime: null,
		timezone: null,
		timeReason: null,
		status,
		generatedAt,
		updatedAt: generatedAt,
		sent: false,
		sentAt: null,
		subject: "Subject",
		body: "Body",
		versions: [],
		extraMeta: {},
		...extra,
	};
}

function customer(
	path: string,
	name: string,
	linkedAIPaths: string[] = [],
): { path: string; name: string; linkedAIPaths: string[] } {
	return { path, name, linkedAIPaths };
}

function generatedAtMs(deltaMs: number): number {
	return NOW_MS - deltaMs;
}

const HOUR = 3600000;
const DAY = 86400000;

suite("generation time parsing");

test("带偏移的 ISO 按绝对时间解析", () => {
	assertEqual(
		parseGenerationTime("2026-11-16T09:12:00+08:00"),
		Date.UTC(2026, 10, 16, 1, 12, 0),
		"+08:00",
	);
	assertEqual(
		parseGenerationTime("2026-11-16T09:12:00Z"),
		Date.UTC(2026, 10, 16, 9, 12, 0),
		"Z",
	);
});

test("YYYY-MM-DD HH:mm 与纯日期按本地时间解析", () => {
	assertEqual(
		parseGenerationTime("2026-11-10 20:19"),
		new Date(2026, 10, 10, 20, 19, 0, 0).getTime(),
		"本地时间",
	);
	assertEqual(
		parseGenerationTime("2026-11-10"),
		new Date(2026, 10, 10, 0, 0, 0, 0).getTime(),
		"纯日期按当天 0 点",
	);
});

test("非法时间返回 null", () => {
	for (const value of [
		"",
		"   ",
		"not a time",
		"2026-13-40 10:00",
		"2026-02-30 10:00",
		"2026-11-10 25:00",
		"2026/11/10",
	]) {
		assertEqual(parseGenerationTime(value), null, `应判为非法：${value}`);
	}
});

test("emailGeneratedAt 回退到第一个版本时间", () => {
	assertEqual(
		emailGeneratedAt(email("1", "Generated", "2026-11-16 09:12")),
		"2026-11-16 09:12",
		"有 generatedAt",
	);
	const legacy = email("2", "Generated", "", {
		generatedAt: "",
		versions: [
			{
				version: 1,
				at: "2026-11-10 20:19",
				action: "Generated",
				userComment: "",
				subject: "s",
				body: "b",
			},
		],
	});
	assertEqual(emailGeneratedAt(legacy), "2026-11-10 20:19", "回退版本时间");
	assertEqual(
		emailGeneratedAt(email("3", "Generated", "", { generatedAt: "" })),
		"",
		"都没有时为空",
	);
});

suite("generation summary");

test("多封取最大时间并忽略已拒绝", () => {
	const info = summarizeGeneration(
		[
			email("1", "Generated", "2026-11-10 09:00"),
			email("2", "Accepted", "2026-11-12 09:00"),
			email("3", "Generated", "2026-11-15 09:00"),
			email("4", "Rejected", "2026-11-16 09:00"),
		],
		true,
	);
	assertEqual(info.state, "known", "有邮件即 known");
	assertEqual(info.lastGeneratedAt, "2026-11-15 09:00", "取最大时间");
	assertEqual(info.emailCount, 3, "有效邮件数");
	assertEqual(info.totalEmailCount, 4, "总邮件数");
	assertEqual(info.pendingCount, 2, "待审计数");
	assertEqual(info.allRejected, false, "不是全部拒绝");
	assertEqual(info.lastStatus, "Generated", "最近一封的状态");
});

test("全部已拒绝：state 仍为 known、时间为空", () => {
	const info = summarizeGeneration(
		[email("1", "Rejected", "2026-11-16 09:00")],
		true,
	);
	assertEqual(info.state, "known", "有邮件块");
	assertEqual(info.lastGeneratedMs, null, "没有有效生成");
	assertEqual(info.allRejected, true, "全部拒绝");
	assertEqual(info.pendingCount, 0, "没有待审");
});

test("AI 文件存在但解析不出邮件 → unknown", () => {
	const info = summarizeGeneration([], true);
	assertEqual(info.state, "unknown", "unknown");
	assertEqual(info.lastGeneratedMs, null, "没有时间");
	assertEqual(summarizeGeneration([], false).state, "never", "没有文件 → never");
});

test("pendingCount 只数 Generated", () => {
	const info = summarizeGeneration(
		[
			email("1", "Generated"),
			email("2", "Generated"),
			email("3", "Accepted"),
			email("4", "Rejected"),
		],
		true,
	);
	assertEqual(info.pendingCount, 2, "待审计数");
});

suite("generation index");

test("双链带目录时与客户路径完全一致", () => {
	const files: GenerationFileInput[] = [
		{
			path: "输出/Acme - AI开发信息.md",
			customerLink: "客户/Acme",
			emails: [email("1", "Generated", "2026-11-16 09:00")],
		},
	];
	const index = buildGenerationIndex(files, [
		customer("客户/Acme.md", "Acme"),
		customer("其他/Acme.md", "Acme"),
	]);
	assertEqual(
		index.byCustomer.get("客户/Acme.md")?.lastGeneratedAt,
		"2026-11-16 09:00",
		"精确命中的客户",
	);
	assertEqual(
		index.byCustomer.get("其他/Acme.md"),
		undefined,
		"同 basename 的另一个客户不被误归属",
	);
	assertEqual(index.unmatchedFiles.length, 0, "没有孤立文件");
});

test("客户改名后靠唯一 basename 命中", () => {
	const files: GenerationFileInput[] = [
		{
			path: "输出/Old Name - AI开发信息.md",
			customerLink: "Old Name",
			emails: [email("1", "Generated", "2026-11-16 09:00")],
		},
	];
	const index = buildGenerationIndex(files, [
		customer("客户/New Name.md", "New Name"),
	]);
	assertEqual(
		index.byCustomer.get("客户/New Name.md"),
		undefined,
		"名字对不上就不归属",
	);
	assertEqual(index.unmatchedFiles.length, 1, "计入无法对应");

	const matched = buildGenerationIndex(files, [
		customer("客户/Old Name.md", "Old Name"),
	]);
	assertEqual(
		matched.byCustomer.get("客户/Old Name.md")?.lastGeneratedAt,
		"2026-11-16 09:00",
		"basename 唯一时归属",
	);
});

test("双链 basename 对不上时用 AI 文件名兜底", () => {
	const index = buildGenerationIndex(
		[
			{
				path: "输出/Acme - AI开发信息.md",
				// 旧双链已经失效，但文件名仍然可辨认。
				customerLink: "某个旧名字",
				emails: [email("1", "Generated", "2026-11-16 09:00")],
			},
		],
		[customer("客户/Acme.md", "Acme")],
	);
	assertEqual(
		index.byCustomer.get("客户/Acme.md")?.lastGeneratedAt,
		"2026-11-16 09:00",
		"按文件名归属",
	);
	assertEqual(index.unmatchedFiles.length, 0, "不算孤立");
});

test("同名客户出现歧义时按未知处理", () => {
	const files: GenerationFileInput[] = [
		{
			path: "输出/Acme - AI开发信息.md",
			customerLink: "Acme",
			emails: [email("1", "Generated", "2026-11-16 09:00")],
		},
	];
	const index = buildGenerationIndex(files, [
		customer("a/Acme.md", "Acme"),
		customer("b/Acme.md", "Acme"),
	]);
	assertEqual(
		index.byCustomer.get("a/Acme.md")?.state,
		"unknown",
		"歧义 → unknown",
	);
	assertEqual(
		index.byCustomer.get("b/Acme.md")?.state,
		"unknown",
		"歧义 → unknown",
	);
	assertEqual(index.unmatchedFiles, [files[0]!.path], "文件无法对应");
});

test("客户 AI开发信息 双链反查命中", () => {
	const filePath = "输出/Renamed - AI开发信息.md";
	const record: CustomerRecord = {
		path: "客户/Renamed.md",
		name: "Renamed",
		fm: { AI开发信息: "[[输出/Renamed - AI开发信息]]" },
		tags: [],
		mtime: 0,
	};
	const input = customerGenerationInput(record, "AI开发信息");
	assertEqual(input.linkedAIPaths, ["输出/Renamed - AI开发信息"], "解析双链");
	const index = buildGenerationIndex(
		[
			{
				path: filePath,
				// 文件名与客户名都对不上，只能靠属性反查。
				customerLink: "旧名字",
				emails: [email("1", "Accepted", "2026-11-14 09:00")],
			},
		],
		[input],
	);
	assertEqual(
		index.byCustomer.get("客户/Renamed.md")?.lastGeneratedAt,
		"2026-11-14 09:00",
		"反查命中",
	);
	assertEqual(index.unmatchedFiles.length, 0, "不算孤立");
});

test("同一客户多个 AI 文件合并，filePath 指向最近生成的一个", () => {
	const index = buildGenerationIndex(
		[
			{
				path: "输出/Acme - AI开发信息.md",
				customerLink: "客户/Acme",
				emails: [email("1", "Generated", "2026-11-10 09:00")],
			},
			{
				path: "输出/Acme-旧 - AI开发信息.md",
				customerLink: "客户/Acme",
				emails: [
					email("1", "Generated", "2026-11-16 09:00"),
					email("2", "Accepted", "2026-11-15 09:00"),
				],
			},
		],
		[customer("客户/Acme.md", "Acme")],
	);
	const info = index.byCustomer.get("客户/Acme.md")!;
	assertEqual(info.totalEmailCount, 3, "邮件合并");
	assertEqual(info.lastGeneratedAt, "2026-11-16 09:00", "取最大时间");
	assertEqual(
		info.filePath,
		"输出/Acme-旧 - AI开发信息.md",
		"filePath 指向最近生成的文件",
	);
});

test("命中文件但没有邮件块 → unknown，并保留 filePath", () => {
	const index = buildGenerationIndex(
		[
			{
				path: "输出/Acme - AI开发信息.md",
				customerLink: "客户/Acme",
				emails: [],
			},
		],
		[customer("客户/Acme.md", "Acme")],
	);
	const info = index.byCustomer.get("客户/Acme.md")!;
	assertEqual(info.state, "unknown", "unknown");
	assertEqual(info.filePath, "输出/Acme - AI开发信息.md", "filePath 保留");
	assertEqual(info.pendingCount, 0, "没有待审");
});

suite("generation filter");

function known(deltaMs: number): CustomerGeneration {
	return {
		...NEVER_GENERATION,
		state: "known",
		lastGeneratedAt: new Date(generatedAtMs(deltaMs)).toISOString(),
		lastGeneratedMs: generatedAtMs(deltaMs),
		emailCount: 1,
		totalEmailCount: 1,
	};
}

const stale1 = { mode: "stale", days: 1, includeNever: true } as const;
const staleWithoutNever = {
	mode: "stale",
	days: 1,
	includeNever: false,
} as const;

test("off 永远放行；never 只选从未/全部拒绝", () => {
	const off = { mode: "off", days: 1, includeNever: true } as const;
	assert(matchesGenerationFilter(known(DAY), off, NOW), "off 放行");
	assert(matchesGenerationFilter(NEVER_GENERATION, off, NOW), "off 也放行从未");
	assert(!matchesGenerationFilter(known(DAY * 40), {
		mode: "never",
		days: 1,
		includeNever: true,
	}, NOW), "生成过的不算从未");
	assert(
		matchesGenerationFilter(undefined, {
			mode: "never",
			days: 1,
			includeNever: true,
		}, NOW),
		"没有索引也算从未",
	);
	const rejected = {
		...NEVER_GENERATION,
		state: "known" as const,
		allRejected: true,
		totalEmailCount: 1,
	};
	assert(
		matchesGenerationFilter(rejected, {
			mode: "never",
			days: 1,
			includeNever: true,
		}, NOW),
		"只有已拒绝算从未",
	);
});

test("stale 按绝对时间差与 includeNever", () => {
	assert(matchesGenerationFilter(known(DAY), stale1, NOW), "刚好 24h 算未生成");
	assert(!matchesGenerationFilter(known(HOUR * 23), stale1, NOW), "23h 不算");
	assert(matchesGenerationFilter(NEVER_GENERATION, stale1, NOW), "含从未");
	assert(
		!matchesGenerationFilter(NEVER_GENERATION, staleWithoutNever, NOW),
		"不含从未时隐藏",
	);
	assert(
		matchesGenerationFilter(known(DAY * 3), staleWithoutNever, NOW),
		"已生成过的仍然出现",
	);
});

test("fresh 只选窗口内生成过的客户", () => {
	const fresh = { mode: "fresh", days: 1, includeNever: true } as const;
	assert(matchesGenerationFilter(known(HOUR), fresh, NOW), "1 小时前");
	assert(!matchesGenerationFilter(known(DAY), fresh, NOW), "刚好 24h 不算");
	assert(!matchesGenerationFilter(NEVER_GENERATION, fresh, NOW), "从未不选");
	assert(
		!matchesGenerationFilter({ ...NEVER_GENERATION, state: "unknown" }, fresh, NOW),
		"未知不选",
	);
});

test("未知状态与未来时间", () => {
	const unknown: CustomerGeneration = { ...NEVER_GENERATION, state: "unknown" };
	assert(!matchesGenerationFilter(unknown, stale1, NOW), "未知不被 stale 选中");
	const future = known(-HOUR);
	assert(!matchesGenerationFilter(future, stale1, NOW), "未来时间不算未生成");
	assert(matchesGenerationFilter(future, {
		mode: "fresh",
		days: 1,
		includeNever: true,
	}, NOW), "未来时间算刚刚生成");
});

test("冷却窗口边界", () => {
	assert(withinCooldown(known(HOUR * 23 + 59000), NOW, 24), "23h59m 拦截");
	assert(!withinCooldown(known(DAY), NOW, 24), "正好 24h 放行");
	assert(!withinCooldown(known(HOUR), NOW, 0), "0 表示关闭");
	assert(!withinCooldown(NEVER_GENERATION, NOW, 24), "从未不拦截");
	assert(!withinCooldown(undefined, NOW, 24), "没有索引不拦截");
	assert(
		!withinCooldown({ ...NEVER_GENERATION, state: "known", allRejected: true }, NOW, 24),
		"全部已拒绝不拦截",
	);
});

test("冷却在 AI 文件缺失时用上次生成记录兜底", () => {
	const fallback = generatedAtMs(HOUR * 2);
	assert(
		withinCooldown(NEVER_GENERATION, NOW, 24, fallback),
		"兜底锚点生效",
	);
	assert(
		!withinCooldown(NEVER_GENERATION, NOW, 24, generatedAtMs(DAY * 2)),
		"兜底锚点超过窗口则放行",
	);
	assert(
		withinCooldown(undefined, NOW, 24, fallback),
		"没有索引时兜底也生效",
	);
	assert(!withinCooldown(undefined, NOW, 24, null), "null 兜底不拦截");
	assert(
		!withinCooldown(known(-HOUR), NOW, 24),
		"未来时间不锁死冷却",
	);
});

suite("generation display");

test("formatElapsed 各档位", () => {
	assertEqual(formatElapsed(generatedAtMs(59000), NOW), "刚刚", "59 秒");
	assertEqual(formatElapsed(generatedAtMs(59 * 60000), NOW), "59 分钟前", "59 分钟");
	assertEqual(formatElapsed(generatedAtMs(23 * HOUR), NOW), "23 小时前", "23 小时");
	assertEqual(formatElapsed(generatedAtMs(25 * HOUR), NOW), "昨天", "25 小时");
	assertEqual(formatElapsed(generatedAtMs(29 * DAY), NOW), "29 天前", "29 天");
	const oldMs = generatedAtMs(31 * DAY);
	const old = new Date(oldMs);
	const expectedOld =
		`${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, "0")}-` +
		`${String(old.getDate()).padStart(2, "0")}`;
	assertEqual(formatElapsed(oldMs, NOW), expectedOld, "31 天显示日期");
	assertEqual(formatElapsed(generatedAtMs(-HOUR), NOW), "刚刚", "未来时间不出现负数");
});

test("formatGenerationAge 覆盖从未 / 未知 / 已拒绝", () => {
	assertEqual(formatGenerationAge(undefined, NOW), "从未", "undefined");
	assertEqual(formatGenerationAge(NEVER_GENERATION, NOW), "从未", "never");
	assertEqual(
		formatGenerationAge({ ...NEVER_GENERATION, state: "unknown" }, NOW),
		"未知",
		"unknown",
	);
	assertEqual(
		formatGenerationAge(
			{ ...NEVER_GENERATION, state: "known", allRejected: true },
			NOW,
		),
		"已拒绝",
		"全部拒绝",
	);
	assertEqual(formatGenerationAge(known(DAY * 3), NOW), "3 天前", "3 天前");
});

test("describeGenerationFilter 文案", () => {
	assertEqual(
		describeGenerationFilter({ mode: "off", days: 1, includeNever: true }),
		"不限",
		"off",
	);
	assertEqual(
		describeGenerationFilter({ mode: "stale", days: 1, includeNever: true }),
		"≥1 天未生成（含从未生成）",
		"stale",
	);
	assertEqual(
		describeGenerationFilter({ mode: "stale", days: 0.5, includeNever: false }),
		"≥0.5 天未生成",
		"stale 半天",
	);
	assertEqual(
		describeGenerationFilter({ mode: "fresh", days: 3, includeNever: true }),
		"3 天内生成过",
		"fresh",
	);
	assertEqual(
		describeGenerationFilter({ mode: "never", days: 1, includeNever: true }),
		"从未生成",
		"never",
	);
});

test("normalizeGenerationFilter 兜底坏数据", () => {
	assertEqual(
		normalizeGenerationFilter(undefined),
		{ mode: "off", days: 1, includeNever: true },
		"undefined",
	);
	assertEqual(
		normalizeGenerationFilter({ mode: "nope", days: -1, includeNever: "yes" }),
		{ mode: "off", days: 1, includeNever: true },
		"非法字段",
	);
	assertEqual(
		normalizeGenerationFilter({ mode: "stale", days: 0.5, includeNever: false }),
		{ mode: "stale", days: 0.5, includeNever: false },
		"合法值",
	);
	assertEqual(
		normalizeGenerationFilter({ mode: "fresh", days: Number.NaN }),
		{ mode: "fresh", days: 1, includeNever: true },
		"NaN 天数",
	);
});

test("customerGenerationInput 解析客户属性双链", () => {
	const record: CustomerRecord = {
		path: "客户/Acme.md",
		name: "Acme",
		fm: { AI开发信息: "[[输出/Acme - AI开发信息|别名]]" },
		tags: [],
		mtime: 0,
	};
	assertEqual(
		customerGenerationInput(record, "AI开发信息"),
		{
			path: "客户/Acme.md",
			name: "Acme",
			linkedAIPaths: ["输出/Acme - AI开发信息"],
		},
		"去掉别名",
	);
	assertEqual(
		customerGenerationInput(
			{ ...record, fm: { AI开发信息: "" } },
			"AI开发信息",
		).linkedAIPaths,
		[],
		"空属性",
	);
});
