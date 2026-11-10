export interface LanguageInfo {
	code: string;
	label: string;
	timezone: string;
	confidence: "high" | "medium" | "low";
}

interface CountryEntry extends LanguageInfo {
	names: string[];
}

const ENTRIES: CountryEntry[] = [
	// 东亚
	{ names: ["中国", "china", "cn", "中华人民共和国"], code: "zh", label: "中文", timezone: "Asia/Shanghai", confidence: "high" },
	{ names: ["台湾", "taiwan", "tw"], code: "zh", label: "中文", timezone: "Asia/Taipei", confidence: "high" },
	{ names: ["香港", "hong kong", "hk"], code: "zh", label: "中文", timezone: "Asia/Hong_Kong", confidence: "high" },
	{ names: ["澳门", "macau", "macao", "mo"], code: "zh", label: "中文", timezone: "Asia/Macau", confidence: "high" },
	{ names: ["日本", "japan", "jp"], code: "ja", label: "日语", timezone: "Asia/Tokyo", confidence: "high" },
	{ names: ["韩国", "南韩", "south korea", "korea", "kr"], code: "ko", label: "韩语", timezone: "Asia/Seoul", confidence: "high" },
	{ names: ["朝鲜", "north korea"], code: "ko", label: "韩语", timezone: "Asia/Pyongyang", confidence: "medium" },
	{ names: ["蒙古", "mongolia", "mn"], code: "mn", label: "蒙古语", timezone: "Asia/Ulaanbaatar", confidence: "medium" },
	// 东南亚
	{ names: ["越南", "vietnam", "viet nam", "vn"], code: "vi", label: "越南语", timezone: "Asia/Ho_Chi_Minh", confidence: "high" },
	{ names: ["泰国", "thailand", "th"], code: "th", label: "泰语", timezone: "Asia/Bangkok", confidence: "high" },
	{ names: ["印尼", "印度尼西亚", "indonesia", "id"], code: "id", label: "印尼语", timezone: "Asia/Jakarta", confidence: "high" },
	{ names: ["马来西亚", "malaysia", "my"], code: "ms", label: "马来语", timezone: "Asia/Kuala_Lumpur", confidence: "medium" },
	{ names: ["新加坡", "singapore", "sg"], code: "en", label: "英语", timezone: "Asia/Singapore", confidence: "high" },
	{ names: ["菲律宾", "philippines", "ph"], code: "en", label: "英语", timezone: "Asia/Manila", confidence: "medium" },
	{ names: ["柬埔寨", "cambodia", "kh"], code: "en", label: "英语", timezone: "Asia/Phnom_Penh", confidence: "low" },
	{ names: ["缅甸", "myanmar", "burma", "mm"], code: "en", label: "英语", timezone: "Asia/Yangon", confidence: "low" },
	{ names: ["老挝", "laos", "la"], code: "en", label: "英语", timezone: "Asia/Vientiane", confidence: "low" },
	{ names: ["文莱", "brunei", "bn"], code: "ms", label: "马来语", timezone: "Asia/Brunei", confidence: "medium" },
	// 南亚
	{ names: ["印度", "india", "in"], code: "en", label: "英语", timezone: "Asia/Kolkata", confidence: "high" },
	{ names: ["巴基斯坦", "pakistan", "pk"], code: "en", label: "英语", timezone: "Asia/Karachi", confidence: "medium" },
	{ names: ["孟加拉", "孟加拉国", "bangladesh", "bd"], code: "en", label: "英语", timezone: "Asia/Dhaka", confidence: "medium" },
	{ names: ["斯里兰卡", "sri lanka", "lk"], code: "en", label: "英语", timezone: "Asia/Colombo", confidence: "medium" },
	{ names: ["尼泊尔", "nepal", "np"], code: "en", label: "英语", timezone: "Asia/Kathmandu", confidence: "low" },
	{ names: ["不丹", "bhutan", "bt"], code: "en", label: "英语", timezone: "Asia/Thimphu", confidence: "low" },
	{ names: ["马尔代夫", "maldives", "mv"], code: "en", label: "英语", timezone: "Indian/Maldives", confidence: "medium" },
	// 中亚 / 高加索
	{ names: ["哈萨克斯坦", "kazakhstan", "kz"], code: "ru", label: "俄语", timezone: "Asia/Almaty", confidence: "high" },
	{ names: ["乌兹别克斯坦", "uzbekistan", "uz"], code: "ru", label: "俄语", timezone: "Asia/Tashkent", confidence: "medium" },
	{ names: ["吉尔吉斯斯坦", "kyrgyzstan", "kg"], code: "ru", label: "俄语", timezone: "Asia/Bishkek", confidence: "medium" },
	{ names: ["塔吉克斯坦", "tajikistan", "tj"], code: "ru", label: "俄语", timezone: "Asia/Dushanbe", confidence: "low" },
	{ names: ["土库曼斯坦", "turkmenistan", "tm"], code: "ru", label: "俄语", timezone: "Asia/Ashgabat", confidence: "low" },
	{ names: ["阿塞拜疆", "azerbaijan", "az"], code: "az", label: "阿塞拜疆语", timezone: "Asia/Baku", confidence: "low" },
	{ names: ["格鲁吉亚", "georgia", "ge"], code: "en", label: "英语", timezone: "Asia/Tbilisi", confidence: "low" },
	{ names: ["亚美尼亚", "armenia", "am"], code: "en", label: "英语", timezone: "Asia/Yerevan", confidence: "low" },
	// 中东
	{ names: ["土耳其", "turkey", "türkiye", "tr"], code: "tr", label: "土耳其语", timezone: "Europe/Istanbul", confidence: "high" },
	{ names: ["以色列", "israel", "il"], code: "en", label: "英语", timezone: "Asia/Jerusalem", confidence: "medium" },
	{ names: ["约旦", "jordan", "jo"], code: "ar", label: "阿拉伯语", timezone: "Asia/Amman", confidence: "medium" },
	{ names: ["沙特阿拉伯", "沙特", "saudi arabia", "sa"], code: "ar", label: "阿拉伯语", timezone: "Asia/Riyadh", confidence: "medium" },
	{ names: ["阿联酋", "uae", "united arab emirates", "ae", "迪拜"], code: "en", label: "英语", timezone: "Asia/Dubai", confidence: "high" },
	{ names: ["卡塔尔", "qatar", "qa"], code: "en", label: "英语", timezone: "Asia/Qatar", confidence: "medium" },
	{ names: ["科威特", "kuwait", "kw"], code: "ar", label: "阿拉伯语", timezone: "Asia/Kuwait", confidence: "medium" },
	{ names: ["阿曼", "oman", "om"], code: "ar", label: "阿拉伯语", timezone: "Asia/Muscat", confidence: "medium" },
	{ names: ["巴林", "bahrain", "bh"], code: "ar", label: "阿拉伯语", timezone: "Asia/Bahrain", confidence: "medium" },
	{ names: ["伊拉克", "iraq", "iq"], code: "ar", label: "阿拉伯语", timezone: "Asia/Baghdad", confidence: "medium" },
	{ names: ["伊朗", "iran", "ir"], code: "fa", label: "波斯语", timezone: "Asia/Tehran", confidence: "medium" },
	{ names: ["黎巴嫩", "lebanon", "lb"], code: "en", label: "英语", timezone: "Asia/Beirut", confidence: "medium" },
	{ names: ["叙利亚", "syria", "sy"], code: "ar", label: "阿拉伯语", timezone: "Asia/Damascus", confidence: "low" },
	{ names: ["也门", "yemen", "ye"], code: "ar", label: "阿拉伯语", timezone: "Asia/Aden", confidence: "low" },
	// 欧洲
	{ names: ["英国", "uk", "united kingdom", "england", "gb", "britain"], code: "en", label: "英语", timezone: "Europe/London", confidence: "high" },
	{ names: ["爱尔兰", "ireland", "ie"], code: "en", label: "英语", timezone: "Europe/Dublin", confidence: "high" },
	{ names: ["法国", "france", "fr"], code: "fr", label: "法语", timezone: "Europe/Paris", confidence: "high" },
	{ names: ["德国", "germany", "de", "deutschland"], code: "de", label: "德语", timezone: "Europe/Berlin", confidence: "high" },
	{ names: ["意大利", "italy", "it"], code: "it", label: "意大利语", timezone: "Europe/Rome", confidence: "high" },
	{ names: ["西班牙", "spain", "es"], code: "es", label: "西班牙语", timezone: "Europe/Madrid", confidence: "high" },
	{ names: ["葡萄牙", "portugal", "pt"], code: "pt", label: "葡萄牙语", timezone: "Europe/Lisbon", confidence: "high" },
	{ names: ["荷兰", "netherlands", "holland", "nl"], code: "nl", label: "荷兰语", timezone: "Europe/Amsterdam", confidence: "high" },
	{ names: ["比利时", "belgium", "be"], code: "nl", label: "荷兰语", timezone: "Europe/Brussels", confidence: "medium" },
	{ names: ["卢森堡", "luxembourg", "lu"], code: "fr", label: "法语", timezone: "Europe/Luxembourg", confidence: "medium" },
	{ names: ["瑞士", "switzerland", "ch"], code: "de", label: "德语", timezone: "Europe/Zurich", confidence: "medium" },
	{ names: ["奥地利", "austria", "at"], code: "de", label: "德语", timezone: "Europe/Vienna", confidence: "high" },
	{ names: ["瑞典", "sweden", "se"], code: "sv", label: "瑞典语", timezone: "Europe/Stockholm", confidence: "high" },
	{ names: ["挪威", "norway", "no"], code: "no", label: "挪威语", timezone: "Europe/Oslo", confidence: "high" },
	{ names: ["丹麦", "denmark", "dk"], code: "da", label: "丹麦语", timezone: "Europe/Copenhagen", confidence: "high" },
	{ names: ["芬兰", "finland", "fi"], code: "fi", label: "芬兰语", timezone: "Europe/Helsinki", confidence: "high" },
	{ names: ["冰岛", "iceland", "is"], code: "is", label: "冰岛语", timezone: "Atlantic/Reykjavik", confidence: "medium" },
	{ names: ["波兰", "poland", "pl"], code: "pl", label: "波兰语", timezone: "Europe/Warsaw", confidence: "high" },
	{ names: ["捷克", "czech", "cz", "czechia"], code: "cs", label: "捷克语", timezone: "Europe/Prague", confidence: "high" },
	{ names: ["斯洛伐克", "slovakia", "sk"], code: "sk", label: "斯洛伐克语", timezone: "Europe/Bratislava", confidence: "high" },
	{ names: ["匈牙利", "hungary", "hu"], code: "hu", label: "匈牙利语", timezone: "Europe/Budapest", confidence: "high" },
	{ names: ["罗马尼亚", "romania", "ro"], code: "ro", label: "罗马尼亚语", timezone: "Europe/Bucharest", confidence: "high" },
	{ names: ["保加利亚", "bulgaria", "bg"], code: "bg", label: "保加利亚语", timezone: "Europe/Sofia", confidence: "high" },
	{ names: ["希腊", "greece", "gr"], code: "el", label: "希腊语", timezone: "Europe/Athens", confidence: "high" },
	{ names: ["克罗地亚", "croatia", "hr"], code: "hr", label: "克罗地亚语", timezone: "Europe/Zagreb", confidence: "high" },
	{ names: ["塞尔维亚", "serbia", "rs"], code: "sr", label: "塞尔维亚语", timezone: "Europe/Belgrade", confidence: "medium" },
	{ names: ["斯洛文尼亚", "slovenia", "si"], code: "sl", label: "斯洛文尼亚语", timezone: "Europe/Ljubljana", confidence: "medium" },
	{ names: ["波黑", "波斯尼亚", "bosnia", "ba"], code: "bs", label: "波斯尼亚语", timezone: "Europe/Sarajevo", confidence: "medium" },
	{ names: ["黑山", "montenegro", "me"], code: "sr", label: "塞尔维亚语", timezone: "Europe/Podgorica", confidence: "low" },
	{ names: ["北马其顿", "macedonia", "mk"], code: "en", label: "英语", timezone: "Europe/Skopje", confidence: "low" },
	{ names: ["阿尔巴尼亚", "albania", "al"], code: "en", label: "英语", timezone: "Europe/Tirane", confidence: "low" },
	{ names: ["乌克兰", "ukraine", "ua"], code: "uk", label: "乌克兰语", timezone: "Europe/Kyiv", confidence: "medium" },
	{ names: ["白俄罗斯", "belarus", "by"], code: "ru", label: "俄语", timezone: "Europe/Minsk", confidence: "high" },
	{ names: ["俄罗斯", "russia", "ru", "俄国"], code: "ru", label: "俄语", timezone: "Europe/Moscow", confidence: "high" },
	{ names: ["立陶宛", "lithuania", "lt"], code: "lt", label: "立陶宛语", timezone: "Europe/Vilnius", confidence: "medium" },
	{ names: ["拉脱维亚", "latvia", "lv"], code: "lv", label: "拉脱维亚语", timezone: "Europe/Riga", confidence: "medium" },
	{ names: ["爱沙尼亚", "estonia", "ee"], code: "et", label: "爱沙尼亚语", timezone: "Europe/Tallinn", confidence: "medium" },
	{ names: ["摩尔多瓦", "moldova", "md"], code: "ro", label: "罗马尼亚语", timezone: "Europe/Chisinau", confidence: "medium" },
	{ names: ["塞浦路斯", "cyprus", "cy"], code: "en", label: "英语", timezone: "Asia/Nicosia", confidence: "medium" },
	{ names: ["马耳他", "malta", "mt"], code: "en", label: "英语", timezone: "Europe/Malta", confidence: "medium" },
	// 北美
	{ names: ["美国", "usa", "us", "united states", "america"], code: "en", label: "英语", timezone: "America/New_York", confidence: "high" },
	{ names: ["加拿大", "canada", "ca"], code: "en", label: "英语", timezone: "America/Toronto", confidence: "medium" },
	// 拉美
	{ names: ["墨西哥", "mexico", "mx"], code: "es", label: "西班牙语", timezone: "America/Mexico_City", confidence: "high" },
	{ names: ["巴西", "brazil", "br", "brasil"], code: "pt", label: "葡萄牙语", timezone: "America/Sao_Paulo", confidence: "high" },
	{ names: ["阿根廷", "argentina", "ar"], code: "es", label: "西班牙语", timezone: "America/Argentina/Buenos_Aires", confidence: "high" },
	{ names: ["智利", "chile", "cl"], code: "es", label: "西班牙语", timezone: "America/Santiago", confidence: "high" },
	{ names: ["秘鲁", "peru", "pe"], code: "es", label: "西班牙语", timezone: "America/Lima", confidence: "high" },
	{ names: ["哥伦比亚", "colombia", "co"], code: "es", label: "西班牙语", timezone: "America/Bogota", confidence: "high" },
	{ names: ["厄瓜多尔", "ecuador", "ec"], code: "es", label: "西班牙语", timezone: "America/Guayaquil", confidence: "high" },
	{ names: ["玻利维亚", "bolivia", "bo"], code: "es", label: "西班牙语", timezone: "America/La_Paz", confidence: "high" },
	{ names: ["委内瑞拉", "venezuela", "ve"], code: "es", label: "西班牙语", timezone: "America/Caracas", confidence: "high" },
	{ names: ["乌拉圭", "uruguay", "uy"], code: "es", label: "西班牙语", timezone: "America/Montevideo", confidence: "high" },
	{ names: ["巴拉圭", "paraguay", "py"], code: "es", label: "西班牙语", timezone: "America/Asuncion", confidence: "high" },
	{ names: ["圭亚那", "guyana", "gy"], code: "en", label: "英语", timezone: "America/Guyana", confidence: "medium" },
	{ names: ["苏里南", "suriname", "sr"], code: "nl", label: "荷兰语", timezone: "America/Paramaribo", confidence: "low" },
	{ names: ["巴拿马", "panama", "pa"], code: "es", label: "西班牙语", timezone: "America/Panama", confidence: "high" },
	{ names: ["哥斯达黎加", "costa rica", "cr"], code: "es", label: "西班牙语", timezone: "America/Costa_Rica", confidence: "high" },
	{ names: ["危地马拉", "guatemala", "gt"], code: "es", label: "西班牙语", timezone: "America/Guatemala", confidence: "high" },
	{ names: ["萨尔瓦多", "el salvador", "sv"], code: "es", label: "西班牙语", timezone: "America/El_Salvador", confidence: "high" },
	{ names: ["洪都拉斯", "honduras", "hn"], code: "es", label: "西班牙语", timezone: "America/Tegucigalpa", confidence: "high" },
	{ names: ["尼加拉瓜", "nicaragua", "ni"], code: "es", label: "西班牙语", timezone: "America/Managua", confidence: "high" },
	{ names: ["多米尼加", "dominican republic", "do"], code: "es", label: "西班牙语", timezone: "America/Santo_Domingo", confidence: "high" },
	{ names: ["古巴", "cuba", "cu"], code: "es", label: "西班牙语", timezone: "America/Havana", confidence: "high" },
	{ names: ["波多黎各", "puerto rico", "pr"], code: "es", label: "西班牙语", timezone: "America/Puerto_Rico", confidence: "high" },
	{ names: ["牙买加", "jamaica", "jm"], code: "en", label: "英语", timezone: "America/Jamaica", confidence: "high" },
	{ names: ["特立尼达和多巴哥", "trinidad", "tt"], code: "en", label: "英语", timezone: "America/Port_of_Spain", confidence: "high" },
	{ names: ["伯利兹", "belize", "bz"], code: "en", label: "英语", timezone: "America/Belize", confidence: "high" },
	// 非洲
	{ names: ["南非", "south africa", "za"], code: "en", label: "英语", timezone: "Africa/Johannesburg", confidence: "medium" },
	{ names: ["埃及", "egypt", "eg"], code: "ar", label: "阿拉伯语", timezone: "Africa/Cairo", confidence: "medium" },
	{ names: ["摩洛哥", "morocco", "ma"], code: "fr", label: "法语", timezone: "Africa/Casablanca", confidence: "medium" },
	{ names: ["阿尔及利亚", "algeria", "dz"], code: "fr", label: "法语", timezone: "Africa/Algiers", confidence: "medium" },
	{ names: ["突尼斯", "tunisia", "tn"], code: "fr", label: "法语", timezone: "Africa/Tunis", confidence: "medium" },
	{ names: ["利比亚", "libya", "ly"], code: "ar", label: "阿拉伯语", timezone: "Africa/Tripoli", confidence: "low" },
	{ names: ["尼日利亚", "nigeria", "ng"], code: "en", label: "英语", timezone: "Africa/Lagos", confidence: "high" },
	{ names: ["加纳", "ghana", "gh"], code: "en", label: "英语", timezone: "Africa/Accra", confidence: "high" },
	{ names: ["肯尼亚", "kenya", "ke"], code: "en", label: "英语", timezone: "Africa/Nairobi", confidence: "high" },
	{ names: ["坦桑尼亚", "tanzania", "tz"], code: "en", label: "英语", timezone: "Africa/Dar_es_Salaam", confidence: "medium" },
	{ names: ["乌干达", "uganda", "ug"], code: "en", label: "英语", timezone: "Africa/Kampala", confidence: "medium" },
	{ names: ["埃塞俄比亚", "ethiopia", "et"], code: "en", label: "英语", timezone: "Africa/Addis_Ababa", confidence: "medium" },
	{ names: ["苏丹", "sudan", "sd"], code: "ar", label: "阿拉伯语", timezone: "Africa/Khartoum", confidence: "low" },
	{ names: ["喀麦隆", "cameroon", "cm"], code: "fr", label: "法语", timezone: "Africa/Douala", confidence: "medium" },
	{ names: ["科特迪瓦", "ivory coast", "cote d'ivoire", "ci"], code: "fr", label: "法语", timezone: "Africa/Abidjan", confidence: "medium" },
	{ names: ["塞内加尔", "senegal", "sn"], code: "fr", label: "法语", timezone: "Africa/Dakar", confidence: "medium" },
	{ names: ["津巴布韦", "zimbabwe", "zw"], code: "en", label: "英语", timezone: "Africa/Harare", confidence: "medium" },
	{ names: ["赞比亚", "zambia", "zm"], code: "en", label: "英语", timezone: "Africa/Lusaka", confidence: "medium" },
	{ names: ["莫桑比克", "mozambique", "mz"], code: "pt", label: "葡萄牙语", timezone: "Africa/Maputo", confidence: "medium" },
	{ names: ["安哥拉", "angola", "ao"], code: "pt", label: "葡萄牙语", timezone: "Africa/Luanda", confidence: "medium" },
	{ names: ["博茨瓦纳", "botswana", "bw"], code: "en", label: "英语", timezone: "Africa/Gaborone", confidence: "medium" },
	{ names: ["纳米比亚", "namibia", "na"], code: "en", label: "英语", timezone: "Africa/Windhoek", confidence: "medium" },
	{ names: ["卢旺达", "rwanda", "rw"], code: "en", label: "英语", timezone: "Africa/Kigali", confidence: "medium" },
	{ names: ["马达加斯加", "madagascar", "mg"], code: "fr", label: "法语", timezone: "Indian/Antananarivo", confidence: "low" },
	{ names: ["毛里求斯", "mauritius", "mu"], code: "en", label: "英语", timezone: "Indian/Mauritius", confidence: "medium" },
	// 大洋洲
	{ names: ["澳大利亚", "australia", "au"], code: "en", label: "英语", timezone: "Australia/Sydney", confidence: "high" },
	{ names: ["新西兰", "new zealand", "nz"], code: "en", label: "英语", timezone: "Pacific/Auckland", confidence: "high" },
];

