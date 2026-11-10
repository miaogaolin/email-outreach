import {
	applyFilters,
	collectPropertyKeys,
	distinctValues,
	inferPropertyType,
	isExcluded,
} from "../src/core/filters";
import { guessLanguage, languageLabel } from "../src/core/language";
import { extractWikiLinks, parseSingleWikilink, pathToLinkTarget } from "../src/core/wikilinks";
import { summaryWarnings, looksChinese } from "../src/core/summary";
import { aiFileName, aiFilePath, sanitizeFileName } from "../src/core/filenames";
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
