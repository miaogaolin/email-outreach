import {
	appendEmailToContent,
	createEmailRecord,
	emailHeadingText,
	parseCustomerAIFile,
	removeEmailsFromContent,
	setEmailStatus,
	updateEmailInContent,
} from "../src/core/ai-file";
import {
	buildEmailReminders,
	isLegacyReminderBlock,
	listEmailReminderTasks,
	markEmailReminderSentInContent,
	removeEmailReminderFromContent,
	reminderMarker,
	reminderSentMarker,
	uncheckEmailReminderInContent,
	upsertEmailRemindersInContent,
	type EmailReminderInput,
} from "../src/core/reminder";
import { suite, test, assert, assertEqual } from "./harness";

function emailRecord() {
	return setEmailStatus(
		createEmailRecord({
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
		}),
		"Accepted",
	);
}

function input(overrides: Partial<EmailReminderInput> = {}): EmailReminderInput {
	const record = emailRecord();
	return {
		customerName: "Airgas Store",
		customerLink: "Airgas Store",
		emailId: "001",
		emailHeading: emailHeadingText(record),
		contact: "Ron Downing(采购)",
		email: "ron.downing@airgas.com",
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
	return appendEmailToContent(null, "Airgas Store", emailRecord());
}

function withReminders(content = emailContent()): string {
	return upsertEmailRemindersInContent(content, buildEmailReminders(input()));
}

suite("email reminder");

test("主任务：客户双链、无主题、同文件标题链接、无渠道子项", () => {
	const set = buildEmailReminders(input());
	assert(set.email !== null, "应生成主任务");
	const email = set.email!;
	assertEqual(email.time, "2026-11-17 22:30", "纽约 09:30 → 北京 22:30");
	assertEqual(
		email.block,
		[
			"- [ ] [[Airgas Store]] · 发送邮件给 Ron Downing(采购) (@2026-11-17 22:30)",
			"    - 邮件：[[#邮件 001 · Ron Downing(采购) · Accepted]]",
			"    - 邮箱：ron.downing@airgas.com",
			"    - 摘要：向 Ron 推荐绝缘手套第二供应源。",
			"    - 客户当地时间：2026-11-17 09:30 · America/New_York",
			"<!-- eo-reminder: 001 -->",
		].join("\n"),
		"主任务格式",
	);
	assert(!email.block.includes("发送开发邮件"), "标题已精简");
	assert(!email.block.includes("A qualified second source"), "不再带主题");
	assert(!email.block.includes("#Contact"), "主任务不带渠道标签");
	assert(email.block.includes(reminderMarker("001")), "隐藏标记");
});

test("有 #Contact 渠道时生成独立的其它渠道任务并显示可读名称", () => {
	const set = buildEmailReminders(input());
	assert(set.contact !== null, "应生成渠道任务");
	assertEqual(
		set.contact!.block,
		[
			"- [ ] [[Airgas Store]] · 其它渠道联系 Ron Downing(采购) (@2026-11-17 22:30)",
			"    - 邮件：[[#邮件 001 · Ron Downing(采购) · Accepted]]",
			"    - WhatsApp：+19185514828",
			"    - LinkedIn：https://linkedin.com/in/ron",
			"<!-- eo-reminder-contact: 001 -->",
		].join("\n"),
		"渠道任务格式",
	);
	assert(!set.contact!.block.includes("#Contact/"), "不显示原始标签");
});

test("没有渠道时不生成渠道任务", () => {
	const set = buildEmailReminders(input({ channels: [] }));
	assert(set.email !== null, "主任务仍在");
	assertEqual(set.contact, null, "没有渠道任务");
});

test("没有有效发送时间时不生成提醒", () => {
	assertEqual(
		buildEmailReminders(input({ suggestedTime: null })).email,
		null,
		"没有时间",
	);
	assertEqual(
		buildEmailReminders(input({ suggestedTime: "不是时间" })).email,
		null,
		"非法时间",
	);
	assertEqual(
		buildEmailReminders(input({ suggestedTime: null })).contact,
		null,
		"没有渠道任务",
	);
});

test("同文件标题锚点与真实邮件标题一致", () => {
	const record = emailRecord();
	const content = appendEmailToContent(null, "Airgas Store", record);
	assert(
		content.includes(`### ${emailHeadingText(record)}`),
		"标题与 emailHeadingText 一致",
	);
});

test("upsert 到 AI 文件末尾并保持邮件内容可解析", () => {
	const content = withReminders();
	assert(content.includes("## 发送提醒"), "创建提醒区段");
	assert(content.includes("发送邮件给 Ron Downing(采购)"), "任务标题");
	assert(content.includes("[[#邮件 001 · Ron Downing(采购) · Accepted]]"), "同文件标题链接");

	const parsed = parseCustomerAIFile(content);
	assertEqual(parsed.file.emails.length, 1, "邮件块仍在");
	assertEqual(
		parsed.file.emails[0]!.subject,
		"A qualified second source",
		"邮件内容不变",
	);
	assert(parsed.file.trailing.includes("## 发送提醒"), "提醒属于 trailing");

	const tasks = listEmailReminderTasks(content);
	assertEqual(tasks.length, 2, "主任务 + 渠道任务");
	assertEqual(
		tasks.map((task) => task.kind),
		["email", "contact"],
		"任务类型",
	);
	assert(tasks.every((task) => !task.checked && !task.done), "默认未勾选未处理");
});

test("同一封邮件重复验收时整组替换而不是追加", () => {
	const first = withReminders();
	const second = upsertEmailRemindersInContent(
		first,
		buildEmailReminders(
			input({
				suggestedTime: "2026-11-18 09:30",
			}),
		),
	);
	assertEqual(
		second.match(/^- \[ \] /gm)?.length ?? 0,
		2,
		"仍然两条任务",
	);
	assert(second.includes("(@2026-11-18 22:30)"), "使用新的北京时间");
	assert(!second.includes("(@2026-11-17 22:30)"), "旧时间已替换");
	assertEqual(listEmailReminderTasks(second).length, 2, "任务数不变");
});

test("不同邮件生成两组独立任务", () => {
	const first = buildEmailReminders(input());
	const second = buildEmailReminders(input({ emailId: "002" }));
	let content = emailContent();
	content = upsertEmailRemindersInContent(content, first);
	content = upsertEmailRemindersInContent(content, second);
	assertEqual(listEmailReminderTasks(content).length, 4, "两主任务 + 两渠道任务");
	assert(content.includes("<!-- eo-reminder: 001 -->"), "保留 001");
	assert(content.includes("<!-- eo-reminder-contact: 001 -->"), "保留 001 渠道");
	assert(content.includes("<!-- eo-reminder: 002 -->"), "追加 002");
	assert(content.includes("<!-- eo-reminder-contact: 002 -->"), "追加 002 渠道");
});

test("删除提醒时同时删主任务、渠道任务和 sent 标记", () => {
	let content = emailContent() + "\n## 我的备注\n\n- 下周再跟进\n";
	content = upsertEmailRemindersInContent(content, buildEmailReminders(input()));
	content = upsertEmailRemindersInContent(
		content,
		buildEmailReminders(input({ emailId: "002" })),
	);
	content = markEmailReminderSentInContent(content, "001");
	assert(content.includes(reminderSentMarker("001")), "001 sent 标记");

	const afterRemove = removeEmailReminderFromContent(content, "001");
	assert(!afterRemove.includes("<!-- eo-reminder: 001 -->"), "001 主任务已删除");
	assert(
		!afterRemove.includes("<!-- eo-reminder-contact: 001 -->"),
		"001 渠道任务已删除",
	);
	assert(!afterRemove.includes(reminderSentMarker("001")), "001 sent 标记已删除");
	assert(afterRemove.includes("<!-- eo-reminder: 002 -->"), "002 保留");
	assert(afterRemove.includes("下周再跟进"), "用户内容保留");

	const empty = removeEmailReminderFromContent(
		removeEmailReminderFromContent(afterRemove, "002"),
		"001",
	);
	assert(!empty.includes("## 发送提醒"), "删空后移除区段标题");
	assert(empty.includes("A qualified second source"), "邮件内容仍在");
});

test("sent 标记让任务保持勾选并可被取消恢复", () => {
	let content = withReminders();
	content = markEmailReminderSentInContent(content, "001");
	assert(content.includes("- [x] [[Airgas Store]] · 发送邮件给"), "主任务勾选");
	assert(content.includes(reminderSentMarker("001")), "sent 标记");
	const emailTask = listEmailReminderTasks(content).find(
		(task) => task.kind === "email" && task.emailId === "001",
	);
	assertEqual(emailTask?.done, true, "任务标记为已处理");

	const again = markEmailReminderSentInContent(content, "001");
	assertEqual(again, content, "重复标记幂等");

	const unchecked = uncheckEmailReminderInContent(content, "001");
	assert(unchecked.includes("- [ ] [[Airgas Store]] · 发送邮件给"), "恢复未勾选");
	assert(!unchecked.includes(reminderSentMarker("001")), "sent 标记移除");
	assert(
		listEmailReminderTasks(unchecked).every((task) => !task.done),
		"不再标记为已处理",
	);
});

test("取消勾选只影响目标任务，其他提醒保留", () => {
	let content = withReminders();
	content = upsertEmailRemindersInContent(
		content,
		buildEmailReminders(input({ emailId: "002" })),
	);
	content = markEmailReminderSentInContent(content, "001");
	const unchecked = uncheckEmailReminderInContent(content, "001");
	assert(
		unchecked.includes("- [ ] [[Airgas Store]] · 发送邮件给 Ron Downing(采购)"),
		"001 恢复未勾选",
	);
	assert(unchecked.includes("<!-- eo-reminder: 002 -->"), "002 保留");
});

test("upsert 保留已确认的 sent 状态", () => {
	let content = withReminders();
	content = markEmailReminderSentInContent(content, "001");
	const again = upsertEmailRemindersInContent(
		content,
		buildEmailReminders(input()),
	);
	assert(again.includes("- [x] [[Airgas Store]] · 发送邮件给"), "仍保持勾选");
	assert(again.includes(reminderSentMarker("001")), "sent 标记保留");
});

test("保存邮件更新时保留提醒区段", () => {
	const content = withReminders();
	const parsed = parseCustomerAIFile(content);
	const saved = updateEmailInContent(content, {
		...parsed.file.emails[0]!,
		subject: "Saved subject",
	});
	assert(saved.includes("## 发送提醒"), "提醒仍在");
	const again = parseCustomerAIFile(saved);
	assertEqual(again.file.emails[0]!.subject, "Saved subject", "邮件已更新");
	assert(again.file.trailing.includes("eo-reminder: 001"), "标记仍在 trailing");
});

test("删除邮件后清理同一 ID 的发送提醒", () => {
	let content = withReminders();
	assert(content.includes("eo-reminder: 001"), "提醒已写入");

	const removed = removeEmailsFromContent(content, ["001"]);
	assertEqual(removed.removed, ["001"], "邮件已删除");
	assertEqual(
		parseCustomerAIFile(removed.content).file.emails.length,
		0,
		"没有邮件块",
	);

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

test("用户 trailing 位于提醒区段之前时不会被重排丢内容", () => {
	const content = emailContent() + "\n## 我的备注\n\n- 下周再跟进\n";
	const withReminder = upsertEmailRemindersInContent(
		content,
		buildEmailReminders(input()),
	);
	assert(withReminder.includes("下周再跟进"), "用户备注保留");
	assert(
		withReminder.indexOf("## 我的备注") <
			withReminder.indexOf("## 发送提醒"),
		"用户内容在前，提醒在后",
	);
});

test("没有对应标记时删除是空操作", () => {
	const content = emailContent();
	assertEqual(
		removeEmailReminderFromContent(content, "999"),
		content,
		"原样返回",
	);
});

test("旧格式识别", () => {
	const legacyTitle = [
		"- [ ] Airgas Store · 发送开发邮件给 Ron Downing(采购)：Subject (@2026-11-17 22:30)",
		"    - 邮件：[[4. AI Output/客户/Airgas Store - AI开发信息]] · 邮件 001",
		"    - 邮箱：ron.downing@airgas.com",
		"<!-- eo-reminder: 001 -->",
	].join("\n");
	assert(isLegacyReminderBlock(legacyTitle), "旧标题 + 文件链接");

	const legacyLink = [
		"- [ ] Airgas Store · 发送邮件给 Ron Downing(采购) (@2026-11-17 22:30)",
		"    - 邮件：[[4. AI Output/客户/Airgas Store - AI开发信息]] · 邮件 001",
		"<!-- eo-reminder: 001 -->",
	].join("\n");
	assert(isLegacyReminderBlock(legacyLink), "旧文件链接");

	const legacyChannel = [
		"- [ ] Airgas Store · 发送邮件给 Ron Downing(采购) (@2026-11-17 22:30)",
		"    - 邮件：[[#邮件 001 · Ron Downing(采购) · Accepted]]",
		"    - #Contact/WA：+19185514828",
		"<!-- eo-reminder: 001 -->",
	].join("\n");
	assert(isLegacyReminderBlock(legacyChannel), "主任务下挂渠道");

	const current = withReminders();
	const currentBlock = listEmailReminderTasks(current).find(
		(task) => task.kind === "email",
	)!.block;
	assert(!isLegacyReminderBlock(currentBlock), "新格式不误判");
	assert(
		!isLegacyReminderBlock(
			[
				"- [ ] Airgas Store · 发送邮件给 Ron (采购) (@2026-11-17 22:30)",
				"    - 邮件：邮件 001",
				"<!-- eo-reminder: 001 -->",
			].join("\n"),
		),
		"纯文本降级不误判",
	);
});
