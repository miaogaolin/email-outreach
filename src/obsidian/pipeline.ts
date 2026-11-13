import { findContact } from "../core/contact-parser";
import {
	analysisRecordToResult,
	appendEmailsToContent,
	createEmailRecord,
	parseCustomerAIFile,
} from "../core/ai-file";
import { aiFilePath, isoNow, sanitizeFileName } from "../core/filenames";
import { guessLanguage, languageLabel } from "../core/language";
import {
	buildEmailUserPrompt,
	buildSystemPrompt,
	type KnowledgeBundle,
	type LanguageRequirement,
	type PromptCustomer,
} from "../core/prompt";
import { parseJsonLoose, validateAIResult } from "../core/schema";
import {
	planSendTime,
	sendHistoryFrom,
} from "../core/send-time";
import type {
	AnalysisResult,
	Contact,
	CustomerDevStatus,
	CustomerRecord,
	EmailDraft,
	EmailRecord,
	EmailRunResult,
	RunOutcome,
	RunProgress,
} from "../core/types";
import { MAX_EMAILS_PER_CUSTOMER } from "../core/types";
import {
	AIClient,
	CanceledError,
	type AIRequestMeta,
	type CancelToken,
} from "./ai-client";
import type { CustomerRepo } from "./customer-repo";
import type { Settings } from "./settings";
import type { StateStore } from "./state-store";
import type { VaultAdapter } from "./vault-adapter";

const EMAIL_MAX_CHARS = 8000;

export interface PipelineDeps {
	settings: Settings;
	knowledge: KnowledgeBundle;
	feedbackRules: string;
	adapter: VaultAdapter;
	repo: CustomerRepo;
	client: AIClient;
	state: StateStore;
}

export interface PipelineOptions {
	customers: CustomerRecord[];
	languageOverrides: Map<string, string>;
	token: CancelToken;
	onProgress?: (event: RunProgress) => void;
	onResult?: (result: EmailRunResult) => void;
}

interface RequestOutcome {
	raw: string;
	ok: boolean;
	emails: EmailDraft[];
	noSuitableContactReason: string | null;
	errors: string[];
	warnings: string[];
}

export class Pipeline {
	constructor(private deps: PipelineDeps) {}

	async run(options: PipelineOptions): Promise<RunOutcome> {
		const { customers } = options;
		const batchId = `${Date.now()}`;
		const results: EmailRunResult[] = new Array(customers.length);
		const writtenFiles: string[] = [];
		let completed = 0;
		const concurrency = Math.max(
			1,
			Math.min(5, this.deps.settings.concurrency || 1),
		);
		let nextIndex = 0;

		const worker = async (): Promise<void> => {
			while (true) {
				if (options.token.canceled) return;
				const index = nextIndex++;
				if (index >= customers.length) return;
				const customer = customers[index]!;
				options.onProgress?.({
					index,
					total: customers.length,
					phase: "准备客户资料",
					customerName: customer.name,
				});
				let result: EmailRunResult;
				try {
					result = await this.processCustomer(
						customer,
						options,
						batchId,
					);
				} catch (error) {
					if (error instanceof CanceledError) return;
					result = this.failedResult(customer, error);
				}
				results[index] = result;
				if (result.emailPath) writtenFiles.push(result.emailPath);
				completed++;
				options.onProgress?.({
					index,
					total: customers.length,
					phase: `完成 ${completed}/${customers.length}`,
					customerName: customer.name,
				});
				options.onResult?.(result);
			}
		};

		await Promise.all(
			Array.from(
				{ length: Math.min(concurrency, Math.max(1, customers.length)) },
				() => worker(),
			),
		);

		const ordered = results.filter((item): item is EmailRunResult => Boolean(item));
		await this.deps.state.saveRun(batchId, {
			at: isoNow(),
			results: ordered.map((result) => ({
				customer: result.customer.path,
				status: result.status,
				emails: result.emails.map((email) => email.id),
				errors: result.errors,
				warnings: result.warnings,
				rawEmail: result.rawEmail,
				emailPath: result.emailPath,
			})),
		});

		return {
			results: ordered,
			writtenFiles,
			errors: ordered.flatMap((result) =>
				result.errors.map((message) => `${result.customer.name}: ${message}`),
			),
			canceled: options.token.canceled,
		};
	}

	private failedStatus(
		customer: CustomerRecord,
		message: string,
	): CustomerDevStatus {
		return {
			kind: "failed",
			customerName: customer.name,
			emailCount: 0,
			message,
			at: isoNow(),
		};
	}

	private failedResult(
		customer: CustomerRecord,
		error: unknown,
	): EmailRunResult {
		const message = error instanceof Error ? error.message : String(error);
		return {
			customer,
			contacts: [],
			contactWarnings: [],
			emails: [],
			errors: [message],
			warnings: [],
			rawEmail: null,
			emailPath: null,
			status: this.failedStatus(customer, message),
		};
	}

