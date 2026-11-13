import { currentEmailVersion, parseCustomerAIFile } from "../src/core/ai-file";
import {
	buildEmailRevisionPrompt,
	buildEmailUserPrompt,
} from "../src/core/prompt";
import { assert, assertEqual, suite, test } from "./harness";

const BASE_PROMPT = "## 本次任务\n- 为这个客户生成 1 封开发邮件";

function aiFileContent(): string {
	const body = [
		"Dear Daniel,",
		"",
		"I'm writing from PPEMAX.",
		"",
		"Best regards,",
		"PPEMAX Sales Team",
	].join("\n");
	return [
		"---",
		"type: AI开发信息",
		'customer: "[[Airgas Store]]"',
		"updated: 2026-11-10T20:19:28+08:00",
		"email_count: 1",
		"last_status: Revision",
		"---",
		"",
		"# Airgas Store · AI 开发信息",
		"",
		"## AI 分析",
		"",
		"- （尚未确认分析）",
		"",
		"## 邮件",
		"",
		"### 邮件 001 · Daniel Mueller 采购 · Revision",
		"",
		"- contact: Daniel Mueller 采购",
		"- email: daniel.mueller@airgas.com",
		"- language: en",
		"- language_label: 英语",
		"- email_summary_zh: 向 Daniel 推荐绝缘手套第二供应源。",
		"- suggested_send_time: ",
		"- timezone: ",
		"- time_reason: ",
		"- status: Revision",
		"- generated_at: 2026-11-10T18:42:53+08:00",
		"- updated_at: 2026-11-10T20:19:28+08:00",
		"- sent: false",
		"- sent_at: ",
		"- versions: 2",
		"",
		"#### Subject",
		"",
		"A qualified second source (v2)",
		"",
		"#### Body",
		"",
		body,
		"",
		"#### 修改历史",
		"",
		"##### v1 · 2026-11-10 18:42 · Generated",
		"- 用户意见: （无）",
		"- Subject:",
		"````",
		"Insulating gloves supply (v1)",
		"````",
		"- Body:",
		"````",
		"Old body from v1.",
		"````",
		"",
		"##### v2 · 2026-11-10 19:50 · Revised",
		"- 用户意见: 重新生成",
		"- Subject:",
		"````",
		"A qualified second source (v2)",
		"````",
		"- Body:",
		"````",
		body,
		"````",
		"",
	].join("\n");
}

suite("email regenerate prompt");

test("提示词只使用输出目录里已落盘的版本", () => {
	const parsed = parseCustomerAIFile(aiFileContent());
	const record = parsed.file.emails[0]!;
	assertEqual(currentEmailVersion(record), 2, "当前版本号取最后一版");

	// 弹窗里没保存的编辑：绝对不能进入提示词。
	const unsavedSubject = "UNSAVED SUBJECT";
	const unsavedBody = "UNSAVED BODY —— 还没有点保存修改";
	const prompt = buildEmailRevisionPrompt({
		basePrompt: BASE_PROMPT,
		original: {
			subject: record.subject,
			body: record.body,
			version: currentEmailVersion(record),
		},
		comment: "语气再客气一点",
	});

	assert(prompt.includes(BASE_PROMPT), "保留原有基础提示词");
	assert(prompt.includes(record.subject), "包含已落盘的 Subject");
	assert(prompt.includes(record.body), "包含已落盘的 Body");
	assert(prompt.includes("已经保存的 v2"), "说明依据的是第 2 版");
	assert(prompt.includes("语气再客气一点"), "包含用户修改意见");
	assert(!prompt.includes(unsavedSubject), "不得包含未保存的 Subject");
	assert(!prompt.includes(unsavedBody), "不得包含未保存的 Body");
	assert(!prompt.includes("Old body from v1."), "不得夹带更早的版本正文");
});

test("没有修改意见时给出默认指令", () => {
	const prompt = buildEmailRevisionPrompt({
		basePrompt: BASE_PROMPT,
		original: { subject: "s", body: "b" },
		comment: "   ",
	});
	assert(prompt.includes("没有具体意见"), "空意见走默认文案");
	assert(prompt.includes("当前版本"), "没有版本号时不写 vN");
	assert(prompt.includes("contact_id 使用联系人列表中的 id"), "保留 contact_id 约束");
});

test("重新生成时提示词聚焦原联系人", () => {
	const prompt = buildEmailUserPrompt({
		knowledge: {
			mainPath: "instructions.md",
			mainContent: "业务知识",
			articles: [],
			missingLinks: [],
			truncated: false,
			totalChars: 4,
		},
		feedbackRules: "",
		customer: {
			name: "Airgas Store",
			path: "Airgas Store.md",
			frontmatterText: "",
			contactSection: "",
			bodyExcerpt: "",
			bodyTruncated: false,
		},
		contacts: [
			{
				id: "C1",
				raw: "Daniel Mueller 采购",
				name: "Daniel Mueller",
				role: "采购",
				emails: ["daniel@airgas.com"],
				phones: [],
				links: [],
				notes: [],
				line: 1,
			},
		],
		analysis: null,
		language: null,
		maxEmails: 5,
		focusContactId: "C1",
	});
	assert(prompt.includes("只针对联系人 C1"), "明确聚焦联系人");
	assert(prompt.includes("只针对联系人 C1 生成 1 封"), "只生成一封");
});
