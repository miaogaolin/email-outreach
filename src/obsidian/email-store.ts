import { App } from "obsidian";
import {
	appendEmailToContent,
	parseCustomerAIFile,
	updateEmailInContent,
} from "../core/ai-file";
import {
	AI_FILE_SUFFIX,
	customerNameFromAIFile,
} from "../core/filenames";
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

	async saveRecord(path: string, record: EmailRecord): Promise<void> {
		const content = await this.adapter.read(path);
		const updated = updateEmailInContent(content, record);
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

	rowsForCustomer(customerPath: string): EmailRow[] {
		const name = customerPath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
		return this.rows.filter(
			(row) => row.customerName === name || row.customerLink === name,
		);
	}
}
