import {
	CONTACT_LOG_FOLLOW_UP_KEY,
	CONTACT_LOG_LAST_CONTACT_KEY,
	formatContactLogDate,
	planContactLog,
} from "../src/core/contact-log";
import { assertEqual, suite, test } from "./harness";

suite("contact log");

test("最近联系时间只到天", () => {
	assertEqual(
		formatContactLogDate(new Date(2026, 10, 18, 12, 14, 33)),
		"2026-11-18",
		"本机日期",
	);
	assertEqual(
		formatContactLogDate(new Date(2026, 0, 2, 0, 0, 0)),
		"2026-01-02",
		"补零",
	);
});

test("跟进次数递增", () => {
	const now = new Date(2026, 10, 18, 12, 0, 0);
	assertEqual(
		planContactLog({ [CONTACT_LOG_FOLLOW_UP_KEY]: 2 }, now),
		{ lastContact: "2026-11-18", followUpCount: 3 },
		"数字",
	);
	assertEqual(
		planContactLog({ [CONTACT_LOG_FOLLOW_UP_KEY]: "2" }, now),
		{ lastContact: "2026-11-18", followUpCount: 3 },
		"字符串",
	);
	assertEqual(
		planContactLog({}, now),
		{ lastContact: "2026-11-18", followUpCount: 1 },
		"缺失值按 0",
	);
	assertEqual(
		planContactLog({ [CONTACT_LOG_FOLLOW_UP_KEY]: "bad" }, now),
		{ lastContact: "2026-11-18", followUpCount: 1 },
		"非法值按 0",
	);
});

test("不修改传入的 frontmatter", () => {
	const fm: Record<string, unknown> = {
		[CONTACT_LOG_FOLLOW_UP_KEY]: 4,
		[CONTACT_LOG_LAST_CONTACT_KEY]: "2026-10-10",
	};
	planContactLog(fm, new Date(2026, 10, 18, 12, 0, 0));
	assertEqual(fm[CONTACT_LOG_FOLLOW_UP_KEY], 4, "跟进次数不变");
	assertEqual(fm[CONTACT_LOG_LAST_CONTACT_KEY], "2026-10-10", "联系时间不变");
});
