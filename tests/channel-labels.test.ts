import { channelDisplayLabel } from "../src/core/channel-labels";
import { assertEqual, suite, test } from "./harness";

suite("channel labels");

test("常见渠道缩写转可读名称", () => {
	assertEqual(channelDisplayLabel("#Contact/WA"), "WhatsApp", "WA");
	assertEqual(channelDisplayLabel("#Contact/whatsapp"), "WhatsApp", "小写 whatsapp");
	assertEqual(channelDisplayLabel("#Contact/LinkedIn"), "LinkedIn", "LinkedIn");
	assertEqual(channelDisplayLabel("#Contact/WeChat"), "WeChat", "WeChat");
	assertEqual(channelDisplayLabel("#Contact/wx"), "WeChat", "wx");
	assertEqual(channelDisplayLabel("#Contact/TG"), "Telegram", "TG");
	assertEqual(channelDisplayLabel("#Contact/FB"), "Facebook", "FB");
	assertEqual(channelDisplayLabel("#Contact/IG"), "Instagram", "IG");
	assertEqual(channelDisplayLabel("#Contact/X"), "X (Twitter)", "X");
	assertEqual(channelDisplayLabel("#Contact/Phone"), "Phone", "Phone");
});

test("未知后缀原样保留，空后缀回退", () => {
	assertEqual(channelDisplayLabel("#Contact/Signal"), "Signal", "未知后缀");
	assertEqual(channelDisplayLabel("#Contact"), "其它渠道", "无后缀");
	assertEqual(channelDisplayLabel("  #Contact/WA  "), "WhatsApp", "首尾空格");
});
