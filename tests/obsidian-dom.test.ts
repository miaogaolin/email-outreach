import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, suite, test } from "./harness";

const OBSIDIAN_SRC = join("src", "obsidian");

// Obsidian 的 Element.addClass 直接调用 classList.add，而 DOMTokenList
// 不允许一个类名里带空格，所以 `addClass("a b")` 会抛 InvalidCharacterError，
// 导致 onOpen 中断、弹窗空白。这里静态扫一遍源码，防止再写回去。
const ADD_CLASS_LITERAL = /\.addClass\(\s*(["'])([^"']*)\1/g;
const ADD_CLASSES_LITERAL = /\.addClasses\(\s*\[\s*(["'])([^"']*)\1/g;

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...sourceFiles(path));
		else if (entry.name.endsWith(".ts")) files.push(path);
	}
	return files;
}

suite("obsidian DOM helpers");

test("开发状态不再同时设置原生 title 与 Obsidian tooltip", () => {
	const source = readFileSync(
		join(OBSIDIAN_SRC, "dev-status-cell.ts"),
		"utf8",
	);
	assert(
		!/\.title\s*=/.test(source),
		"不要设置原生 title，否则会和 Obsidian tooltip 同时弹出",
	);
	assert(source.includes("setTooltip("), "应使用 Obsidian 的 setTooltip");
	assert(
		!/setAttribute\(\s*["']aria-label["']/.test(source),
		"让 setTooltip 统一管理 aria-label",
	);
});

test("addClass / addClasses 的类名参数不含空格", () => {
	const offenders: string[] = [];
	for (const file of sourceFiles(OBSIDIAN_SRC)) {
		const source = readFileSync(file, "utf8");
		for (const pattern of [ADD_CLASS_LITERAL, ADD_CLASSES_LITERAL]) {
			pattern.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(source)) !== null) {
				const className = match[2] ?? "";
				if (/\s/.test(className)) {
					offenders.push(`${file}: ${match[0]}`);
				}
			}
		}
	}
	assert(
		offenders.length === 0,
		`classList.add 不接受含空格的类名，请拆成多个参数：\n${offenders.join("\n")}`,
	);
});
