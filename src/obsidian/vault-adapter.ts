import { App, TFile, TFolder, normalizePath } from "obsidian";
import { joinPath } from "../core/filenames";

export interface FrontmatterRecord {
	[key: string]: unknown;
}

export class VaultAdapter {
	constructor(private app: App) {}

	getFile(path: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return file instanceof TFile ? file : null;
	}

	exists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
	}

	isFolder(path: string): boolean {
		const item = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return item instanceof TFolder;
	}

	async read(path: string): Promise<string> {
		const file = this.getFile(path);
		if (!file) throw new Error(`文件不存在：${path}`);
		return this.app.vault.cachedRead(file);
	}

	async write(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		const existing = this.getFile(normalized);
		if (existing) {
			await this.app.vault.modify(existing, content);
			return;
		}
		const parent = normalized.split("/").slice(0, -1).join("/");
		if (parent) await this.ensureFolder(parent);
		await this.app.vault.create(normalized, content);
	}

	async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path).replace(/\/+$/, "");
		if (!normalized) return;
		if (this.isFolder(normalized)) return;
		const parts = normalized.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (this.isFolder(current)) continue;
			if (this.exists(current)) {
				throw new Error(`路径已被文件占用：${current}`);
			}
			try {
				await this.app.vault.createFolder(current);
			} catch (error) {
				// A concurrent creation is fine; a real failure is not.
				if (!this.isFolder(current)) throw error;
			}
		}
	}

	listMarkdown(dir: string): TFile[] {
		const normalized = normalizePath(dir).replace(/\/+$/, "");
		if (!normalized) return [];
		const prefix = `${normalized}/`;
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path.startsWith(prefix))
			.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
	}

	getFrontmatter(path: string): FrontmatterRecord | null {
		const file = this.getFile(path);
		if (!file) return null;
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) return null;
		const result: FrontmatterRecord = {};
		for (const [key, value] of Object.entries(cache.frontmatter)) {
			if (key === "position") continue;
			result[key] = value;
		}
		return result;
	}

	async updateFrontmatter(
		path: string,
		mutate: (frontmatter: FrontmatterRecord) => void,
	): Promise<void> {
		const file = this.getFile(path);
		if (!file) throw new Error(`文件不存在：${path}`);
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const record = frontmatter as FrontmatterRecord;
			delete record.position;
			mutate(record);
		});
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		const file = this.getFile(oldPath);
		if (!file) throw new Error(`文件不存在：${oldPath}`);
		await this.app.fileManager.renameFile(file, normalizePath(newPath));
	}

	async openFile(path: string): Promise<void> {
		const file = this.getFile(path);
		if (!file) throw new Error(`文件不存在：${path}`);
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	async writeStateFile(relativePath: string, content: string): Promise<string> {
		const path = normalizePath(relativePath);
		const adapter = this.app.vault.adapter;
		const dir = path.split("/").slice(0, -1).join("/");
		if (dir) {
			try {
				await adapter.mkdir(dir);
			} catch {
				// already exists
			}
		}
		await adapter.write(path, content);
		return path;
	}

	async readStateFile(relativePath: string): Promise<string | null> {
		const path = normalizePath(relativePath);
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(path))) return null;
		return adapter.read(path);
	}

	/** 追加一段文本；文件不存在时创建。用于逐条写入 AI 请求日志。 */
	async appendStateFile(relativePath: string, content: string): Promise<string> {
		const path = normalizePath(relativePath);
		const adapter = this.app.vault.adapter;
		const dir = path.split("/").slice(0, -1).join("/");
		if (dir) {
			try {
				await adapter.mkdir(dir);
			} catch {
				// already exists
			}
		}
		if (await adapter.exists(path)) {
			await adapter.append(path, content);
		} else {
			await adapter.write(path, content);
		}
		return path;
	}

	async deleteStateFile(relativePath: string): Promise<void> {
		const path = normalizePath(relativePath);
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(path)) await adapter.remove(path);
	}

	async writeStateJson(dir: string, fileName: string, data: unknown): Promise<string> {
		return this.writeStateFile(
			joinPath(dir, ".state", fileName),
			JSON.stringify(data, null, 2),
		);
	}
}
