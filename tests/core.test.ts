import {
	applyFilters,
	collectPropertyKeys,
	conditionValues,
	distinctValues,
	inferPropertyType,
	isExcluded,
	supportsMultipleValues,
} from "../src/core/filters";
import { pruneSelection, selectionSummary } from "../src/core/selection";
import { guessLanguage, languageLabel } from "../src/core/language";
import { extractWikiLinks, parseSingleWikilink, pathToLinkTarget } from "../src/core/wikilinks";
import { summaryWarnings, looksChinese } from "../src/core/summary";
import { aiFileName, aiFilePath, fileSettingCandidates, sanitizeFileName } from "../src/core/filenames";
import { nextFollowUpCount, parseFollowUpCount } from "../src/core/follow-up";
import type { CustomerRecord } from "../src/core/types";
import { suite, test, assert, assertEqual } from "./harness";

function customer(
	name: string,
	fm: Record<string, unknown>,
): CustomerRecord {
	return {
		path: `3. Project/客户/${name}.md`,
		name,
		fm,
		tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
		mtime: 0,
	};
}

const records: CustomerRecord[] = [
	customer("Gallaway Safety & Supply", {
		地区: "美国",
		客户类型: "Distributor",
		fit: 10,
		indent: 2,
		risk: 3,
		跟进次数: 2,
		最近联系时间: "2026-10-22",
		进度: ["2.初步开发"],
		tags: ["五星"],
	}),
	customer("Airgas Store", {
		地区: "美国",
		客户类型: "Distributor",
		fit: 10,
		risk: 5,
		进度: ["2.初步开发"],
		tags: ["五星"],
	}),
	customer("lablte.ru", {
		地区: "俄罗斯",
		客户类型: "电气实验室",
		fit: 7.5,
		进度: ["2.初步开发"],
		tags: ["公海"],
	}),
	customer("Paused Co", {
		地区: "德国",
		进度: ["2.初步开发"],
		tags: ["共享", "五星"],
	}),
];

suite("filters");
test("default exclusion hides 公海/共享", () => {
	const rules = { tags: ["公海", "共享"], progressPrefixes: [] };
	assert(isExcluded(records[2]!, rules), "公海应被排除");
	assert(isExcluded(records[3]!, rules), "共享应被排除");
	const { included, excluded } = applyFilters(
		records,
		{ conditions: [], showExcluded: false },
		rules,
	);
	assertEqual(included.length, 2, "保留两个");
	assertEqual(excluded.length, 2, "排除两个");
});

test("showExcluded overrides the exclusion", () => {
	const { included } = applyFilters(
		records,
		{ conditions: [], showExcluded: true },
		{ tags: ["公海", "共享"], progressPrefixes: [] },
	);
	assertEqual(included.length, 4, "显示全部");
});

test("numeric and text conditions combine with AND", () => {
	const result = applyFilters(
		records,
		{
			conditions: [
				{ key: "地区", op: "eq", value: "美国" },
				{ key: "fit", op: "gt", value: "9" },
				{ key: "risk", op: "between", value: "1", value2: "4" },
			],
			showExcluded: true,
		},
		{ tags: [], progressPrefixes: [] },
	);
	assertEqual(result.included.map((item) => item.name), ["Gallaway Safety & Supply"], "组合筛选");
});

test("multiple values on one property match with OR", () => {
	const rules = { tags: [], progressPrefixes: [] };
	const byRegion = applyFilters(
		records,
		{
			conditions: [
				{ key: "地区", op: "eq", value: "", values: ["美国", "俄罗斯"] },
			],
			showExcluded: true,
		},
		rules,
	);
	assertEqual(
		byRegion.included.map((item) => item.name),
		["Gallaway Safety & Supply", "Airgas Store", "lablte.ru"],
		"地区多选任意命中",
	);

	const byTag = applyFilters(
		records,
		{
			conditions: [
				{ key: "tags", op: "contains", value: "", values: ["公海", "五星"] },
			],
			showExcluded: true,
		},
		rules,
	);
	assertEqual(byTag.included.length, 4, "标签多选任意命中");

	const notRegion = applyFilters(
		records,
		{
			conditions: [
				{ key: "地区", op: "neq", value: "", values: ["美国", "德国"] },
			],
			showExcluded: true,
		},
		rules,
	);
	assertEqual(
		notRegion.included.map((item) => item.name),
		["lablte.ru"],
		"不等于多个值表示全部不命中",
	);
});

test("multiple-value conditions still accept legacy single values", () => {
	const legacy = applyFilters(
		records,
		{
			conditions: [{ key: "地区", op: "eq", value: "美国" }],
			showExcluded: true,
		},
		{ tags: [], progressPrefixes: [] },
	);
	assertEqual(legacy.included.length, 2, "旧数据单值行为不变");
	assertEqual(
		conditionValues({ key: "tags", op: "contains", value: " 五星 " }),
		["五星"],
		"value 兼容并去空白",
	);
	assertEqual(
		conditionValues({
			key: "tags",
			op: "contains",
			value: "",
			values: ["五星", " 公海 ", "五星"],
		}),
		["五星", "公海"],
		"values 去空白并按大小写去重",
	);
	assert(supportsMultipleValues("contains"), "包含支持多值");
	assert(!supportsMultipleValues("gt"), "数值比较不支持多值");
});

test("progress prefix exclusion", () => {
	const rules = { tags: [], progressPrefixes: ["2.初步开发"] };
	assert(isExcluded(records[0]!, rules), "前缀命中");
});

