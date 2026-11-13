import { isoNow, joinPath, sanitizeFileName } from "../core/filenames";
import { parseRunStatusFile } from "../core/run-status";
import type { DevStatusMap, RunStatusFile } from "../core/types";
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

	/** 保存本次执行的客户开发状态，供工作台/邮件列表显示提醒。 */
	async saveLastRunStatus(customers: DevStatusMap): Promise<void> {
		if (!this.getOutputDir().trim()) return;
		try {
			await this.adapter.writeStateJson(this.dir(), "last-run.json", {
				at: isoNow(),
				customers,
			});
		} catch (error) {
			console.error("[email-outreach] 保存上次执行状态失败", error);
		}
	}

	async loadLastRunStatus(): Promise<RunStatusFile | null> {
		if (!this.getOutputDir().trim()) return null;
		try {
			const raw = await this.adapter.readStateFile(
				joinPath(this.dir(), ".state", "last-run.json"),
			);
			if (!raw) return null;
			return parseRunStatusFile(raw);
		} catch (error) {
			console.error("[email-outreach] 读取上次执行状态失败", error);
			return null;
		}
	}
}
