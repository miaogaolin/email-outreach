import {
	parseContacts,
	contactsWithEmail,
	extractContactSection,
	findContactByEmail,
} from "../src/core/contact-parser";
import { suite, test, assert, assertEqual } from "./harness";

const GALLOWAY = `---
地区: 美国
---
## Contact
- Mary Ann Gallaway 副总裁
	- +17242639379 #Contact/WA 
	- maryann@gallawaysafety.com
	- linkedin.com/in/mary-ann-gallaway-b09a60a7
- Kim Lucas 采购 
	- kim.lucas@gallawaysafety.com
	- 17242636507 #Contact/WA 
- info@gallawaysafety.com（公司公共邮箱）
`;

const CESSA = `## 联系人
- guillermo@cessacomercializadora.com（最高，个人负责人邮箱）
- ventas@cessacomercializadora.com（官方销售入口，可抄送）
`;

const GAMISOL = `## Contact
- Juan Pablo（Gerente De Operaciones）
	- **职位**：Gerente De Operaciones（运营总经理）
	- jp@gamisol.com
	- +506 8888 7777
`;

const LATIN = `## 联系人
- Cristian Perez 采购
	- cristian@example.cl
	- https://www.linkedin.com/in/cristian-perez/
- María López 老板
	- [maria@example.cl](mailto:maria@example.cl)
	- maria.alt@example.cl
`;

const NO_HEADING = `## 备注
- someone@example.com
`;

const CROSS = `## Contact
- Alice 采购
	- alice@a.com
- Bob 老板
	- bob@b.com
	- alice@a.com
`;

const PLAIN_NAMES = `## 联系人

Andrew Bender 老板
- https://www.linkedin.com/in/andrew-bender-4644a05/
- ab@anchortex.com
- +16174176417 #Contact/WA

Baba Claxton 采购
- +18567685240
- bclaxton@anchortex.com

无法确定这个客户的其他信息了。
- Charlene Jacobs
	- charlene@example.com
`;

suite("contact parser");
test("plain name lines followed by top-level bullets", () => {
	const result = parseContacts(PLAIN_NAMES);
	assertEqual(result.contacts.length, 3, "三段联系人");
	assertEqual(result.contacts[0]!.name, "Andrew Bender 老板", "姓名保留");
	assertEqual(result.contacts[0]!.emails, ["ab@anchortex.com"], "邮箱归属");
	assertEqual(result.contacts[0]!.phones, ["+16174176417"], "电话");
	assertEqual(result.contacts[1]!.emails, ["bclaxton@anchortex.com"], "第二人邮箱");
	// The sentence ending with 。 must not become a contact.
	assert(!result.contacts.some((contact) => contact.name.includes("无法确定")), "散文不算联系人");
	assertEqual(result.contacts[2]!.emails, ["charlene@example.com"], "第三条仍归属正确");
});

test("role-only child bullets stay inside the contact", () => {
	const result = parseContacts(
		"## 联系人\n\nChartur Castillo\n- Gerente General\t\n- chartur@example.com\n",
	);
	assertEqual(result.contacts.length, 1, "一个联系人");
	assert(
		result.contacts[0]!.notes.some((note) => note.includes("Gerente General")),
		"职位行作为备注保留",
	);
	assertEqual(result.contacts[0]!.emails, ["chartur@example.com"], "邮箱");
});

test("parses tab-indented contacts and keeps raw text", () => {
	const result = parseContacts(GALLOWAY);
	assert(result.headingFound, "应该找到 Contact 标题");
	assertEqual(result.contacts.length, 3, "应有 3 个联系人");
	const mary = result.contacts[0]!;
	assertEqual(mary.raw, "Mary Ann Gallaway 副总裁", "raw 保留");
	assertEqual(mary.name, "Mary Ann Gallaway 副总裁", "name 保留整段");
	assertEqual(mary.emails, ["maryann@gallawaysafety.com"], "邮箱");
	assertEqual(mary.phones, ["+17242639379"], "电话");
	assert(mary.links.some((link) => link.includes("linkedin.com/in/mary-ann-gallaway")), "链接");
});