test("property keys are ordered and typed", () => {
	const keys = collectPropertyKeys(records);
	assertEqual(keys[0], "客户类型", "优先键在前");
	assertEqual(inferPropertyType(records, "fit"), "number", "数字类型");
	assertEqual(inferPropertyType(records, "最近联系时间"), "date", "日期类型");
	assertEqual(inferPropertyType(records, "tags"), "tags", "标签类型");
	assert(distinctValues(records, "地区").includes("美国"), "去重值");
});

suite("selection");
test("pruneSelection drops paths hidden by the current filter", () => {
	assertEqual(
		Array.from(pruneSelection(["a", "b", "c"], ["b", "c", "d"])),
		["b", "c"],
		"只保留可见客户",
	);
	assertEqual(
		Array.from(pruneSelection(["a"], [])),
		[],
		"没有可见客户时清空",
	);
});

test("selectionSummary 只统计当前可见行", () => {
	assertEqual(
		selectionSummary(["a", "b"], new Set(["a", "b"])),
		{ checked: true, indeterminate: false, selectedCount: 2 },
		"全部勾选",
	);
	assertEqual(
		selectionSummary(["a", "b"], new Set(["a", "hidden"])),
		{ checked: false, indeterminate: true, selectedCount: 1 },
		"部分勾选时隐藏项不参与统计",
	);
	assertEqual(
		selectionSummary(["a", "b"], new Set(["hidden"])),
		{ checked: false, indeterminate: false, selectedCount: 0 },
		"不可见项不算全选",
	);
	assertEqual(
		selectionSummary([], new Set()),
		{ checked: false, indeterminate: false, selectedCount: 0 },
		"没有可见行",
	);
});

suite("language");
test("region to language and timezone", () => {
	assertEqual(guessLanguage("俄罗斯")?.code, "ru", "俄罗斯");
	assertEqual(guessLanguage("秘鲁")?.label, "西班牙语", "秘鲁");
	assertEqual(guessLanguage("德国")?.code, "de", "德国");
	assertEqual(guessLanguage("美国")?.code, "en", "美国");
	assertEqual(guessLanguage("秘鲁 Lima")?.code, "es", "带城市后缀");
	assertEqual(guessLanguage("火星"), null, "未知地区");
	assertEqual(languageLabel("en"), "英语", "语言名");
});

suite("wikilinks");
test("extracts links, strips aliases and headings, skips attachments", () => {
	const links = extractWikiLinks(
		"[[Email Instructions]] [[产品知识#手套|手套]] ![[image.png]] [[note|别名]]",
	);
	assertEqual(
		links.map((link) => link.target),
		["Email Instructions", "产品知识", "note"],
		"链接目标",
	);
	assertEqual(parseSingleWikilink('"[[Gallaway Safety & Supply]]"'), "Gallaway Safety & Supply", "单链接");
	assertEqual(pathToLinkTarget("a/b.md"), "a/b", "去扩展名");
});

suite("summary");
test("Chinese summary checks", () => {
	assert(looksChinese("介绍绝缘手套合作机会"), "中文");
	assert(!looksChinese("Insulating gloves"), "英文");
	const warnings = summaryWarnings("介绍绝缘手套合作机会", "Insulating gloves");
	assert(warnings.some((item) => item.includes("30–60")), "长度告警");
});

suite("filenames");
test("sanitizes names and builds the AI file path", () => {
	assertEqual(sanitizeFileName('a/b:c*d?e"f<g>h|i'), "a-b-c-d-e-f-g-h-i", "非法字符替换");
	assertEqual(aiFileName("Gallaway Safety & Supply"), "Gallaway Safety & Supply - AI开发信息", "文件名");
	assertEqual(
		aiFilePath("4. AI Output/邮件开发", "Gallaway Safety & Supply"),
		"4. AI Output/邮件开发/Gallaway Safety & Supply - AI开发信息.md",
		"完整路径",
	);
});

suite("file setting paths");
test("accepts missing extension, wikilinks, quotes and Windows separators", () => {
	assertEqual(
		fileSettingCandidates("2. Permanent/AI邮件开发说明"),
		["2. Permanent/AI邮件开发说明", "2. Permanent/AI邮件开发说明.md"],
		"缺省 .md",
	);
	assertEqual(
		fileSettingCandidates('  "2. Permanent\\AI邮件开发说明.md"  '),
		["2. Permanent/AI邮件开发说明.md"],
		"Windows 分隔符与引号",
	);
	assertEqual(
		fileSettingCandidates("[[2. Permanent/AI邮件开发说明|主指令]]"),
		["2. Permanent/AI邮件开发说明", "2. Permanent/AI邮件开发说明.md"],
		"双链与别名",
	);
	assertEqual(
		fileSettingCandidates("/2. Permanent/AI邮件开发说明.md"),
		["2. Permanent/AI邮件开发说明.md"],
		"去掉开头的斜杠",
	);
	assertEqual(
		fileSettingCandidates("AI邮件开发说明.MD"),
		["AI邮件开发说明.MD"],
		"已有扩展名不重复追加",
	);
	assertEqual(
		fileSettingCandidates("AI 2.0"),
		["AI 2.0", "AI 2.0.md"],
		"文件名里的点不当作扩展名",
	);
	assertEqual(fileSettingCandidates("   "), [], "空路径");
});

suite("follow-up");
test("跟进次数解析与 +1", () => {
	assertEqual(parseFollowUpCount(2), 2, "数字");
	assertEqual(parseFollowUpCount("3"), 3, "字符串");
	assertEqual(parseFollowUpCount("  "), 0, "空值");
	assertEqual(parseFollowUpCount("abc"), 0, "非法值");
	assertEqual(parseFollowUpCount(-1), 0, "负数");
	assertEqual(nextFollowUpCount(undefined), 1, "第一次跟进");
	assertEqual(nextFollowUpCount("2"), 3, "已有次数 +1");
});