const BY_KEY = new Map<string, CountryEntry>();
for (const entry of ENTRIES) {
	for (const name of entry.names) {
		BY_KEY.set(normalizeRegion(name), entry);
		BY_KEY.set(normalizeRegion(name.replace(/\s+/g, "")), entry);
	}
}

export const LANGUAGE_LABELS: Record<string, string> = {
	zh: "中文",
	en: "英语",
	es: "西班牙语",
	pt: "葡萄牙语",
	fr: "法语",
	de: "德语",
	it: "意大利语",
	nl: "荷兰语",
	ru: "俄语",
	uk: "乌克兰语",
	pl: "波兰语",
	cs: "捷克语",
	sk: "斯洛伐克语",
	hu: "匈牙利语",
	ro: "罗马尼亚语",
	bg: "保加利亚语",
	el: "希腊语",
	hr: "克罗地亚语",
	sr: "塞尔维亚语",
	sl: "斯洛文尼亚语",
	bs: "波斯尼亚语",
	tr: "土耳其语",
	ar: "阿拉伯语",
	he: "希伯来语",
	fa: "波斯语",
	ja: "日语",
	ko: "韩语",
	vi: "越南语",
	th: "泰语",
	id: "印尼语",
	ms: "马来语",
	hi: "印地语",
	bn: "孟加拉语",
	ur: "乌尔都语",
	sv: "瑞典语",
	no: "挪威语",
	da: "丹麦语",
	fi: "芬兰语",
	is: "冰岛语",
	lt: "立陶宛语",
	lv: "拉脱维亚语",
	et: "爱沙尼亚语",
	az: "阿塞拜疆语",
	ka: "格鲁吉亚语",
	hy: "亚美尼亚语",
	mn: "蒙古语",
	km: "高棉语",
	my: "缅甸语",
	lo: "老挝语",
	ne: "尼泊尔语",
	si: "僧伽罗语",
	sw: "斯瓦希里语",
	am: "阿姆哈拉语",
};

