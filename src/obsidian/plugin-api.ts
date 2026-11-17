import type { App } from "obsidian";
import type {
	CustomerAIFile,
	CustomerDevStatus,
	CustomerRecord,
	EmailRow,
	RunStatusFile,
} from "../core/types";
import type {
	CustomerGeneration,
	GenerationIndex,
} from "../core/generation";
import type { CustomerRepo } from "./customer-repo";
import type { EmailStore } from "./email-store";
import type { Settings } from "./settings";

export interface OutreachPluginApi {
	app: App;
	settings: Settings;
	repo: CustomerRepo;
	emailStore: EmailStore;
	saveSettings(): Promise<void>;

	getSelected(): Set<string>;
	setSelected(paths: Set<string>): void;
	pruneSelection(allowed: Iterable<string>): Set<string>;

	runTasks(records: CustomerRecord[]): Promise<void>;
	/** 是否有生成任务正在执行（运行中禁用生成按钮，防双击）。 */
	isRunning(): boolean;
	getCustomerDevStatus(path: string): CustomerDevStatus | null;
	getLastRunStatus(): RunStatusFile | null;
	openContacts(record: CustomerRecord): Promise<void>;
	openEmailDetail(key: string): void;
	/** 永久删除选中的开发邮件（含修改历史与发送提醒），并刷新列表/工作台。 */
	deleteEmails(rows: EmailRow[]): Promise<void>;
	openEmailList(): void;
	/** 打开邮件列表并筛选到指定客户；aiFilePath 命中时优先用它定位。 */
	openEmailListForCustomer(
		record: CustomerRecord,
		aiFilePath?: string | null,
	): Promise<void>;
	openAIFile(path: string): void;
	openFile(path: string): Promise<void>;
	openWorkbench(): void;
	openBaseStarter(): void;

	buildStarterBase(path: string): Promise<void>;
	runSelfCheck(): Promise<string>;
	refreshEmailList(): Promise<void>;
	getAIFile(path: string): CustomerAIFile | null;
	/**
	 * 按「客户路径 → 最近生成信息」建立索引。
	 * 必须传全量客户（默认 `repo.list()`），否则 basename 唯一性判断会失真。
	 */
	getGenerationIndex(records?: CustomerRecord[]): Map<string, CustomerGeneration>;
	/** 同上，但同时返回无法对应客户的 AI 文件路径，供底部提示使用。 */
	getGenerationReport(records?: CustomerRecord[]): GenerationIndex;
}
