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

/** AI 产出的邮件草稿；发送时间由程序计算，不由 AI 返回。 */
export interface EmailDraft {
	contactId: string;
	language: string;
	emailSummaryZh: string;
	subject: string;
	body: string;
}

/** 每个客户每次最多生成多少封邮件。 */
export const MAX_EMAILS_PER_CUSTOMER = 5;

export type CustomerDevStatusKind =
	| "generated"
	| "no_contact"
	| "no_suitable"
	| "failed";

/** 上次执行后某个客户的开发结果，用于列表里的提醒。 */
export interface CustomerDevStatus {
	kind: CustomerDevStatusKind;
	customerName: string;
	emailCount: number;
	message: string;
	at: string;
}

export type DevStatusMap = Record<string, CustomerDevStatus>;

export interface RunStatusFile {
	at: string;
	customers: DevStatusMap;
}

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
	/** 本次已落盘的邮件（可能不止一封）。 */
	emails: EmailRecord[];
	errors: string[];
	warnings: string[];
	rawEmail: string | null;
	emailPath: string | null;
	status: CustomerDevStatus;
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
