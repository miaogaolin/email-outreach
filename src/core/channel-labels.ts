/**
 * `#Contact/...` 渠道标签的可读名称。
 *
 * 标签后缀通常是社媒/聊天工具的缩写（如 WA = WhatsApp）。提醒里直接写
 * 可读名称 + 原始内容，避免把 `#Contact/WA：...` 这种标签格式带进任务。
 */

const CHANNEL_LABELS: Record<string, string> = {
	wa: "WhatsApp",
	whatsapp: "WhatsApp",
	wechat: "WeChat",
	weixin: "WeChat",
	wx: "WeChat",
	tg: "Telegram",
	telegram: "Telegram",
	linkedin: "LinkedIn",
	li: "LinkedIn",
	fb: "Facebook",
	facebook: "Facebook",
	ig: "Instagram",
	ins: "Instagram",
	instagram: "Instagram",
	x: "X (Twitter)",
	twitter: "X (Twitter)",
	email: "Email",
	mail: "Email",
	phone: "Phone",
	tel: "Phone",
};

const CONTACT_TAG_RE = /^#Contact(?:\/(.+))?$/i;

function normalizeSuffix(value: string): string {
	return value.toLowerCase().replace(/[\s_-]+/g, "");
}

/** 把 `#Contact/WA` 显示成 `WhatsApp`；未知后缀原样返回。 */
export function channelDisplayLabel(tag: string): string {
	const match = CONTACT_TAG_RE.exec((tag ?? "").trim());
	const suffix = (match?.[1] ?? "").trim();
	if (!suffix) return "其它渠道";
	return CHANNEL_LABELS[normalizeSuffix(suffix)] ?? suffix;
}
