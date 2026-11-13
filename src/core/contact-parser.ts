import type {
	Contact,
	ContactParseResult,
	ParseWarning,
} from "./types";

const HEADING_RE = /^##[ \t]+(contact|contacts|联系人|联系方式)[ \t]*$/i;
const SECTION_END_RE = /^#{1,2}[ \t]+\S/;
const LIST_RE = /^([-*+]|\d+[.)])[ \t]+(.*)$/;
const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /https?:\/\/[^\s)\]>"']+/gi;
const LINKEDIN_RE = /(?:www\.)?linkedin\.com\/[^\s)\]>"']+/gi;
const TAG_RE = /#[A-Za-z0-9_][A-Za-z0-9_/-]*/g;
const PHONE_RE = /\+?\d[\d\s().-]{5,}\d/g;
const ROLE_LINE_RE =
	/^\s*(?:\*\*)?(职位|职位名称|职务|role|title)(?:\*\*)?\s*[：:]\s*(.+)$/i;
const ROLE_PAREN_RE = /^(.*?)[（(]\s*([^（）()]+?)\s*[）)]\s*$/;

interface TokenBag {
	emails: string[];
	phones: string[];
	links: string[];
	tags: string[];
	rest: string;
}

function dedupe(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const key = value.trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(value.trim());
	}
	return out;
}

function normalizeEmail(raw: string): string | null {
	const value = raw
		.trim()
		.replace(/^mailto:/i, "")
		.replace(/^[<\s]+|[>\s]+$/g, "");
	if (!/^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)) {
		return null;
	}
	return value;
}

function normalizePhone(raw: string): string | null {
	const value = raw.trim().replace(/\s+/g, " ");
	const digits = value.replace(/\D/g, "");
	if (digits.length < 7 || digits.length > 15) return null;
	return value;
}

/**
 * Pull emails / phones / links / tags out of a line, leaving the remaining text.
 * Emails are only ever returned for the line they literally appear on, which is
 * what keeps contact blocks from leaking addresses into each other.
 */
function extractTokens(text: string): TokenBag {
	const emails: string[] = [];
	const phones: string[] = [];
	const links: string[] = [];
	const tags: string[] = [];
	let rest = text;

	const takeEmails = (candidate: string): string => {
		const found = candidate.match(EMAIL_RE) ?? [];
		for (const item of found) {
			const normalized = normalizeEmail(item);
			if (normalized) emails.push(normalized);
		}
		return found.length > 0 ? candidate.replace(EMAIL_RE, " ") : candidate;
	};

	// [label](mailto:addr)
	rest = rest.replace(
		/\[([^\]]*)\]\(\s*mailto:([^)\s]+)\s*\)/gi,
		(_match, _label: string, address: string) => {
			const normalized = normalizeEmail(address);
			if (normalized) emails.push(normalized);
			return " ";
		},
	);

	// [label](https://...)
	rest = rest.replace(
		/\[([^\]]*)\]\(\s*(https?:\/\/[^)\s]+)\s*\)/gi,
		(_match, _label: string, url: string) => {
			links.push(url);
			return " ";
		},
	);

	rest = rest.replace(URL_RE, (match) => {
		links.push(match);
		return " ";
	});
	rest = rest.replace(LINKEDIN_RE, (match) => {
		links.push(/^https?:\/\//i.test(match) ? match : `https://${match}`);
		return " ";
	});
	rest = takeEmails(rest);

	rest = rest.replace(TAG_RE, (match) => {
		tags.push(match);
		return " ";
	});

	rest = rest.replace(PHONE_RE, (match) => {
		// Skip things that are clearly not phone numbers (dates, long ids).
		const phone = normalizePhone(match);
		if (phone) {
			phones.push(phone);
			return " ";
		}
		return match;
	});

	return {
		emails: dedupe(emails),
		phones: dedupe(phones),
		links: dedupe(links),
		tags: dedupe(tags),
		rest,
	};
}

function cleanText(text: string): string {
	return text
		.replace(/\*\*/g, "")
		.replace(/[ \t]+/g, " ")
		.replace(/^[\s\-–—:：,，、|]+/, "")
		.replace(/[\s\-–—:：,，、|]+$/, "")
		.trim();
}

