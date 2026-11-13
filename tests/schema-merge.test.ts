import { parseJsonLoose, validateAIResult } from "../src/core/schema";
import { MAX_EMAILS_PER_CUSTOMER } from "../src/core/types";
import { suite, test, assert, assertEqual } from "./harness";

const ctx = {
	contactIds: new Set(["C1", "C2", "C3"]),
	contactEmails: new Map([
		["C1", ["a@example.com"]],
		["C2", ["b@example.com"]],
		["C3", ["c@example.com"]],
	]),
	maxBodyChars: 8000,
};

function email(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		contact_id: "C1",
		language: "en",
		email_summary_zh: "从现有绝缘手套业务切入，介绍 Class 00–4 绝缘手套合作机会。",
		subject: "Insulating gloves for your safety business",
		body: "Hi,\n\nBody.",
		...overrides,
	};
}

function validPayload() {
	return {
		customer_name: "Gallaway",
		emails: [
			email({ contact_id: "C2" }),
			email({
				contact_id: "C1",
				subject: "Second contact subject",
				body: "Hi second,\n\nBody.",
			}),
		],
		no_suitable_contact_reason: null,
	};
}

suite("schema validation");
test("accepts multiple emails in one response", () => {
	const result = validateAIResult(validPayload(), ctx);
	assert(result.ok, `应通过：${JSON.stringify(result.errors)}`);
	assertEqual(result.emails.length, 2, "两封邮件");
	assertEqual(result.emails[0]?.contactId, "C2", "第一封收件人");
	assertEqual(result.emails[1]?.contactId, "C1", "第二封收件人");
});

test("drops an invalid email but keeps the valid ones", () => {
	const payload = validPayload();
	payload.emails.push(email({ contact_id: "C9" }));
	const result = validateAIResult(payload, ctx);
	assert(result.ok, "部分成功仍可落盘");
	assertEqual(result.emails.length, 2, "只保留有效邮件");
	assert(
		result.warnings.some((warning) => warning.includes("C9")),
		"未知联系人要有告警",
	);
});

test("all invalid emails fail validation for a repair retry", () => {
	const payload = {
		emails: [email({ contact_id: "C9" }), email({ contact_id: "C8" })],
	};
	const result = validateAIResult(payload, ctx);
	assert(!result.ok, "全部非法应失败");
	assert(result.errors.some((error) => error.field === "emails"), "结构错误");
});

test("empty emails with a reason is a valid no-suitable result", () => {
	const result = validateAIResult(
		{
			emails: [],
			no_suitable_contact_reason: "联系人都没有邮箱",
		},
		ctx,
	);
	assert(result.ok, "空数组是合法结果");
	assertEqual(result.emails.length, 0, "没有邮件");
	assertEqual(
		result.noSuitableContactReason,
		"联系人都没有邮箱",
		"保留原因",
	);
});

test("empty emails without a reason gets a default message", () => {
	const result = validateAIResult({ emails: [] }, ctx);
	assert(result.ok, "空数组仍合法");
	assert(
		result.warnings.some((warning) => warning.includes("没有说明")),
		"缺少原因要告警",
	);
	assert(Boolean(result.noSuitableContactReason), "有兜底文案");
});

test("duplicate contact or email is deduplicated", () => {
	const payload = {
		emails: [
			email({ contact_id: "C1" }),
			email({ contact_id: "C1", subject: "Duplicate" }),
		],
	};
	const result = validateAIResult(payload, ctx);
	assert(result.ok, "去重后仍通过");
	assertEqual(result.emails.length, 1, "只保留第一封");
	assert(
		result.warnings.some((warning) => warning.includes("重复")),
		"重复要告警",
	);
});

test("mismatched email address is dropped", () => {
	const payload = {
		emails: [email({ contact_id: "C1", email: "evil@other.com" })],
	};
	const result = validateAIResult(payload, ctx);
	assert(!result.ok, "全部非法应失败");
	assert(
		result.warnings.some((warning) => warning.includes("不一致")),
		"邮箱不一致要告警",
	);
});

test("caps the number of emails per customer", () => {
	const manyCtx = {
		contactIds: new Set(
			Array.from({ length: MAX_EMAILS_PER_CUSTOMER + 2 }, (_, index) => `M${index + 1}`),
		),
		contactEmails: new Map(
			Array.from({ length: MAX_EMAILS_PER_CUSTOMER + 2 }, (_, index) => [
				`M${index + 1}`,
				[`m${index + 1}@example.com`],
			]),
		),
		maxBodyChars: 8000,
	};
	const payload = {
		emails: Array.from({ length: MAX_EMAILS_PER_CUSTOMER + 2 }, (_, index) =>
			email({
				contact_id: `M${index + 1}`,
				subject: `Subject ${index}`,
			}),
		),
	};
	const result = validateAIResult(payload, manyCtx);
	assertEqual(result.emails.length, MAX_EMAILS_PER_CUSTOMER, "最多保留上限封数");
	assert(
		result.warnings.some((warning) => warning.includes("只采用前")),
		"截断要告警",
	);
});

test("parses JSON wrapped in code fences and trailing prose", () => {
	const json = parseJsonLoose('```json\n{"a":1}\n```');
	assertEqual(json, { a: 1 }, "代码围栏");
	const prose = parseJsonLoose('好的，结果如下：\n{"a":2}\n希望有帮助');
	assertEqual(prose, { a: 2 }, "前后散文");
	assertEqual(parseJsonLoose("not json"), null, "非 JSON");
});