function normalizeRegion(region: string): string {
	return region
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/[()（）【】[\]]/g, "");
}

export function guessLanguage(region: unknown): LanguageInfo | null {
	if (typeof region !== "string") return null;
	const raw = region.trim();
	if (!raw) return null;

	const direct = BY_KEY.get(normalizeRegion(raw));
	if (direct) return toInfo(direct);

	// Handle values such as "美国 东部", "秘鲁 Lima", "俄罗斯/莫斯科".
	const normalized = normalizeRegion(raw);
	for (const entry of ENTRIES) {
		for (const name of entry.names) {
			const key = normalizeRegion(name);
			if (key.length >= 2 && normalized.includes(key)) {
				return toInfo(entry);
			}
		}
	}
	return null;
}

function toInfo(entry: CountryEntry): LanguageInfo {
	return {
		code: entry.code,
		label: entry.label,
		timezone: entry.timezone,
		confidence: entry.confidence,
	};
}

export function languageLabel(code: string): string {
	const normalized = (code ?? "").trim().toLowerCase();
	const label = LANGUAGE_LABELS[normalized];
	return label ?? (normalized || "未知语言");
}

export function isKnownLanguage(code: string): boolean {
	return Object.prototype.hasOwnProperty.call(
		LANGUAGE_LABELS,
		(code ?? "").trim().toLowerCase(),
	);
}

export function isPlausibleLanguageCode(code: string): boolean {
	return /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test((code ?? "").trim());
}

/** All language options offered in the manual picker, sorted by Chinese name. */
export function languageOptions(): { code: string; label: string }[] {
	return Object.entries(LANGUAGE_LABELS)
		.map(([code, label]) => ({ code, label }))
		.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}
