import { sanitizeFileName } from "../core/filenames";
import { VaultAdapter } from "./vault-adapter";

export class StateStore {
	constructor(
		private adapter: VaultAdapter,
		private getOutputDir: () => string,
	) {}

	private dir(): string {
		return this.getOutputDir().trim() || ".";
	}

	async saveRun(batchId: string, payload: unknown): Promise<string | null> {
		try {
			return await this.adapter.writeStateJson(
				this.dir(),
				`run-${batchId}.json`,
				payload,
			);
		} catch (error) {
			console.error("[email-outreach] 保存批次状态失败", error);
			return null;
		}
	}

	async saveRaw(
		batchId: string,
		customerName: string,
		kind: string,
		raw: string,
	): Promise<void> {
		try {
			await this.adapter.writeStateFile(
				`${this.dir()}/.state/raw-${batchId}-${sanitizeFileName(customerName)}-${kind}.txt`,
				raw,
			);
		} catch (error) {
			console.error("[email-outreach] 保存原始响应失败", error);
		}
	}
}
