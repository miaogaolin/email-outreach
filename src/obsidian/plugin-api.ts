import type { App } from "obsidian";
import type {
	CustomerAIFile,
	CustomerDevStatus,
	CustomerRecord,
	EmailRow,
	RunStatusFile,
} from "../core/types";
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
	getCustomerDevStatus(path: string): CustomerDevStatus | null;
	getLastRunStatus(): RunStatusFile | null;
	openContacts(record: CustomerRecord): Promise<void>;
	openEmailDetail(key: string): void;
	openEmailList(): void;
	openAIFile(path: string): void;
	openFile(path: string): Promise<void>;
	openWorkbench(): void;
	openBaseStarter(): void;

	buildStarterBase(path: string): Promise<void>;
	runSelfCheck(): Promise<string>;
	refreshEmailList(): Promise<void>;
	getAIFile(path: string): CustomerAIFile | null;
}
