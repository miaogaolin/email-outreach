import { formatContactLogDate } from "../src/core/contact-log";
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
