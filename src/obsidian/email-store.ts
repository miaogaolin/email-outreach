import { App } from "obsidian";
import {
	appendEmailToContent,
	parseCustomerAIFile,
	removeEmailsFromContent,
	updateEmailInContent,
} from "../core/ai-file";
import type { RemoveEmailsResult } from "../core/ai-file";
import {
	AI_FILE_SUFFIX,
	customerNameFromAIFile,
} from "../core/filenames";
import { removeEmailReminderFromContent } from "../core/reminder";
import type {
	CustomerAIFile,
	EmailRecord,
	EmailRow,
} from "../core/types";
import type { VaultAdapter } from "./vault-adapter";

export class EmailStore {
	private rows: EmailRow[] = [];
	private files = new Map<string, CustomerAIFile>();

	constructor(
		private app: App,
		private getDir: () => string,
		private adapter: VaultAdapter,
	) {}

	getRows(): EmailRow[] {
		return this.rows;
	}

	findRow(key: string): EmailRow | null {
		return this.rows.find((row) => row.key === key) ?? null;
	}

	getFile(path: string): CustomerAIFile | null {
		return this.files.get(path) ?? null;
	}

	/** 只读快照：生成时间索引等派生计算用，调用方不得修改返回的 file 对象。 */
	listFiles(): Array<{ path: string; file: CustomerAIFile }> {
		return Array.from(this.files, ([path, file]) => ({ path, file }));
	}

	async refresh(): Promise<EmailRow[]> {
		const dir = this.getDir().trim();
		this.rows = [];
		this.files = new Map();
		if (!dir) return [];
		const files = this.adapter
			.listMarkdown(dir)
			.filter(
				(file) =>
					file.basename.endsWith(AI_FILE_SUFFIX) ||
					file.basename.includes(AI_FILE_SUFFIX),
			);
		for (const file of files) {
			let content: string;
			try {
				content = await this.app.vault.cachedRead(file);
			} catch {
				continue;
			}
			const parsed = parseCustomerAIFile(content);
			if (!parsed.file.customerLink && parsed.file.emails.length === 0) {
				continue;
			}
			this.files.set(file.path, parsed.file);
			const customerName =
				parsed.file.customerLink.split("/").pop() ??
				customerNameFromAIFile(file.basename);
			for (const record of parsed.file.emails) {
				this.rows.push({
					key: `${file.path}#${record.id}`,
					filePath: file.path,
					customerName,
					customerLink: parsed.file.customerLink,
					record,
				});
			}
		}
		this.rows.sort((a, b) => {
			if (a.filePath !== b.filePath) {
				return a.filePath.localeCompare(b.filePath, "zh-CN");
			}
			return a.record.id.localeCompare(b.record.id);
		});
		return this.rows;
	}

	async reloadFile(path: string): Promise<CustomerAIFile | null> {
		const file = this.adapter.getFile(path);
		if (!file) return null;
		const content = await this.app.vault.cachedRead(file);
		const parsed = parseCustomerAIFile(content);
		this.files.set(path, parsed.file);
		return parsed.file;
	}

	/**
	 * 保存邮件记录。可选的 transform 在同一份内容上追加/删除验收提醒，
	 * 保证「状态 + 提醒」一次写盘。
	 */
	async saveRecord(
		path: string,
		record: EmailRecord,
		transform?: (content: string) => string,
	): Promise<void> {
		const content = await this.adapter.read(path);
		let updated = updateEmailInContent(content, record);
		if (transform) updated = transform(updated);
		await this.adapter.write(path, updated);
		await this.refresh();
	}

	async appendRecord(
		path: string,
		customerLink: string,
		record: EmailRecord,
	): Promise<void> {
		const content = this.adapter.exists(path)
			? await this.adapter.read(path)
			: null;
		const updated = appendEmailToContent(content, customerLink, record);
		await this.adapter.write(path, updated);
		await this.refresh();
	}

	/**
	 * 永久删除 AI 文件里的邮件块，并在同一次写盘里移除对应发送提醒。
	 * 一个都没命中时不重写文件；找不到的 ID 通过 missing 返回。
	 */
	async removeRecords(
		path: string,
		ids: string[],
	): Promise<RemoveEmailsResult> {
		const content = await this.adapter.read(path);
		const result = removeEmailsFromContent(content, ids);
		if (result.removed.length === 0) return result;
		let updated = result.content;
		for (const id of result.removed) {
			updated = removeEmailReminderFromContent(updated, id);
		}
		await this.adapter.write(path, updated);
		await this.refresh();
		return result;
	}

	rowsForCustomer(customerPath: string): EmailRow[] {
		const name = customerPath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
		return this.rows.filter(
			(row) => row.customerName === name || row.customerLink === name,
		);
	}
}
