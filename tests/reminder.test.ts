import {
	appendEmailToContent,
	createEmailRecord,
	parseCustomerAIFile,
	removeEmailsFromContent,
	renderCustomerAIFile,
	updateEmailInContent,
} from "../src/core/ai-file";
import {
	buildEmailReminder,
	removeEmailReminderFromContent,
	upsertEmailReminderInContent,
	type EmailReminderInput,
} from "../src/core/reminder";
import { suite, test, assert, assertEqual } from "./harness";

const AI_PATH = "4. AI Output/客户/Airgas Store - AI开发信息.md";

function input(overrides: Partial<EmailReminderInput> = {}): EmailReminderInput {
	return {
		customerName: "Airgas Store",
		emailId: "001",
		aiFilePath: AI_PATH,
		contact: "Ron Downing(采购)",
		email: "ron.downing@airgas.com",
		subject: "A qualified second source",
		summaryZh: "向 Ron 推荐绝缘手套第二供应源。",
		suggestedTime: "2026-11-17 09:30",
		timezone: "America/New_York",
		channels: [
			{ tag: "#Contact/WA", content: "+19185514828" },
			{ tag: "#Contact/LinkedIn", content: "https://linkedin.com/in/ron" },
		],
		...overrides,
	};
}

function emailContent(): string {
	const record = createEmailRecord({
		contactRaw: "Ron Downing(采购)",
		email: "ron.downing@airgas.com",
		language: "en",
		languageLabel: "英语",
		summaryZh: "向 Ron 推荐绝缘手套第二供应源。",
		subject: "A qualified second source",
		body: "Hi Ron,\n\nWe make insulating gloves.\n\nBest,\nZoe",
		suggestedTime: "2026-11-17 09:30",
		timezone: "America/New_York",
		timeReason: "客户当地时间工作日 09:30",
	});
	return appendEmailToContent(null, "Airgas Store", record);
}

suite("email reminder");

test("按北京时间生成 Reminder 任务并带上联系渠道", () => {
	const reminder = buildEmailReminder(input());
	assert(reminder !== null, "应生成提醒");
	assertEqual(reminder!.time, "2026-11-17 22:30", "纽约 09:30 → 北京 22:30");
	assert(
		reminder!.block.includes("(@2026-11-17 22:30)"),
		"Reminder 格式的时间戳",
	);
	assert(reminder!.block.includes("Airgas Store"), "包含客户名");
	assert(reminder!.block.includes("Ron Downing(采购)"), "包含联系人");
	assert(reminder!.block.includes("A qualified second source"), "包含 Subject");
	assert(
		reminder!.block.includes("[[4. AI Output/客户/Airgas Store - AI开发信息]]"),
		"链接回 AI 文件",
	);
	assert(reminder!.block.includes("邮件 001"), "包含邮件 ID");
	assert(reminder!.block.includes("#Contact/WA：+19185514828"), "WA 渠道");
	assert(
		reminder!.block.includes("#Contact/LinkedIn：https://linkedin.com/in/ron"),
		"LinkedIn 渠道",
	);
	assert(
		reminder!.block.includes("客户当地时间：2026-11-17 09:30 · America/New_York"),
		"保留客户当地时间说明",
	);
	assert(reminder!.block.includes("<!-- eo-reminder: 001 -->"), "隐藏标记");
});

test("没有建议发送时间时不生成提醒", () => {
	assertEqual(buildEmailReminder(input({ suggestedTime: null })), null, "没有时间");
	assertEqual(
		buildEmailReminder(input({ suggestedTime: "不是时间" })),
		null,
		"非法时间",
	);
});

test("upsert 到 AI 文件末尾并保持邮件内容可解析", () => {
	const reminder = buildEmailReminder(input())!;
	const content = emailContent();
	const withReminder = upsertEmailReminderInContent(content, reminder);

	assert(withReminder.includes("## 发送提醒"), "创建提醒区段");
	assert(withReminder.includes("发送开发邮件给 Ron Downing(采购)"), "任务标题");
	const parsed = parseCustomerAIFile(withReminder);
	assertEqual(parsed.file.emails.length, 1, "邮件块仍在");
	assertEqual(
		parsed.file.emails[0]!.subject,
		"A qualified second source",
		"邮件内容不变",
	);
	assert(parsed.file.trailing.includes("## 发送提醒"), "提醒属于 trailing");
	const rerendered = renderCustomerAIFile(parsed.file);
	assert(rerendered.includes("## 发送提醒"), "重新渲染保留提醒");
});