test("parenthesized role on the name line", () => {
	const result = parseContacts(GAMISOL);
	const contact = result.contacts[0]!;
	assertEqual(contact.name, "Juan Pablo", "去括号后的姓名");
	assertEqual(contact.role, "Gerente De Operaciones", "括号里的职位");
	assertEqual(contact.emails, ["jp@gamisol.com"], "邮箱");
	assert(contact.phones.length === 1, "电话");
});

const ROLE_REMARKS = `## Contact
- Collin See(工程师) 合伙人
	- collin@example.com
- Don Swope（首席运营官） 合伙人
	- don@example.com
- Dave Kuehneman（销售市场总监）— 负责美国西部
	- dave@example.com
- John Smith (Buyer) intro call next week
	- john@example.com
- Daniel Mueller(采购)，老客户，德国
	- daniel@example.com
- Maria Lopez(老板) 老客户 maria@example.com
	- maria.alt@example.com
- Peter Pan(采购)。
	- peter@example.com
`;

test("parenthesized role with a trailing remark", () => {
	const result = parseContacts(ROLE_REMARKS);
	assertEqual(result.contacts.length, 7, "七段联系人");
	const collin = result.contacts[0]!;
	assertEqual(collin.name, "Collin See", "括号前的姓名");
	assertEqual(collin.role, "工程师", "括号里的身份");
	assert(collin.notes.includes("合伙人"), "括号后的备注");
	assertEqual(result.contacts[1]!.name, "Don Swope", "全角括号姓名");
	assertEqual(result.contacts[1]!.role, "首席运营官", "全角括号身份");
	assert(result.contacts[1]!.notes.includes("合伙人"), "全角括号后备注");
	assertEqual(result.contacts[2]!.role, "销售市场总监", "破折号后备注");
	assert(result.contacts[2]!.notes.includes("负责美国西部"), "破折号备注保留");
	assertEqual(result.contacts[3]!.role, "Buyer", "英文身份");
	assert(
		result.contacts[3]!.notes.some((note) => note.includes("intro call next week")),
		"英文备注",
	);
	assertEqual(result.contacts[4]!.role, "采购", "逗号分隔备注");
	assert(result.contacts[4]!.notes.includes("老客户，德国"), "逗号后备注");
	assertEqual(result.contacts[5]!.role, "老板", "姓名行带邮箱");
	assertEqual(
		result.contacts[5]!.emails,
		["maria@example.com", "maria.alt@example.com"],
		"姓名行和子项邮箱都在",
	);
	assert(result.contacts[5]!.notes.includes("老客户"), "邮箱前面的备注");
	assertEqual(result.contacts[6]!.role, "采购", "句号结尾仍识别身份");
	assertEqual(result.contacts[6]!.notes.length, 0, "只有句号不算备注");
});

test("parenthesized role tolerates spaces before the parenthesis", () => {
	const result = parseContacts(`## 联系人
- Daniel Mueller (采购) 备注
	- daniel@example.com
- Anna Schmidt\u3000（采购/供应链）负责德国
	- anna@example.com
`);
	assertEqual(result.contacts.length, 2, "两段联系人");
	assertEqual(result.contacts[0]!.name, "Daniel Mueller", "半角括号前有空格");
	assertEqual(result.contacts[0]!.role, "采购", "半角括号身份");
	assert(result.contacts[0]!.notes.includes("备注"), "半角括号后备注");
	assertEqual(result.contacts[1]!.name, "Anna Schmidt", "全角空格不算姓名");
	assertEqual(result.contacts[1]!.role, "采购/供应链", "全角空格 + 全角括号");
	assert(result.contacts[1]!.notes.includes("负责德国"), "全角括号后备注");
});