	private resultWith(
		customer: CustomerRecord,
		contacts: Contact[],
		contactWarnings: EmailRunResult["contactWarnings"],
		emails: EmailRecord[],
		errors: string[],
		warnings: string[],
		rawEmail: string | null,
		emailPath: string | null,
		status: CustomerDevStatus,
	): EmailRunResult {
		return {
			customer,
			contacts,
			contactWarnings,
			emails,
			errors,
			warnings,
			rawEmail,
			emailPath,
			status,
		};
	}

	private async processCustomer(
		customer: CustomerRecord,
		options: PipelineOptions,
		batchId: string,
	): Promise<EmailRunResult> {
		const settings = this.deps.settings;
		const adapter = this.deps.adapter;
		const payload = await this.deps.repo.load(
			customer,
			Math.max(500, settings.truncateBodyChars),
		);
		const contacts = payload.contacts.contacts;
		const warnings = payload.contacts.warnings.map(
			(warning) => `第 ${warning.line} 行：${warning.message}`,
		);
		const errors: string[] = [];

		const emailContacts = contacts.filter(
			(contact) => contact.emails.length > 0,
		);
		if (emailContacts.length === 0) {
			const message =
				contacts.length === 0
					? "没有解析到联系人区段，未调用 AI"
					: "联系人都没有可用邮箱，未调用 AI";
			const status: CustomerDevStatus = {
				kind: "no_contact",
				customerName: customer.name,
				emailCount: 0,
				message,
				at: isoNow(),
			};
			return this.resultWith(
				customer,
				contacts,
				payload.contacts.warnings,
				[],
				errors,
				[...warnings, message],
				null,
				null,
				status,
			);
		}

		const promptCustomer: PromptCustomer = {
			name: customer.name,
			path: customer.path,
			frontmatterText: payload.frontmatterText,
			contactSection: payload.contactSection,
			bodyExcerpt: payload.bodyExcerpt,
			bodyTruncated: payload.bodyTruncated,
		};

		const validationContext = {
			contactIds: new Set(contacts.map((contact) => contact.id)),
			contactEmails: new Map(
				contacts.map((contact) => [contact.id, contact.emails]),
			),
			maxBodyChars: EMAIL_MAX_CHARS,
		};

		const aiPath = aiFilePath(settings.outputDir, customer.name);
		let existingFileContent: string | null = null;
		let existingAnalysis: AnalysisResult | null = null;
		let existingEmails: EmailRecord[] = [];
		if (adapter.exists(aiPath)) {
			try {
				const content = await adapter.read(aiPath);
				const parsed = parseCustomerAIFile(content);
				existingAnalysis = analysisRecordToResult(parsed.file.analysis);
				existingEmails = parsed.file.emails;
				existingFileContent = content;
				warnings.push(...parsed.file.warnings);
			} catch (error) {
				const message = `读取已有 AI 文件失败，未写入：${
					error instanceof Error ? error.message : String(error)
				}`;
				errors.push(message);
				return this.resultWith(
					customer,
					contacts,
					payload.contacts.warnings,
					[],
					errors,
					warnings,
					null,
					null,
					this.failedStatus(customer, message),
				);
			}
		}

		const region = customer.fm["地区"];
		const override = options.languageOverrides.get(customer.path);
		const guess = guessLanguage(region);
		const language: LanguageRequirement | null = override
			? {
					code: override,
					label: languageLabel(override),
					confidence: "high",
					source: "用户指定",
				}
			: guess
				? {
						code: guess.code,
						label: guess.label,
						confidence: guess.confidence,
						source: typeof region === "string" ? `地区：${region}` : "地区推断",
					}
				: null;

		const emailPrompt = buildEmailUserPrompt({
			knowledge: this.deps.knowledge,
			feedbackRules: this.deps.feedbackRules,
			customer: promptCustomer,
			contacts,
			analysis: existingAnalysis,
			language,
			maxEmails: MAX_EMAILS_PER_CUSTOMER,
			focusContactId: null,
			emailHistory: existingEmails,
		});
		const outcome = await this.requestValidated(
			buildSystemPrompt(MAX_EMAILS_PER_CUSTOMER),
			emailPrompt,
			validationContext,
			options.token,
			{
				kind: "email",
				label: `${customer.name} · 生成开发邮件`,
				customerName: customer.name,
				customerPath: customer.path,
			},
		);
		errors.push(...outcome.errors);
		warnings.push(...outcome.warnings);
		if (!outcome.ok) {
			await this.deps.state.saveRaw(
				batchId,
				customer.name,
				"email",
				outcome.raw,
			);
			const message = `AI 返回未通过校验：${outcome.errors
				.map((error) => error)
				.join("；")}`;
			return this.resultWith(
				customer,
				contacts,
				payload.contacts.warnings,
				[],
				errors.length > 0 ? errors : [message],
				warnings,
				outcome.raw,
				null,
				this.failedStatus(customer, message),
			);
		}

		if (outcome.emails.length === 0) {
			const reason =
				outcome.noSuitableContactReason ??
				"AI 未找到适合发送开发邮件的联系人";
			const status: CustomerDevStatus = {
				kind: "no_suitable",
				customerName: customer.name,
				emailCount: 0,
				message: reason,
				at: isoNow(),
			};
			return this.resultWith(
				customer,
				contacts,
				payload.contacts.warnings,
				[],
				errors,
				[...warnings, reason],
				outcome.raw,
				null,
				status,
			);
		}

		const now = new Date();
		const history = sendHistoryFrom(customer.fm, existingEmails);
		const records: EmailRecord[] = [];
		outcome.emails.forEach((draft, index) => {
			const contact = findContact(contacts, draft.contactId);
			if (!contact || contact.emails.length === 0) {
				errors.push(`找不到联系人 ${draft.contactId} 的邮箱，已跳过这封邮件`);
				return;
			}
			const plan = planSendTime({
				region,
				now,
				history,
				sequence: index,
			});
			records.push(
				createEmailRecord({
					contactRaw: contact.raw,
					email: contact.emails[0]!,
					language: draft.language,
					languageLabel: languageLabel(draft.language),
					summaryZh: draft.emailSummaryZh,
					subject: draft.subject,
					body: draft.body,
					suggestedTime: plan.suggestedTime,
					timezone: plan.timezone,
					timeReason: plan.timeReason,
				}),
			);
		});

		if (records.length === 0) {
			const message = "校验通过但没有可落盘的邮件";
			errors.push(message);
			await this.deps.state.saveRaw(
				batchId,
				customer.name,
				"email",
				outcome.raw,
			);
			return this.resultWith(
				customer,
				contacts,
				payload.contacts.warnings,
				[],
				errors,
				warnings,
				outcome.raw,
				null,
				this.failedStatus(customer, message),
			);
		}

		try {
			const content = appendEmailsToContent(
				existingFileContent,
				customer.name,
				records,
			);
			await adapter.write(aiPath, content);
		} catch (error) {
			const message = `写入 AI 文件失败：${
				error instanceof Error ? error.message : String(error)
			}`;
			errors.push(message);
			return this.resultWith(
				customer,
				contacts,
				payload.contacts.warnings,
				[],
				errors,
				warnings,
				outcome.raw,
				null,
				this.failedStatus(customer, message),
			);
		}

		const partial = outcome.warnings.some(
			(warning) =>
				warning.includes("已跳过") || warning.includes("只采用前"),
		);
		const status: CustomerDevStatus = {
			kind: "generated",
			customerName: customer.name,
			emailCount: records.length,
			message: partial
				? `已生成 ${records.length} 封（部分邮件未通过校验）`
				: `已生成 ${records.length} 封`,
			at: isoNow(),
		};
		return this.resultWith(
			customer,
			contacts,
			payload.contacts.warnings,
			records,
			errors,
			warnings,
			outcome.raw,
			aiPath,
			status,
		);
	}

