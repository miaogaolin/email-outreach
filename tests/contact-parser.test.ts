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
