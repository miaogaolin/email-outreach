import type { App } from "obsidian";
import type { CustomerAIFile, CustomerRecord, EmailRow, TaskSelection } from "../core/types";
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
	getTaskSelection(): TaskSelection;
	setTaskSelection(tasks: TaskSelection): void;

	runTasks(records: CustomerRecord[], tasks: TaskSelection): Promise<void>;
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
