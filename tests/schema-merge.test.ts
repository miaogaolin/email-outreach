import { parseJsonLoose, validateAIResult } from "../src/core/schema";
import { buildCandidates, selectedPatch } from "../src/core/merge";
import { suite, test, assert, assertEqual } from "./harness";

const ctx = {
	contactIds: new Set(["C1", "C2"]),
	contactEmails: new Map([
		["C1", ["a@example.com"]],
		["C2", ["b@example.com"]],
	]),
	maxBodyChars: 8000,
};

function validPayload() {
	return {
		customer_name: "Gallaway",
		customer_type: "Distributor",
		opportunity_fit: 8,
		opportunity_intent: 5,
		opportunity_potential: 9,
		risk: 3,
		risk_notes: ["已有稳定供应商"],
		unknown_fields: ["opportunity_intent"],
		analysis_notes: "说明",
		contact_priority: [{ contact_id: "C2", rank: 1, reason: "采购" }],
		recommended_contact_id: "C2",
		language_suggestion: { code: "en", label: "英语", reason: "美国", confidence: "high" },
		emails: [
			{
				contact_id: "C2",
				language: "en",
				email_summary_zh: "从现有绝缘手套业务切入，介绍 Class 00–4 绝缘手套合作机会。",
				subject: "Insulating gloves for your safety business",
				body: "Hi,\n\nBody.",
				suggested_send_time_local: "2026-11-11 10:00",
				timezone: "America/New_York",
				time_reason: "上午",
			},
		],
	};
}

suite("schema validation");
test("accepts a well-formed payload", () => {
	const result = validateAIResult(validPayload(), ctx, "email");
	assert(result.ok, `应通过：${JSON.stringify(result.errors)}`);
	assertEqual(result.email?.contactId, "C2", "收件人");
	assertEqual(result.analysis?.fit, 8, "fit");
	assertEqual(result.analysis?.intent, null, "unknown_fields 中的字段置空");
});

test("rejects unknown contact ids and mismatched emails", () => {
	const payload = validPayload();
	payload.emails[0]!.contact_id = "C9";
	const result = validateAIResult(payload, ctx, "email");
	assert(!result.ok, "未知联系人应失败");
	assert(result.errors.some((error) => error.field.includes("contact_id")), "错误字段");

	const payload2 = validPayload();
	(payload2.emails[0] as Record<string, unknown>).email = "evil@other.com";
	const result2 = validateAIResult(payload2, ctx, "email");
	assert(!result2.ok, "邮箱与本地资料不一致应失败");
});

test("rejects out-of-range scores and empty subject", () => {
	const payload = validPayload();
	payload.opportunity_fit = 42;
	const result = validateAIResult(payload, ctx, "analysis");
	assert(!result.ok, "超范围评分应失败");

	const payload2 = validPayload();
	payload2.emails[0]!.subject = "";
	const result2 = validateAIResult(payload2, ctx, "email");
	assert(!result2.ok, "空 subject 应失败");
});

test("warns but accepts summary outside 30-60 chars", () => {
	const payload = validPayload();
	payload.emails[0]!.email_summary_zh = "介绍绝缘手套。";
	const result = validateAIResult(payload, ctx, "email");
	assert(result.ok, "只告警");
	assert(result.warnings.some((warning) => warning.includes("30–60")), "长度告警");
});

test("parses JSON wrapped in code fences and trailing prose", () => {
	const json = parseJsonLoose('```json\n{"a":1}\n```');
	assertEqual(json, { a: 1 }, "代码围栏");
	const prose = parseJsonLoose('好的，结果如下：\n{"a":2}\n希望有帮助');
	assertEqual(prose, { a: 2 }, "前后散文");
	assertEqual(parseJsonLoose("not json"), null, "非 JSON");
});

suite("field merge");
test("empty fields are selected, conflicts are not", () => {
	const analysis = {
		customerType: "Distributor",
		fit: 8,
		intent: 5,
		potential: 9,
		risk: 3,
		riskNotes: [],
		unknownFields: [],
		analysisNotes: "",
		contactPriority: [],
		recommendedContactId: null,
		languageSuggestion: null,
	};
	const candidates = buildCandidates(
		{ 客户类型: "", fit: 4, indent: 2 },
		analysis,
		{
			customerType: true,
			opportunity: true,
			risk: false,
			contactRecommendation: false,
			email: false,
			sendTime: false,
		},
	);
	const type = candidates.find((item) => item.key === "客户类型")!;
	assert(type.selected, "空字段默认勾选");
	const fit = candidates.find((item) => item.key === "fit")!;
	assertEqual(fit.conflict, true, "不同值标记冲突");
	assertEqual(fit.selected, false, "冲突默认不勾");
	assertEqual(candidates.some((item) => item.key === "risk"), false, "未勾任务不产生字段");
	const patch = selectedPatch(candidates);
	assertEqual(patch["客户类型"], "Distributor", "patch 内容");
});

test("same numeric value is not a conflict", () => {
	const analysis = {
		customerType: null,
		fit: 8,
		intent: null,
		potential: null,
		risk: null,
		riskNotes: [],
		unknownFields: [],
		analysisNotes: "",
		contactPriority: [],
		recommendedContactId: null,
		languageSuggestion: null,
	};
	const candidates = buildCandidates({ fit: "8" }, analysis, {
		customerType: false,
		opportunity: true,
		risk: false,
		contactRecommendation: false,
		email: false,
		sendTime: false,
	});
	assertEqual(candidates[0]!.conflict, false, "数值字符串视同相同");
});
