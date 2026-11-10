import {
	addEmailVersion,
	appendEmailToContent,
	createEmailRecord,
	nextEmailId,
	parseCustomerAIFile,
	renderCustomerAIFile,
} from "../src/core/ai-file";
import { suite, test, assert, assertEqual } from "./harness";

function record(overrides: Partial<Parameters<typeof createEmailRecord>[0]> = {}) {
	return createEmailRecord({
		contactRaw: "Kim Lucas 采购",
		email: "kim.lucas@gallawaysafety.com",
		language: "en",
		languageLabel: "英语",
		summaryZh: "从现有绝缘手套业务切入，介绍 Class 00–4 合作机会。",
		subject: "Insulating gloves for your safety business",
		body: "Hi Kim,\n\nWe make rubber insulating gloves.\n\nBest regards,\nZoe",
		suggestedTime: "2026-11-11 10:00",
		timezone: "America/New_York",
		timeReason: "客户当地时间上午",
		...overrides,
	});
}

suite("AI file round-trip");
test("append + parse keeps every field", () => {
	const first = record();
	const content = appendEmailToContent(null, "Gallaway Safety & Supply", first);
	const parsed = parseCustomerAIFile(content);
	assertEqual(parsed.file.customerLink, "Gallaway Safety & Supply", "客户双链");
	assertEqual(parsed.file.emails.length, 1, "一封邮件");
	const email = parsed.file.emails[0]!;
	assertEqual(email.id, "001", "邮件 ID");
	assertEqual(email.contact, "Kim Lucas 采购", "联系人");
	assertEqual(email.email, "kim.lucas@gallawaysafety.com", "邮箱");
	assertEqual(email.language, "en", "语言");
	assertEqual(email.status, "Generated", "状态");
	assertEqual(email.summaryZh, first.summaryZh, "中文摘要");
	assertEqual(email.subject, first.subject, "Subject");
	assertEqual(email.body, first.body, "Body");
	assertEqual(email.versions.length, 1, "一个版本");
	assertEqual(email.sent, false, "未发送");
});

test("render(parse(content)) is stable", () => {
	const content = appendEmailToContent(null, "Gallaway Safety & Supply", record());
	const parsed = parseCustomerAIFile(content);
	const rendered = renderCustomerAIFile(parsed.file);
	const parsedAgain = parseCustomerAIFile(rendered);
	assertEqual(parsedAgain.file.emails[0]!.subject, parsed.file.emails[0]!.subject, "subject 稳定");
	assertEqual(parsedAgain.file.emails[0]!.body, parsed.file.emails[0]!.body, "body 稳定");
	assertEqual(parsedAgain.file.emails[0]!.versions.length, 1, "版本数稳定");
});

test("second email gets id 002 and lives in one file", () => {
	let content = appendEmailToContent(null, "Gallaway Safety & Supply", record());
	content = appendEmailToContent(content, "Gallaway Safety & Supply", record({
		contactRaw: "Colin Gallaway 老板",
		email: "colin@gallawaysafety.com",
		subject: "Second subject",
		body: "Second body",
	}));
	const parsed = parseCustomerAIFile(content);
	assertEqual(parsed.file.emails.length, 2, "同一文件两封邮件");
	assertEqual(parsed.file.emails[1]!.id, "002", "第二个 ID");
	assertEqual(nextEmailId(parsed.file.emails), "003", "下一个 ID");
});

test("version history survives a save cycle", () => {
	let content = appendEmailToContent(null, "G", record());
	let parsed = parseCustomerAIFile(content);
	const original = parsed.file.emails[0]!;
	const revised = addEmailVersion(original, {
		subject: "Revised subject",
		body: "Revised body",
		action: "Edited",
		comment: "主题太泛，改具体一点",
		status: "Revision",
	});
	content = renderCustomerAIFile({ ...parsed.file, emails: [revised] });
	parsed = parseCustomerAIFile(content);
	const email = parsed.file.emails[0]!;
	assertEqual(email.versions.length, 2, "两个版本");
	assertEqual(email.versions[0]!.body, original.body, "第一版原文保留");
	assertEqual(email.versions[1]!.userComment, "主题太泛，改具体一点", "意见保留");
	assertEqual(email.status, "Revision", "状态 Revision");
});

test("body containing code fences survives the version history", () => {
	const tricky = "Line one\n\n```js\nconst a = 1;\n```\n\nEnd";
	let content = appendEmailToContent(null, "G", record({ body: tricky }));
	const parsed = parseCustomerAIFile(content);
	const email = parsed.file.emails[0]!;
	const revised = addEmailVersion(email, {
		body: tricky + "\nmore",
		action: "Edited",
		comment: "",
		status: "Revision",
	});
	content = renderCustomerAIFile({ ...parsed.file, emails: [revised] });
	const again = parseCustomerAIFile(content).file.emails[0]!;
	assertEqual(again.body, tricky + "\nmore", "正文保留");
	assertEqual(again.versions[0]!.body, tricky, "历史正文保留");
});

test("analysis section round-trips", () => {
	const content = appendEmailToContent(null, "G", record());
	const parsed = parseCustomerAIFile(content);
	const withAnalysis = renderCustomerAIFile({
		...parsed.file,
		analysis: {
			customerType: "Distributor",
			fit: 8,
			intent: 5,
			potential: 9,
			risk: 3,
			riskNotes: ["已有稳定供应商", "价格敏感"],
			unknownFields: ["opportunity_intent"],
			notes: "测试备注",
		},
		analysisHistory: ["2026-11-10 16:30 · fit 无 → 8"],
	});
	const again = parseCustomerAIFile(withAnalysis).file;
	assertEqual(again.analysis?.customerType, "Distributor", "客户类型");
	assertEqual(again.analysis?.fit, 8, "fit");
	assertEqual(again.analysis?.riskNotes, ["已有稳定供应商", "价格敏感"], "风险说明");
	assertEqual(again.analysis?.unknownFields, ["opportunity_intent"], "未确定字段");
	assertEqual(again.analysisHistory.length, 1, "分析历史");
});

test("no customer_path key is written", () => {
	const content = appendEmailToContent(null, "G", record());
	assert(!content.includes("customer_path"), "不应出现 customer_path");
	assert(content.includes("customer: \"[[G]]\""), "只保留单值双链");
});

test("trailing user content is preserved", () => {
	let content = appendEmailToContent(null, "G", record());
	content = content + "\n## 我的备注\n\n- 下周再跟进\n";
	const parsed = parseCustomerAIFile(content);
	assert(parsed.file.trailing.includes("下周再跟进"), "尾部内容保留");
	const rendered = renderCustomerAIFile(parsed.file);
	assert(rendered.includes("下周再跟进"), "重新渲染仍保留");
});
