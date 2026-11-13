import { modelsEndpoint, parseModelList } from "../src/core/models";
import { assert, assertEqual, suite, test } from "./harness";

suite("models");

test("OpenAI 兼容格式：按服务端顺序返回 id", () => {
	assertEqual(
		parseModelList({
			object: "list",
			data: [
				{ id: "deepseek-flash", object: "model", owned_by: "deepseek" },
				{ id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
			],
		}),
		["deepseek-flash", "deepseek-v4-pro"],
		"应返回 data[].id",
	);
});

test("DeepSeek 格式：忽略 name / context_window 等附加字段", () => {
	assertEqual(
		parseModelList({
			data: [
				{
					id: "deepseek-flash",
					name: "DeepSeek Flash",
					context_window: 1000000,
					effort: { supported_levels: ["low", "high", "max"] },
				},
			],
		}),
		["deepseek-flash"],
		"只取 id",
	);
});

test("Ollama 格式：models[].name", () => {
	assertEqual(
		parseModelList({
			models: [{ name: "llama3:8b" }, { name: "qwen2.5:7b" }],
		}),
		["llama3:8b", "qwen2.5:7b"],
		"应兼容 models[].name",
	);
});

test("纯字符串数组：去空白、去重", () => {
	assertEqual(
		parseModelList([" gpt-4o-mini ", "gpt-4o", "gpt-4o", "", "  "]),
		["gpt-4o-mini", "gpt-4o"],
		"trim + dedupe",
	);
});

test("无法识别的返回：空列表而不是抛错", () => {
	for (const payload of [null, undefined, {}, { data: null }, { data: {} }, 42, "text"]) {
		assertEqual(parseModelList(payload), [], `payload=${JSON.stringify(payload)}`);
	}
});

test("忽略 id 不是字符串的条目", () => {
	assertEqual(
		parseModelList([{ id: 123 }, { id: "ok-model" }, { name: "" }]),
		["ok-model"],
		"只保留有效字符串 id",
	);
});

test("最多保留 500 个，避免设置页被撑爆", () => {
	const payload = Array.from({ length: 640 }, (_, index) => ({
		id: `model-${index}`,
	}));
	const models = parseModelList(payload);
	assertEqual(models.length, 500, "cap at 500");
	assertEqual(models[0], "model-0", "first kept");
	assertEqual(models[499], "model-499", "last kept");
	assert(models.includes("model-500") === false, "overflow dropped");
});

test("modelsEndpoint：base URL 补 /models", () => {
	assertEqual(
		modelsEndpoint("https://api.deepseek.com"),
		"https://api.deepseek.com/models",
		"根地址",
	);
	assertEqual(
		modelsEndpoint("  https://api.deepseek.com/v1/  "),
		"https://api.deepseek.com/v1/models",
		"去掉空白和尾部斜杠",
	);
});

test("modelsEndpoint：兼容粘贴 chat 端点或已是 /models", () => {
	assertEqual(
		modelsEndpoint("https://api.deepseek.com/chat/completions"),
		"https://api.deepseek.com/models",
		"chat 端点",
	);
	assertEqual(
		modelsEndpoint("https://api.deepseek.com/v1/chat/completions"),
		"https://api.deepseek.com/v1/models",
		"带版本前缀的 chat 端点",
	);
	assertEqual(
		modelsEndpoint("https://api.deepseek.com/models"),
		"https://api.deepseek.com/models",
		"已是 models 端点",
	);
});

test("modelsEndpoint：空地址返回 null", () => {
	assertEqual(modelsEndpoint("   "), null, "空白");
	assertEqual(modelsEndpoint(""), null, "空串");
});