function splitNameAndRole(text: string): {
	name: string;
	role: string | null;
} {
	const cleaned = cleanText(text);
	const paren = cleaned.match(ROLE_PAREN_RE);
	if (paren) {
		const name = cleanText(paren[1] ?? "");
		const role = cleanText(paren[2] ?? "");
		return { name, role: role || null };
	}
	return { name: cleaned, role: null };
}

function normalizeIndent(line: string): string {
	return line.replace(/\t/g, "    ");
}

function leadingSpaces(line: string): number {
	const match = line.match(/^ */);
	return match ? match[0].length : 0;
}

/**
 * Parse the `## Contact` / `## 联系人` section of a customer note.
 *
 * Rules:
 * - A level-1 list item starts a contact; everything indented below it belongs
 *   to that contact.
 * - Emails are extracted only from a contact's own block.
 * - Contact names are preserved verbatim (raw), with a best-effort display name.
 */
export function parseContacts(markdown: string): ContactParseResult {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const warnings: ParseWarning[] = [];
	let headingLine: number | null = null;
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (HEADING_RE.test(lines[i] ?? "")) {
			headingLine = i + 1;
			start = i + 1;
			break;
		}
	}
	if (start < 0) {
		return { headingFound: false, headingLine: null, contacts: [], warnings };
	}

	let end = lines.length;
	for (let i = start; i < lines.length; i++) {
		if (SECTION_END_RE.test(lines[i] ?? "")) {
			end = i;
			break;
		}
	}

	const contacts: Contact[] = [];
	let plainMode = false;
	let current:
		| {
				raw: string;
				name: string;
				role: string | null;
				emails: string[];
				phones: string[];
				links: string[];
				notes: string[];
				line: number;
		  }
		| null = null;

	const flush = (): void => {
		if (!current) return;
		const fallbackEmail = current.emails[0];
		let name = current.name;
		if (!name) {
			name = fallbackEmail ?? "未命名联系人";
			warnings.push({
				line: current.line,
				message: "联系人名称为空，已使用邮箱或占位名称代替",
				text: current.raw,
			});
		}
		contacts.push({
			id: `C${contacts.length + 1}`,
			raw: current.raw,
			name,
			role: current.role,
			emails: current.emails,
			phones: current.phones,
			links: current.links,
			notes: current.notes,
			line: current.line,
		});
		current = null;
		plainMode = false;
	};

	const looksLikeNameLine = (text: string): boolean => {
		const value = text.trim();
		if (!value || value.length > 60) return false;
		if (/[。.!！?？；;:：]$/.test(value)) return false;
		if (/^[|>]/.test(value)) return false;
		return true;
	};

	const nextNonEmptyIndent = (from: number): number => {
		for (let j = from; j < end; j++) {
			const candidate = normalizeIndent(lines[j] ?? "");
			if (candidate.trim()) return leadingSpaces(candidate);
		}
		return -1;
	};

	for (let i = start; i < end; i++) {
		const original = lines[i] ?? "";
		const line = normalizeIndent(original);
		const trimmed = line.trim();
		if (!trimmed) continue;
		const indent = leadingSpaces(line);
		const list = trimmed.match(LIST_RE);

		// Some customer notes put the contact name on a plain line and the
		// details in top-level bullets below it (no nested indentation).
		if (!list && indent === 0) {
			if (!looksLikeNameLine(trimmed)) {
				if (current) current.notes.push(trimmed);
				else {
					warnings.push({
						line: i + 1,
						message: "联系人区段中出现无法归属到联系人的内容",
						text: trimmed,
					});
				}
				continue;
			}
			flush();
			const tokens = extractTokens(trimmed);
			const split = splitNameAndRole(tokens.rest);
			current = {
				raw: trimmed,
				name: split.name,
				role: split.role,
				emails: tokens.emails,
				phones: tokens.phones,
				links: tokens.links,
				notes: tokens.tags.length > 0 ? [`标签：${tokens.tags.join(" ")}`] : [],
				line: i + 1,
			};
			plainMode = true;
			continue;
		}

		if (list && indent === 0) {
			const body = list[2] ?? "";
			const preview = extractTokens(body);
			const looksLikeNewBulletContact =
				!plainMode ||
				(preview.emails.length === 0 &&
					preview.phones.length === 0 &&
					preview.links.length === 0 &&
					looksLikeNameLine(cleanText(preview.rest)) &&
					nextNonEmptyIndent(i + 1) > 0);
			if (looksLikeNewBulletContact) {
				flush();
				current = {
					raw: trimmed.replace(/^[-*+]\s+/, ""),
					name: splitNameAndRole(preview.rest).name,
					role: splitNameAndRole(preview.rest).role,
					emails: preview.emails,
					phones: preview.phones,
					links: preview.links,
					notes:
						preview.tags.length > 0 ? [`标签：${preview.tags.join(" ")}`] : [],
					line: i + 1,
				};
				plainMode = false;
				continue;
			}
		}

		if (!current) {
			warnings.push({
				line: i + 1,
				message: "联系人区段中出现无法归属到联系人的内容",
				text: trimmed,
			});
			continue;
		}

		const bodyText = list ? (list[2] ?? "") : trimmed;
		const tokens = extractTokens(bodyText);
		current.emails.push(...tokens.emails);
		current.phones.push(...tokens.phones);
		current.links.push(...tokens.links);

		const roleMatch = bodyText.match(ROLE_LINE_RE);
		if (roleMatch) {
			const role = cleanText(roleMatch[2] ?? "");
			if (role && !current.role) current.role = role;
			continue;
		}

		const rest = cleanText(tokens.rest);
		if (rest) {
			current.notes.push(rest);
		}
	}

	flush();

	// Deduplicate per contact while keeping order.
	for (const contact of contacts) {
		contact.emails = dedupe(contact.emails);
		contact.phones = dedupe(contact.phones);
		contact.links = dedupe(contact.links);
	}

	if (contacts.length === 0) {
		warnings.push({
			line: headingLine ?? 1,
			message: "找到联系人标题，但没有解析出任何联系人",
			text: "## Contact",
		});
	}

	return { headingFound: true, headingLine, contacts, warnings };
}

