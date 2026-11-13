import {
	AI_LOG_FILE_NAME,
	AI_LOG_MAX_ENTRIES,
	AI_LOG_STATE_DIR,
	parseAILogLines,
	serializeAILogEntry,
	trimAILog,
	type AILogEntry,
} from "../core/ai-log";
import { joinPath } from "../core/filenames";
import type { VaultAdapter } from "./vault-adapter";

/**
 * AI 请求日志的存取层。
 *
 * - 内存里保留最近 {@link AI_LOG_MAX_ENTRIES} 条，设置页直接读内存。
 * - 同时逐条追加到 `{输出目录}/.state/ai-log.jsonl`，重载插件后仍能看到；
 *   文件里的旧记录在首次读取时会被裁剪到上限以内。
 * - 未配置输出目录时只保留内存，日志不会写到 vault 里。
 * - 任何读写失败都只打控制台，绝不影响邮件生成。
 */
export class AILogStore {
	/** 按时间从旧到新排列。 */
	private entries: AILogEntry[] = [];
	private loaded = false;
	private loading: Promise<void> | null = null;
	private queue: Promise<void> = Promise.resolve();
	private writesSinceRewrite = 0;

	constructor(
		private adapter: VaultAdapter,
		private getOutputDir: () => string,
	) {}

	private filePath(): string | null {
		const dir = this.getOutputDir().trim();
		if (!dir) return null;
		return joinPath(dir, AI_LOG_STATE_DIR, AI_LOG_FILE_NAME);
	}

	/** 最新在前，供设置页列表使用。 */
	list(): AILogEntry[] {
		return [...this.entries].reverse();
	}

	/** 首次调用时从磁盘读入；之后的调用直接复用内存。 */
	async load(): Promise<void> {
		if (this.loaded) return;
		if (!this.loading) {
			this.loading = this.readFromDisk().finally(() => {
				this.loading = null;
			});
		}
		await this.loading;
	}

	private async readFromDisk(): Promise<void> {
		const path = this.filePath();
		let parsed: AILogEntry[] = [];
		if (path) {
			try {
				const raw = await this.adapter.readStateFile(path);
				if (raw) parsed = parseAILogLines(raw);
			} catch (error) {
				console.error("[email-outreach] 读取 AI 日志失败", error);
			}
		}
		// 同一条记录可能既在内存里又在文件里（本轮写过、之后才第一次打开设置页），
		// 用 id 去重后再按时间裁剪。
		const merged = new Map<string, AILogEntry>();
		for (const entry of parsed) merged.set(entry.id, entry);
		for (const entry of this.entries) merged.set(entry.id, entry);
		const all = [...merged.values()];
		this.entries = trimAILog(all);
		this.loaded = true;
		if (path && all.length > this.entries.length) {
			await this.rewrite(path);
		}
	}

	async append(entry: AILogEntry): Promise<void> {
		await this.load();
		this.entries = trimAILog([...this.entries, entry]);
		const path = this.filePath();
		if (!path) return;
		this.queue = this.queue.then(() => this.writeEntry(path, entry));
		await this.queue;
	}

	private async writeEntry(path: string, entry: AILogEntry): Promise<void> {
		try {
			this.writesSinceRewrite++;
			if (this.writesSinceRewrite >= AI_LOG_MAX_ENTRIES) {
				this.writesSinceRewrite = 0;
				await this.rewrite(path);
				return;
			}
			await this.adapter.appendStateFile(
				path,
				`${serializeAILogEntry(entry)}\n`,
			);
		} catch (error) {
			console.error("[email-outreach] 写入 AI 日志失败", error);
		}
	}

	private async rewrite(path: string): Promise<void> {
		try {
			const content = this.entries
				.map((entry) => `${serializeAILogEntry(entry)}\n`)
				.join("");
			await this.adapter.writeStateFile(path, content);
		} catch (error) {
			console.error("[email-outreach] 重写 AI 日志失败", error);
		}
	}

	async clear(): Promise<void> {
		this.entries = [];
		this.loaded = true;
		this.writesSinceRewrite = 0;
		const path = this.filePath();
		if (!path) return;
		this.queue = this.queue.then(async () => {
			try {
				await this.adapter.deleteStateFile(path);
			} catch (error) {
				console.error("[email-outreach] 清除 AI 日志失败", error);
			}
		});
		await this.queue;
	}
}
