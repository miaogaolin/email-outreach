export type EmailStatus = "Generated" | "Revision" | "Accepted" | "Rejected";

export const EMAIL_STATUSES: EmailStatus[] = [
	"Generated",
	"Revision",
	"Accepted",
	"Rejected",
];

export interface Contact {
	/** Stable id inside one customer: C1, C2, ... */
	id: string;
	/** Original first-level list text, kept verbatim. */
	raw: string;
	/** Display name: text before parentheses, or the whole raw text. */
	name: string;
	/** Role/title if it could be separated from the name. */
	role: string | null;
	emails: string[];
	phones: string[];
	links: string[];
	notes: string[];
	/** 1-based line number of the contact line in the customer file. */
	line: number;
}

export interface ParseWarning {
	line: number;
	message: string;
	text: string;
}

export interface ContactParseResult {
	headingFound: boolean;
	headingLine: number | null;
	contacts: Contact[];
	warnings: ParseWarning[];
}

export interface LanguageSuggestion {
	code: string;
	label: string;
	reason: string;
	confidence: "high" | "medium" | "low" | "unknown";
}

export interface ContactPriority {
	contactId: string;
	rank: number;
	reason: string;
}

export interface AnalysisResult {
	customerType: string | null;
	fit: number | null;
	intent: number | null;
	potential: number | null;
	risk: number | null;
	riskNotes: string[];
	unknownFields: string[];
	analysisNotes: string;
	contactPriority: ContactPriority[];
	recommendedContactId: string | null;
	languageSuggestion: LanguageSuggestion | null;
}

export interface EmailDraft {
	contactId: string;
	language: string;
	emailSummaryZh: string;
	subject: string;
	body: string;
	suggestedSendTime: string | null;
	timezone: string | null;
	timeReason: string | null;
}

export interface AIResult {
	analysis: AnalysisResult | null;
	email: EmailDraft | null;
}

export interface TaskSelection {
	customerType: boolean;
	opportunity: boolean;
	risk: boolean;
	contactRecommendation: boolean;
	email: boolean;
	sendTime: boolean;
}

export const NO_TASKS: TaskSelection = {
	customerType: false,
	opportunity: false,
	risk: false,
	contactRecommendation: false,
	email: false,
	sendTime: false,
};

export const ALL_TASKS: TaskSelection = {
	customerType: true,
	opportunity: true,
	risk: true,
	contactRecommendation: true,
	email: true,
	sendTime: true,
};

export function cloneTasks(tasks: TaskSelection): TaskSelection {
	return { ...tasks };
}

/** True when at least one analysis-side task is selected. */
export function hasAnalysisTask(tasks: TaskSelection): boolean {
	return (
		tasks.customerType ||
		tasks.opportunity ||
		tasks.risk ||
		tasks.contactRecommendation
	);
}

/** The task list the AI is actually asked to perform, with dependencies added. */
export function effectiveTasks(tasks: TaskSelection): TaskSelection {
	const result = cloneTasks(tasks);
	if (result.email) {
		result.contactRecommendation = true;
	}
	if (result.sendTime && !result.email) {
		result.sendTime = false;
	}
	return result;
}

export function anyTask(tasks: TaskSelection): boolean {
	return (
		tasks.customerType ||
		tasks.opportunity ||
		tasks.risk ||
		tasks.contactRecommendation ||
		tasks.email ||
		tasks.sendTime
	);
}

/**
 * Whether a separate analysis request is needed.
 *
 * When only an email is requested, the email request already selects the
 * recipient, so a second analysis call would be wasted tokens.
 */
export function needsAnalysisRequest(tasks: TaskSelection): boolean {
	return (
		tasks.customerType ||
		tasks.opportunity ||
		tasks.risk ||
		(tasks.contactRecommendation && !tasks.email)
	);
}

export const TASK_LABELS: Record<keyof TaskSelection, string> = {
	customerType: "分析 Customer Type",
	opportunity: "评估 Opportunity（Fit / Intent / Potential）",
	risk: "识别客户风险（Risk）",
	contactRecommendation: "推荐优先联系的联系人",
	email: "生成开发邮件",
	sendTime: "推荐邮件发送时间及理由",
};

export interface CustomerRecord {
	path: string;
	/** File basename without extension. */
	name: string;
	fm: Record<string, unknown>;
	tags: string[];
	mtime: number;
}

export interface EmailRunResult {
	customer: CustomerRecord;
	contacts: Contact[];
	contactWarnings: ParseWarning[];
	analysis: AnalysisResult | null;
	email: EmailDraft | null;
	errors: string[];
	warnings: string[];
	rawAnalysis: string | null;
	rawEmail: string | null;
	emailPath: string | null;
}

export interface RunProgress {
	index: number;
	total: number;
	phase: string;
	customerName: string;
}

export interface RunOutcome {
	results: EmailRunResult[];
	writtenFiles: string[];
	errors: string[];
	canceled: boolean;
}

export interface EmailRecord {
	id: string;
	contact: string;
	email: string;
	language: string;
	languageLabel: string;
	summaryZh: string;
	suggestedTime: string | null;
	timezone: string | null;
	timeReason: string | null;
	status: EmailStatus;
	generatedAt: string;
	updatedAt: string;
	sent: boolean;
	sentAt: string | null;
	subject: string;
	body: string;
	versions: EmailVersion[];
	extraMeta: Record<string, string>;
}

export interface EmailVersion {
	version: number;
	at: string;
	action: string;
	userComment: string;
	subject: string;
	body: string;
}

export interface AnalysisRecord {
	customerType: string | null;
	fit: number | null;
	intent: number | null;
	potential: number | null;
	risk: number | null;
	riskNotes: string[];
	unknownFields: string[];
	notes: string;
}

export interface CustomerAIFile {
	customerLink: string;
	updated: string;
	emailCount: number;
	lastStatus: string;
	analysis: AnalysisRecord | null;
	analysisHistory: string[];
	emails: EmailRecord[];
	extraFrontmatter: Record<string, string>;
	trailing: string;
	warnings: string[];
}

export interface EmailRow {
	/** `${filePath}#${emailId}` */
	key: string;
	filePath: string;
	customerName: string;
	customerLink: string;
	record: EmailRecord;
}