test("同一封邮件重复验收时替换而不是追加", () => {
	const first = buildEmailReminder(input())!;
	const second = buildEmailReminder(
		input({
			subject: "Updated subject",
			suggestedTime: "2026-11-18 09:30",
		}),
	)!;
	let content = upsertEmailReminderInContent(emailContent(), first);
	content = upsertEmailReminderInContent(content, second);

	assertEqual(
		content.match(/^- \[ \] /gm)?.length ?? 0,
		1,
		"只保留一条任务",
	);
	assert(content.includes("Updated subject"), "使用新的 Subject");
	assert(content.includes("(@2026-11-18 22:30)"), "使用新的北京时间");
	assert(!content.includes("(@2026-11-17 22:30)"), "旧时间已替换");
});

test("不同邮件生成多条任务", () => {
	const first = buildEmailReminder(input())!;
	const second = buildEmailReminder(input({ emailId: "002" }))!;
	let content = emailContent();
	content = upsertEmailReminderInContent(content, first);
	content = upsertEmailReminderInContent(content, second);
	assertEqual(
		content.match(/^- \[ \] /gm)?.length ?? 0,
		2,
		"两条任务",
	);
	assert(content.includes("<!-- eo-reminder: 001 -->"), "保留 001");
	assert(content.includes("<!-- eo-reminder: 002 -->"), "追加 002");
});

test("删除提醒时只删对应任务并保留用户 trailing", () => {
	const first = buildEmailReminder(input())!;
	const second = buildEmailReminder(input({ emailId: "002" }))!;
	let content = emailContent() + "\n## 我的备注\n\n- 下周再跟进\n";
	content = upsertEmailReminderInContent(content, first);
	content = upsertEmailReminderInContent(content, second);

	const afterRemove = removeEmailReminderFromContent(content, "001");
	assert(!afterRemove.includes("<!-- eo-reminder: 001 -->"), "001 已删除");
	assert(afterRemove.includes("<!-- eo-reminder: 002 -->"), "002 保留");
	assert(afterRemove.includes("下周再跟进"), "用户内容保留");

	const empty = removeEmailReminderFromContent(
		upsertEmailReminderInContent(emailContent(), first),
		"001",
	);
	assert(!empty.includes("## 发送提醒"), "删空后移除区段标题");
	assert(empty.includes("A qualified second source"), "邮件内容仍在");
});

test("保存邮件更新时保留提醒区段", () => {
	const reminder = buildEmailReminder(input())!;
	const withReminder = upsertEmailReminderInContent(emailContent(), reminder);
	const parsed = parseCustomerAIFile(withReminder);
	const saved = updateEmailInContent(withReminder, {
		...parsed.file.emails[0]!,
		subject: "Saved subject",
	});
	assert(saved.includes("## 发送提醒"), "提醒仍在");
	const again = parseCustomerAIFile(saved);
	assertEqual(again.file.emails[0]!.subject, "Saved subject", "邮件已更新");
	assert(again.file.trailing.includes("eo-reminder: 001"), "标记仍在 trailing");
});

test("没有对应标记时删除是空操作", () => {
	const content = emailContent();
	assertEqual(
		removeEmailReminderFromContent(content, "999"),
		content,
		"原样返回",
	);
});

test("用户 trailing 位于提醒区段之前时不会被重排丢内容", () => {
	const reminder = buildEmailReminder(input())!;
	const content = emailContent() + "\n## 我的备注\n\n- 下周再跟进\n";
	const withReminder = upsertEmailReminderInContent(content, reminder);
	assert(withReminder.includes("下周再跟进"), "用户备注保留");
	assert(
		withReminder.indexOf("## 我的备注") <
			withReminder.indexOf("## 发送提醒"),
		"用户内容在前，提醒在后",
	);
});

test("删除邮件后清理同一 ID 的发送提醒", () => {
	let content = emailContent();
	content = upsertEmailReminderInContent(content, buildEmailReminder(input())!);
	assert(content.includes("eo-reminder: 001"), "提醒已写入");

	const removed = removeEmailsFromContent(content, ["001"]);
	assertEqual(removed.removed, ["001"], "邮件已删除");
	assertEqual(parseCustomerAIFile(removed.content).file.emails.length, 0, "没有邮件块");

	const cleaned = removeEmailReminderFromContent(removed.content, "001");
	assert(!cleaned.includes("eo-reminder: 001"), "提醒标记删除");
	assert(!cleaned.includes("## 发送提醒"), "删空后移除提醒区段标题");
	assert(
		cleaned.includes('customer: "[[Airgas Store]]"'),
		"AI 文件与客户双链保留",
	);
	assertEqual(
		parseCustomerAIFile(cleaned).file.emails.length,
		0,
		"清理提醒后仍可解析",
	);
});