test("a middle-name parenthesis is not mistaken for a role", () => {
	const result = parseContacts(
		"## 联系人\n- Alena (Ingram) Godfrey 采购\n\t- godfreya@example.com\n",
	);
	assertEqual(result.contacts.length, 1, "一个联系人");
	assertEqual(
		result.contacts[0]!.name,
		"Alena (Ingram) Godfrey 采购",
		"中间名保留在姓名里",
	);
	assertEqual(result.contacts[0]!.role, null, "中间名不当身份");
});

test("parenthesized role on a plain name line keeps the remark", () => {
	const result = parseContacts(
		"## 联系人\n\nAndrew Bender(老板) 老客户\n- ab@anchortex.com\n",
	);
	assertEqual(result.contacts.length, 1, "一个联系人");
	assertEqual(result.contacts[0]!.name, "Andrew Bender", "姓名");
	assertEqual(result.contacts[0]!.role, "老板", "括号身份");
	assert(result.contacts[0]!.notes.includes("老客户"), "备注");
});

test("top-level items that are only emails", () => {
	const result = parseContacts(CESSA);
	assertEqual(result.contacts.length, 2, "两个邮箱联系人");
	assertEqual(result.contacts[0]!.emails, ["guillermo@cessacomercializadora.com"], "邮箱");
	assert(result.contacts[0]!.name.includes("guillermo"), "名称回退到邮箱");
});

test("mailto links and multiple emails", () => {
	const result = parseContacts(LATIN);
	assertEqual(result.contacts.length, 2, "两个联系人");
	assertEqual(result.contacts[1]!.emails, ["maria@example.cl", "maria.alt@example.cl"], "多邮箱保序");
	assert(
		result.contacts[0]!.links.some((link) => link.includes("linkedin")),
		"链接",
	);
});

test("emails never leak between contacts", () => {
	const result = parseContacts(CROSS);
	assertEqual(result.contacts[0]!.emails, ["alice@a.com"], "Alice 只有自己的邮箱");
	assertEqual(result.contacts[1]!.emails, ["bob@b.com", "alice@a.com"], "Bob 保留自己块内的两个邮箱");
});

test("contacts without email are kept but not sendable", () => {
	const result = parseContacts(GALLOWAY);
	const withEmail = contactsWithEmail(result.contacts);
	assertEqual(withEmail.length, 3, "Galloway 三个都有邮箱");
	const noEmail = parseContacts(`## Contact\n- Nobody\n\t- +12345678\n`);
	assertEqual(noEmail.contacts.length, 1, "保留无邮箱联系人");
	assertEqual(contactsWithEmail(noEmail.contacts).length, 0, "无邮箱不进发送列表");
});

test("missing heading is reported", () => {
	const result = parseContacts(NO_HEADING);
	assert(!result.headingFound, "没有标题");
	assertEqual(result.contacts.length, 0, "没有联系人");
});

test("extractContactSection returns the raw section", () => {
	const section = extractContactSection(GALLOWAY);
	assert(section.startsWith("## Contact"), "从标题开始");
	assert(section.includes("kim.lucas@gallawaysafety.com"), "包含邮箱");
	assert(!section.includes("地区"), "不包含 frontmatter");
});

test("findContactByEmail matches case-insensitively and falls back to raw", () => {
	const result = parseContacts(GALLOWAY);
	const byEmail = findContactByEmail(
		result.contacts,
		"KIM.LUCAS@GALLAWAYSAFETY.COM",
	);
	assert(byEmail?.raw.includes("Kim Lucas"), "按邮箱大小写匹配");
	const byRaw = findContactByEmail(result.contacts, "", "Kim Lucas 采购 ");
	assert(byRaw?.raw.includes("Kim Lucas"), "按联系人原文兜底");
	assertEqual(findContactByEmail(result.contacts, "nobody@x.com"), null, "找不到");
});
