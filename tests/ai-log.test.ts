import {
	AI_LOG_MAX_ENTRIES,
	aiLogKindLabel,
	aiLogStatusLabel,
	createAILogEntry,
	formatAILogDuration,
	formatAILogEntries,
	formatAILogEntry,
	formatAILogTime,
	parseAILogEntry,
	parseAILogLines,
	serializeAILogEntry,
	trimAILog,
	type AILogEntry,
} from "../src/core/ai-log";
import { assert, assertEqual, suite, test } from "./harness";

suite("ai-log");

function sampleEntry(overrides: Partial<Parameters<typeof createAILogEntry>[0]> = {}): AILogEntry {
	return createAILogEntry({
		id: "e1",
		at: "2026-11-13T14:22:31+08:00",
		durationMs: 1834,
		attempt: 1,
		maxAttempts: 4,
		kind: "email",
		label: "ACME · 生成开发邮件",
		customerName: "ACME",
		customerPath: "3. Project/客户/ACME.md",
		status: "ok",
		request: {
			url: "https://api.deepseek.com/chat/completions",
			model: "deepseek-flash",
			temperature: 0.3,
			responseFormat: "json_object",
			stream: false,
			system: "你是外贸 B2B 客户开发助手。",
			user: "## 本次任务\n为客户写邮件。\n\n## 客户资料\n<<<CUSTOMER_DATA>>>",
		},
		response: {
			status: 200,
			content: '{"emails":[]}',
			finishReason: "stop",
			usage: {
				promptTokens: 8000,
				completionTokens: 600,
				totalTokens: 8600,
			},
			rawBody: '{"choices":[{"message":{"content":"{\\"emails\\":[]}"}}]}',
		},
		...overrides,
	});
}

test("createAILogEntry：统计系统/用户提示词字数并补全默认值", () => {
	const entry = sampleEntry();
	assertEqual(entry.request.systemChars, "你是外贸 B2B 客户开发助手。".length, "系统字数");
	assertEqual(entry.request.userChars, entry.request.user.length, "用户字数");
	assertEqual(
		entry.request.totalChars,
		entry.request.system.length + entry.request.user.length,
		"总字数",
	);
	assertEqual(entry.finishedAt, entry.at, "未传 finishedAt 时等于 at");
	assertEqual(entry.response.usage?.totalTokens, 8600, "保留 token 统计");
});

test("serialize / parse 往返：多行中文提示词完整保留", () => {
	const entry = sampleEntry({
		request: {
			url: "https://example.com/chat/completions",
			model: "m",
			temperature: null,
			responseFormat: null,
			stream: false,
			system: "第一行\n第二行 「引号」 \\ 反斜杠",
			user: "客户正文：\n- 项目 A\n- 项目 B\n\t缩进",
		},
		response: {
			status: 500,
			content: null,
			error: "AI 接口返回 500",
			rawBody: "internal error",
		},
	});
	const parsed = parseAILogEntry(JSON.parse(serializeAILogEntry(entry)));
	assert(parsed !== null, "应能解析");
	assertEqual(parsed!.request.system, entry.request.system, "系统提示词往返");
	assertEqual(parsed!.request.user, entry.request.user, "用户提示词往返");
	assertEqual(parsed!.response.error, entry.response.error, "错误信息往返");
	assertEqual(parsed!.durationMs, entry.durationMs, "耗时往返");
});

test("parseAILogLines：跳过空行、坏 JSON 和结构不对的行", () => {
	const text = [
		"",
		"not json",
		serializeAILogEntry(sampleEntry({ id: "a" })),
		'{"id":"b"}',
		"[]",
		serializeAILogEntry(sampleEntry({ id: "c" })),
		"",
	].join("\n");
	const entries = parseAILogLines(text);
	assertEqual(entries.map((entry) => entry.id), ["a", "c"], "只保留有效条目并保持顺序");
});