	private async requestValidated(
		system: string,
		prompt: string,
		context: {
			contactIds: Set<string>;
			contactEmails: Map<string, string[]>;
			maxBodyChars: number;
		},
		token: CancelToken,
		meta: AIRequestMeta,
	): Promise<RequestOutcome> {
		const client = this.deps.client;
		let raw = await client.complete(system, prompt, token, meta);
		let validation = validateAIResult(parseJsonLoose(raw), context);
		if (!validation.ok) {
			const detail = validation.errors
				.map((error) => `${error.field}: ${error.message}`)
				.join("；");
			const repairPrompt =
				`${prompt}\n\n## 上一次输出未通过程序校验\n` +
				`错误：${detail}\n` +
				`上次输出（已截断）：\n${raw.slice(0, 4000)}\n\n` +
				"请根据错误修正，仍然只输出完整 JSON。";
			raw = await client.complete(system, repairPrompt, token, {
				...meta,
				kind: "email-repair",
				label: meta.customerName
					? `${meta.customerName} · 校验失败后自动修复`
					: "校验失败后自动修复",
			});
			validation = validateAIResult(parseJsonLoose(raw), context);
		}
		return {
			raw,
			ok: validation.ok,
			emails: validation.emails,
			noSuitableContactReason: validation.noSuitableContactReason,
			errors: validation.errors.map(
				(error) => `${error.field}: ${error.message}`,
			),
			warnings: validation.warnings,
		};
	}
}

export function describeCustomerFile(path: string): string {
	const parts = path.split("/");
	const file = parts[parts.length - 1] ?? path;
	return file.replace(/\.md$/i, "");
}

export function batchFileName(index: number, name: string): string {
	return `${String(index + 1).padStart(2, "0")}-${sanitizeFileName(name)}`;
}