/** Contacts that can actually receive an email. */
export function contactsWithEmail(contacts: Contact[]): Contact[] {
	return contacts.filter((contact) => contact.emails.length > 0);
}

/** Return the raw `## Contact` / `## 联系人` section, or an empty string. */
export function extractContactSection(markdown: string): string {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (HEADING_RE.test(lines[i] ?? "")) {
			start = i;
			break;
		}
	}
	if (start < 0) return "";
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (SECTION_END_RE.test(lines[i] ?? "")) {
			end = i;
			break;
		}
	}
	return lines.slice(start, end).join("\n").trim();
}

/** Remove the YAML frontmatter block from a note body. */
export function stripFrontmatter(markdown: string): string {
	const text = markdown.replace(/\r\n?/g, "\n");
	if (!text.startsWith("---")) return text;
	const end = text.indexOf("\n---", 3);
	if (end < 0) return text;
	const after = text.indexOf("\n", end + 4);
	return after < 0 ? "" : text.slice(after + 1);
}

export function findContact(
	contacts: Contact[],
	contactId: string | null | undefined,
): Contact | null {
	if (!contactId) return null;
	return contacts.find((contact) => contact.id === contactId) ?? null;
}

/** 根据已落盘邮件里的邮箱/联系人原文找到原联系人（重新生成用）。 */
export function findContactByEmail(
	contacts: Contact[],
	email: string | null | undefined,
	contactRaw?: string | null,
): Contact | null {
	const normalizedEmail = (email ?? "").trim().toLowerCase();
	if (normalizedEmail) {
		const byEmail = contacts.find((contact) =>
			contact.emails.some(
				(address) => address.toLowerCase() === normalizedEmail,
			),
		);
		if (byEmail) return byEmail;
	}
	const raw = (contactRaw ?? "").trim();
	if (!raw) return null;
	return (
		contacts.find((contact) => contact.raw.trim() === raw) ?? null
	);
}
