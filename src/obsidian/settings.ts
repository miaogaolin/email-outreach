import type { FilterConfig } from "../core/filters";

export interface ColumnPreference {
	key: string;
	width?: number;
	visible: boolean;
}

export type WorkbenchMode = "bases" | "builtin" | "both";

export interface Settings {
	// AI service
	apiBaseUrl: string;
	apiKey: string;
	model: string;
	/** 上次从 `GET /models` 获取到的模型 id；用于设置页下拉框，空表示还没获取过。 */
	availableModels: string[];
	temperature: number;
	timeoutMs: number;
	concurrency: number;

	// Vault locations
	instructionFile: string;
	customerDir: string;
	outputDir: string;
	feedbackFile: string;

	// Filtering
	excludeTags: string[];
	excludeProgressPrefixes: string[];

	// Writing
	linkPropertyName: string;
	writeCustomerLink: boolean;

	// UI
	workbenchMode: WorkbenchMode;
	builtinColumns: ColumnPreference[] | null;
	builtinFilters: FilterConfig;
	builtinSort: { key: string; dir: 1 | -1 } | null;

	// Prompt budget
	truncateBodyChars: number;
	maxKnowledgeChars: number;
	maxKnowledgeFiles: number;
	knowledgeDepth: number;

	// Session-ish state that must survive restarts
	selectedCustomers: string[];
}

export const DEFAULT_SETTINGS: Settings = {
	apiBaseUrl: "https://api.deepseek.com",
	apiKey: "",
	model: "deepseek-flash",
	availableModels: [],
	temperature: 0.3,
	timeoutMs: 120000,
	concurrency: 2,

	instructionFile: "",
	customerDir: "",
	outputDir: "",
	feedbackFile: "",

	excludeTags: ["公海", "共享"],
	excludeProgressPrefixes: [],

	linkPropertyName: "AI开发信息",
	writeCustomerLink: true,

	workbenchMode: "bases",
	builtinColumns: null,
	builtinFilters: { conditions: [], showExcluded: false },
	builtinSort: null,

	truncateBodyChars: 6000,
	maxKnowledgeChars: 60000,
	maxKnowledgeFiles: 20,
	knowledgeDepth: 2,

	selectedCustomers: [],
};

export interface ConfigProblem {
	key: keyof Settings | "apiKey";
	label: string;
	message: string;
}

export function getConfigProblems(
	settings: Settings,
): ConfigProblem[] {
	const problems: ConfigProblem[] = [];
	if (!settings.instructionFile.trim()) {
		problems.push({
			key: "instructionFile",
			label: "AI 指令文件",
			message: "未设置 AI 主指令 Markdown 文件",
		});
	}
	if (!settings.customerDir.trim()) {
		problems.push({
			key: "customerDir",
			label: "客户目录",
			message: "未设置客户 Markdown 所在目录",
		});
	}
	if (!settings.outputDir.trim()) {
		problems.push({
			key: "outputDir",
			label: "输出目录",
			message: "未设置 AI 开发信息保存目录",
		});
	}
	if (!settings.apiBaseUrl.trim()) {
		problems.push({
			key: "apiBaseUrl",
			label: "API 地址",
			message: "未设置 AI 服务地址",
		});
	}
	if (!settings.model.trim()) {
		problems.push({
			key: "model",
			label: "模型名称",
			message: "未设置模型名称",
		});
	}
	if (!settings.apiKey.trim()) {
		problems.push({
			key: "apiKey",
			label: "API Key",
			message: "未设置 API Key",
		});
	}
	return problems;
}

export function isConfigured(settings: Settings): boolean {
	return getConfigProblems(settings).length === 0;
}
