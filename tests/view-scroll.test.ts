import { decideScrollRestore } from "../src/core/view-scroll";
import { assertEqual, suite, test } from "./harness";

suite("视图位置保持");

test("写入前不在顶部、写入后掉到顶部：还原", () => {
	assertEqual(
		decideScrollRestore(128, 0),
		"restore",
		"掉到开头应还原到原行号",
	);
	assertEqual(
		decideScrollRestore(3.5, 0.2),
		"restore",
		"半行位置也算掉到开头",
	);
});

test("位置还在原处或用户滚到别处：保持不动", () => {
	assertEqual(decideScrollRestore(128, 128), "keep", "位置没变不处理");
	assertEqual(decideScrollRestore(128, 40), "keep", "用户滚到别处不抢滚动条");
	assertEqual(decideScrollRestore(0.5, 0), "keep", "本来就在顶部无需还原");
	assertEqual(decideScrollRestore(0, 0), "keep", "顶部对顶部无需还原");
});

test("视图尚未渲染好：稍后重试", () => {
	assertEqual(decideScrollRestore(128, null), "retry", "读到 null 说明还没渲染完");
	assertEqual(
		decideScrollRestore(128, Number.NaN),
		"retry",
		"非法行号按未就绪处理",
	);
	assertEqual(
		decideScrollRestore(Number.NaN, 0),
		"keep",
		"写入前位置无效时不做任何事",
	);
	assertEqual(decideScrollRestore(undefined, 0), "keep", "缺少保存位置不做任何事");
});
