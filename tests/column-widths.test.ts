import { readFileSync } from "node:fs";
import {
	clampColumnWidth,
	MAX_COLUMN_WIDTH,
	mergeColumnWidths,
	MIN_COLUMN_WIDTH,
	normalizeTableColumnWidths,
	normalizeWidthMap,
	resizeColumnWidth,
	sumColumnWidths,
} from "../src/core/column-widths";
import { assert, assertEqual, suite, test } from "./harness";

suite("表格列宽");

test("宽度夹在可操作区间内", () => {
	assertEqual(clampColumnWidth(10), MIN_COLUMN_WIDTH, "过窄按最小宽度");
	assertEqual(clampColumnWidth(5000), MAX_COLUMN_WIDTH, "过宽按最大宽度");
	assertEqual(clampColumnWidth(183.6), 184, "像素取整");
	assertEqual(clampColumnWidth(Number.NaN), MIN_COLUMN_WIDTH, "非法宽度回退最小");
	assertEqual(clampColumnWidth(Number.POSITIVE_INFINITY), MAX_COLUMN_WIDTH, "无限宽回退最大");
});

test("拖动位移直接加在起始宽度上", () => {
	assertEqual(resizeColumnWidth(200, 40), 240, "向右拖变宽");
	assertEqual(resizeColumnWidth(200, -60), 140, "向左拖变窄");
	assertEqual(resizeColumnWidth(200, -1000), MIN_COLUMN_WIDTH, "拖过头也留最小宽度");
	assertEqual(resizeColumnWidth(200, Number.NaN), 200, "非法位移保持原宽");
});

test("归一化丢弃手改坏的条目", () => {
	assertEqual(
		normalizeWidthMap({
			name: 240,
			开发状态: "160",
			负数: -10,
			零: 0,
			NaN项: Number.NaN,
			空: "",
			对象: {},
		}),
		{ name: 240, 开发状态: 160 },
		"只保留可用的正数宽度",
	);
	assertEqual(normalizeWidthMap(null), {}, "null 归一化为空表");
	assertEqual(normalizeWidthMap([100]), {}, "数组不是宽度表");
	assertEqual(
		normalizeTableColumnWidths({ customers: { name: 240 } }),
		{ customers: { name: 240 }, emails: {} },
		"缺少 emails 时补空表",
	);
	assertEqual(
		normalizeTableColumnWidths({ customers: { name: 1 }, emails: { summary: 300 } }).emails,
		{ summary: 300 },
		"emails 保留原宽度",
	);
});

test("默认宽度被已保存宽度覆盖，未知键保留", () => {
	assertEqual(
		mergeColumnWidths(
			[
				{ id: "name", width: 220 },
				{ id: "开发状态", width: 180 },
			],
			{ name: 300, 已隐藏列: 130 },
		),
		{ name: 300, 开发状态: 180, 已隐藏列: 130 },
		"用户拖过的宽度优先，隐藏列宽度留着",
	);
	assertEqual(
		mergeColumnWidths([{ id: "name", width: 220 }], { name: Number.NaN }),
		{ name: 220 },
		"损坏的已保存宽度不影响默认值",
	);
	assertEqual(
		mergeColumnWidths([{ id: "name", width: 220 }], null),
		{ name: 220 },
		"没有保存记录时用默认值",
	);
});

test("表格宽度等于可见列宽度之和", () => {
	assertEqual(
		sumColumnWidths(["select", "name", "status"], { select: 34, name: 240, status: 180 }),
		454,
		"三列相加",
	);
	assertEqual(sumColumnWidths(["name", "missing"], { name: 240 }), 240, "缺列按 0 计");
});

test("表格不拉伸填满面板，否则拖动一列会连累其它列", () => {
	// 去掉注释再匹配：注释里可能提到被禁用的写法。
	const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	const rule = css.match(/\.eo-table\s*\{[^}]*\}/);
	assert(rule, "styles.css 里应有 .eo-table 规则");
	const body = rule![0];
	assert(
		/table-layout:\s*fixed/.test(body),
		"表格必须用固定布局，列宽才能由 <colgroup> 决定",
	);
	assert(
		!/min-width:\s*100%/.test(body),
		"不要用 min-width: 100% 撑满面板：剩余宽度会被均摊给各列，拖动一列时其它列跟着变",
	);
});