test("parseAILogEntry：容忍缺失的 response 和未知 kind/status", () => {
	const parsed = parseAILogEntry({
		id: "x",
		at: "2026-11-13T14:22:31+08:00",
		kind: "未来的新类型",
		status: "something",
		request: { system: "s", user: "u" },
	});
	assert(parsed !== null, "应能解析最小条目");
	assertEqual(parsed!.kind, "email", "未知 kind 回退为 email");
	assertEqual(parsed!.status, "error", "未知 status 回退为 error");
	assertEqual(parsed!.request.method, "POST", "默认 POST");
	assertEqual(parsed!.response.status, null, "无响应状态");
	assertEqual(parsed!.request.systemChars, 1, "重新计算字数");
});

test("trimAILog：只保留最近 N 条", () => {
	const entries = Array.from({ length: AI_LOG_MAX_ENTRIES + 5 }, (_, index) =>
		sampleEntry({ id: `id-${index}` }),
	);
	const trimmed = trimAILog(entries);
	assertEqual(trimmed.length, AI_LOG_MAX_ENTRIES, "裁剪到上限");
	assertEqual(trimmed[0]!.id, "id-5", "丢掉最旧的");
	assertEqual(trimmed[trimmed.length - 1]!.id, `id-${AI_LOG_MAX_ENTRIES + 4}`, "保留最新的");
	assertEqual(trimAILog(entries, 1).length, 1, "支持自定义上限");
	assertEqual(trimAILog([]).length, 0, "空数组");
});

test("formatAILogEntry：包含完整提示词、参数、返回和错误", () => {
	const entry = sampleEntry();
	const text = formatAILogEntry(entry);
	assert(text.includes("ACME · 生成开发邮件"), "包含标题");
	assert(text.includes("deepseek-flash"), "包含模型");
	assert(text.includes("temperature=0.3"), "包含温度");
	assert(text.includes("https://api.deepseek.com/chat/completions"), "包含接口");
	assert(text.includes(entry.request.system), "包含完整系统提示词");
	assert(text.includes(entry.request.user), "包含完整用户提示词");
	assert(text.includes(entry.response.content!), "包含 AI 返回内容");
	assert(text.includes("finish_reason：stop"), "包含结束原因");
	assert(text.includes("tokens：prompt 8000"), "包含 token 统计");

	const failed = sampleEntry({
		status: "error",
		response: { status: 401, error: "AI 接口返回 401：无效 Key", content: null },
	});
	const failedText = formatAILogEntry(failed);
	assert(failedText.includes("失败"), "错误状态");
	assert(failedText.includes("AI 接口返回 401：无效 Key"), "错误详情");
});

test("formatAILogEntry：提示词很长时也不截断", () => {
	const longPrompt = "客户资料".repeat(20000);
	const entry = sampleEntry({
		request: {
			url: "https://example.com/chat/completions",
			model: "m",
			system: longPrompt,
			user: longPrompt,
		},
	});
	assert(formatAILogEntry(entry).includes(longPrompt), "长提示词应完整出现在日志文本里");
});

test("formatAILogEntries：最新在前并带表头", () => {
	const newest = sampleEntry({ id: "new", label: "新记录" });
	const oldest = sampleEntry({ id: "old", label: "旧记录" });
	const text = formatAILogEntries([newest, oldest]);
	assert(text.startsWith("Email Outreach · AI 请求日志（共 2 条，最新在前）"), "表头");
	assert(text.indexOf("新记录") < text.indexOf("旧记录"), "顺序按入参（最新在前）");
	assertEqual(formatAILogEntries([]), "（没有 AI 请求日志）", "空日志");
});

test("文案与时间/耗时格式化", () => {
	assertEqual(aiLogKindLabel("email"), "生成开发邮件", "email");
	assertEqual(aiLogKindLabel("email-repair"), "校验失败后自动修复", "repair");
	assertEqual(aiLogStatusLabel("ok"), "成功", "ok");
	assertEqual(formatAILogTime("2026-11-13T14:22:31+08:00"), "2026-11-13 14:22:31", "本地时间");
	assertEqual(formatAILogTime("2026-11-13T06:22:31Z"), "2026-11-13 06:22:31", "UTC");
	assertEqual(formatAILogTime("whatever"), "whatever", "无法识别时原样返回");
	assertEqual(formatAILogDuration(320), "320 ms", "毫秒");
	assertEqual(formatAILogDuration(1834), "1.8 秒", "秒");
});
