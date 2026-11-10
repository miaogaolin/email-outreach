const WIKI_LINK_RE = /(!?)\[\[([^\]\n]+)\]\]/g;
const ATTACHMENT_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"svg",
	"bmp",
	"pdf",
	"mp3",
	"mp4",
	"webm",
	"mov",
	"wav",
	"m4a",
	"ogg",
	"zip",
	"xlsx",
	"xls",
	"docx",
	"doc",
	"pptx",
	"ppt",
	"canvas",
	"base",
]);

export interface WikiLinkRef {
	target: string;
	embed: boolean;
	raw: string;
}

/** Strip `#heading` and `|alias` from a wikilink body. */
export function normalizeLinkTarget(body: string): string {
	let target = body.split("|")[0] ?? "";
	const hash = target.indexOf("#");
	if (hash >= 0) target = target.slice(0, hash);
	return target.trim();
}

export function isAttachmentPath(path: string): boolean {
	const cleaned = path.split("#")[0]?.trim() ?? "";
	const dot = cleaned.lastIndexOf(".");
	if (dot < 0) return false;
	const ext = cleaned.slice(dot + 1).toLowerCase();
	return ATTACHMENT_EXTENSIONS.has(ext);
}

/** Extract wiki links from Markdown text, ignoring images/attachments. */
export function extractWikiLinks(text: string): WikiLinkRef[] {
	const out: WikiLinkRef[] = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(WIKI_LINK_RE)) {
		const embed = match[1] === "!";
		const raw = match[2] ?? "";
		const target = normalizeLinkTarget(raw);
		if (!target) continue;
		if (isAttachmentPath(target)) continue;
		const key = `${embed ? "!" : ""}${target}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ target, embed, raw: match[0] });
	}
	return out;
}

/** Convert a vault path to a wikilink target without the `.md` extension. */
export function pathToLinkTarget(path: string): string {
	return path.replace(/\.md$/i, "");
}

/** Extract the first `[[...]]`/`![[...]]` link target from a frontmatter string. */
export function parseSingleWikilink(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const match = value.match(/\[\[([^\]\n]+)\]\]/);
	if (!match) return null;
	const target = normalizeLinkTarget(match[1] ?? "");
	return target || null;
}

export function toWikilink(target: string): string {
	return `[[${target}]]`;
}
