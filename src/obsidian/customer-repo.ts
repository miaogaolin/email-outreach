import { App, TFile } from "obsidian";
import {
	extractContactSection,
	parseContacts,
	stripFrontmatter,
} from "../core/contact-parser";
import { normalizeDir } from "../core/filenames";
import type { ContactParseResult, CustomerRecord } from "../core/types";
import { VaultAdapter } from "./vault-adapter";

export interface CustomerPayload {
	record: CustomerRecord;
	content: string;
	contacts: ContactParseResult;
	frontmatterText: string;
	contactSection: string;
	bodyExcerpt: string;
	bodyTruncated: boolean;
}

function normalizeTags(raw: unknown): string[] {
	const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
	return values
		.map((value) => String(value).trim())
		.filter(Boolean)
		.map((value) => value.replace(/^#/, ""));
}

function formatValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (Array.isArray(value)) {
		return value.map((item) => formatValue(item)).join(", ");
	}
	if (typeof value === "object") {
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}
	return String(value);
}

export function formatFrontmatter(fm: Record<string, unknown>): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(fm)) {
		if (key === "position") continue;
		lines.push(`${key}: ${formatValue(value)}`);
	}
	return lines.join("\n");
}

export class CustomerRepo {
	private cache: CustomerRecord[] = [];
	private cacheKey = "";
	private cacheTime = 0;
	/** 联系人数量按 path + mtime 缓存，避免每次刷新工作台都重读所有客户笔记。 */
	private contactCounts = new Map<string, { mtime: number; count: number }>();
	private contactCountLoads = new Map<string, Promise<number>>();

	constructor(
		private app: App,
		private getDir: () => string,
		private adapter: VaultAdapter,
	) {}

	private dirKey(): string {
		return normalizeDir(this.getDir());
	}

	list(force = false): CustomerRecord[] {
		const dir = this.dirKey();
		const now = Date.now();
		if (!force && this.cacheKey === dir && now - this.cacheTime < 2000) {
			return this.cache;
		}
		this.cache = this.build(dir);
		this.cacheKey = dir;
		this.cacheTime = now;
		return this.cache;
	}

	invalidate(): void {
		this.cacheTime = 0;
	}

	private build(dir: string): CustomerRecord[] {
		if (!dir) return [];
		const files = this.adapter.listMarkdown(dir);
		const records: CustomerRecord[] = [];
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter ?? {};
			const fm: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(frontmatter)) {
				if (key === "position") continue;
				fm[key] = value;
			}
			const tags = normalizeTags(fm.tags);
			if (cache?.tags) {
				for (const tag of cache.tags) {
					const cleaned = normalizeTags(tag.tag)[0];
					if (cleaned && !tags.includes(cleaned)) tags.push(cleaned);
				}
			}
			records.push({
				path: file.path,
				name: file.basename,
				fm,
				tags,
				mtime: file.stat?.mtime ?? 0,
			});
		}
		return records;
	}

	find(path: string): CustomerRecord | null {
		return this.list().find((record) => record.path === path) ?? null;
	}

	/** 已缓存的联系人数量；null 表示还没读取或文件已变化。 */
	getContactCount(record: CustomerRecord): number | null {
		const cached = this.contactCounts.get(record.path);
		if (!cached || cached.mtime !== record.mtime) return null;
		return cached.count;
	}

	/** 读取并缓存一个客户的联系人数量。并发调用同一个文件时只读一次。 */
	async loadContactCount(record: CustomerRecord): Promise<number> {
		const cached = this.getContactCount(record);
		if (cached !== null) return cached;
		// key 里带上 mtime：文件刚改过时不能复用旧内容的读取任务。
		const key = `${record.path}\u0000${record.mtime}`;
		const inFlight = this.contactCountLoads.get(key);
		if (inFlight) return inFlight;
		const promise = this.readContactCount(record).finally(() => {
			if (this.contactCountLoads.get(key) === promise) {
				this.contactCountLoads.delete(key);
			}
		});
		this.contactCountLoads.set(key, promise);
		return promise;
	}

	private async readContactCount(record: CustomerRecord): Promise<number> {
		const file = this.adapter.getFile(record.path) as TFile | null;
		const content = file
			? await this.app.vault.cachedRead(file)
			: await this.adapter.read(record.path);
		const count = parseContacts(content).contacts.length;
		this.contactCounts.set(record.path, { mtime: record.mtime, count });
		return count;
	}

	async load(
		record: CustomerRecord,
		truncateChars: number,
	): Promise<CustomerPayload> {
		const file = this.adapter.getFile(record.path) as TFile | null;
		const content = file
			? await this.app.vault.cachedRead(file)
			: await this.adapter.read(record.path);
		const contacts = parseContacts(content);
		this.contactCounts.set(record.path, {
			mtime: record.mtime,
			count: contacts.contacts.length,
		});
		const contactSection = extractContactSection(content);
		let body = stripFrontmatter(content);
		if (contactSection) {
			body = body.replace(contactSection, "").trim();
		}
		const bodyTruncated = body.length > truncateChars;
		const bodyExcerpt = bodyTruncated
			? `${body.slice(0, truncateChars)}\n…（已截断，原文 ${body.length} 字）`
			: body;
		return {
			record,
			content,
			contacts,
			frontmatterText: formatFrontmatter(record.fm),
			contactSection,
			bodyExcerpt,
			bodyTruncated,
		};
	}
}
