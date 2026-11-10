import { findContact } from "../core/contact-parser";
import {
	analysisRecordToResult,
	appendEmailToContent,
	createEmailRecord,
	parseCustomerAIFile,
} from "../core/ai-file";
import {
	aiFilePath,
	isoNow,
	sanitizeFileName,
} from "../core/filenames";
import { guessLanguage, languageLabel } from "../core/language";
import {
	buildAnalysisUserPrompt,
	buildEmailUserPrompt,
	buildSystemPrompt,
	type KnowledgeBundle,
	type LanguageRequirement,
	type PromptCustomer,
} from "../core/prompt";
import { parseJsonLoose, validateAIResult } from "../core/schema";
import type {
	AnalysisResult,
	CustomerRecord,
	EmailDraft,
	EmailRunResult,
	RunOutcome,
	RunProgress,
	TaskSelection,
} from "../core/types";
import { hasAnalysisTask } from "../core/types";
import { AIClient, CanceledError, type CancelToken } from "./ai-client";
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
	tasks: TaskSelection;
	languageOverrides: Map<string, string>;
	token: CancelToken;
	onProgress?: (event: RunProgress) => void;
	onResult?: (result: EmailRunResult) => void;
}

interface RequestOutcome {
	raw: string;
	ok: boolean;
	analysis: AnalysisResult | null;
	email: EmailDraft | null;
	errors: string[];
	warnings: string[];
}

export class Pipeline {
	constructor(private deps: PipelineDeps) {}

	async run(options: PipelineOptions): Promise<RunOutcome> {
		const { customers, tasks } = options;
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
						tasks,
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
			tasks,
			results: ordered.map((result) => ({
				customer: result.customer.path,
				errors: result.errors,
				warnings: result.warnings,
				rawAnalysis: result.rawAnalysis,
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

	private failedResult(
		customer: CustomerRecord,
		error: unknown,
	): EmailRunResult {
		return {
			customer,
			contacts: [],
			contactWarnings: [],
			analysis: null,
			email: null,
			errors: [error instanceof Error ? error.message : String(error)],
			warnings: [],
			rawAnalysis: null,
			rawEmail: null,
			emailPath: null,
		};
	}

	private async processCustomer(
		customer: CustomerRecord,
		tasks: TaskSelection,
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
		if (adapter.exists(aiPath)) {
			try {
				existingFileContent = await adapter.read(aiPath);
				const parsed = parseCustomerAIFile(existingFileContent);
				existingAnalysis = analysisRecordToResult(parsed.file.analysis);
				warnings.push(...parsed.file.warnings);
			} catch (error) {
				warnings.push(
					`读取已有 AI 文件失败：${error instanceof Error ? error.message : String(error)}`,
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

		const system = buildSystemPrompt();
		let analysis: AnalysisResult | null = null;
		let rawAnalysis: string | null = null;

		if (hasAnalysisTask(tasks)) {
			const analysisPrompt = buildAnalysisUserPrompt({
				knowledge: this.deps.knowledge,
				feedbackRules: this.deps.feedbackRules,
				customer: promptCustomer,
				contacts,
				tasks: {
					...tasks,
					email: false,
					sendTime: false,
				},
				existingAnalysis,
				regionLanguage: language,
			});
			const outcome = await this.requestValidated(
				system,
				analysisPrompt,
				validationContext,
				"analysis",
				options.token,
			);
			rawAnalysis = outcome.raw;
			analysis = outcome.analysis;
			errors.push(...outcome.errors);
			warnings.push(...outcome.warnings);
			if (!outcome.ok) {
				await this.deps.state.saveRaw(
					batchId,
					customer.name,
					"analysis",
					outcome.raw,
				);
			}
		}

		let email: EmailDraft | null = null;
		let rawEmail: string | null = null;
		let emailPath: string | null = null;

		if (tasks.email) {
			const emailPrompt = buildEmailUserPrompt({
				knowledge: this.deps.knowledge,
				feedbackRules: this.deps.feedbackRules,
				customer: promptCustomer,
				contacts,
				analysis: analysis ?? existingAnalysis,
				language,
				sendTimeRequested: tasks.sendTime,
			});
			const outcome = await this.requestValidated(
				system,
				emailPrompt,
				validationContext,
				"email",
				options.token,
			);
			rawEmail = outcome.raw;
			email = outcome.email;
			errors.push(...outcome.errors);
			warnings.push(...outcome.warnings);
			if (!outcome.ok || !outcome.email) {
				await this.deps.state.saveRaw(
					batchId,
					customer.name,
					"email",
					outcome.raw,
				);
			} else {
				const contact = findContact(contacts, outcome.email.contactId);
				if (!contact || contact.emails.length === 0) {
					errors.push("校验通过但找不到对应联系人邮箱");
				} else {
					const record = createEmailRecord({
						contactRaw: contact.raw,
						email: contact.emails[0]!,
						language: outcome.email.language,
						languageLabel: languageLabel(outcome.email.language),
						summaryZh: outcome.email.emailSummaryZh,
						subject: outcome.email.subject,
						body: outcome.email.body,
						suggestedTime: outcome.email.suggestedSendTime,
						timezone: outcome.email.timezone,
						timeReason: outcome.email.timeReason,
					});
					try {
						const content = appendEmailToContent(
							existingFileContent,
							customer.name,
							record,
						);
						await adapter.write(aiPath, content);
						existingFileContent = content;
						emailPath = aiPath;
					} catch (error) {
						errors.push(
							`写入 AI 文件失败：${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}
			}
		}

		return {
			customer,
			contacts,
			contactWarnings: payload.contacts.warnings,
			analysis,
			email,
			errors,
			warnings,
			rawAnalysis,
			rawEmail,
			emailPath,
		};
	}

	private async requestValidated(
		system: string,
		prompt: string,
		context: {
			contactIds: Set<string>;
			contactEmails: Map<string, string[]>;
			maxBodyChars: number;
		},
		mode: "analysis" | "email",
		token: CancelToken,
	): Promise<RequestOutcome> {
		const client = this.deps.client;
		let raw = await client.complete(system, prompt, token);
		let validation = validateAIResult(
			parseJsonLoose(raw),
			context,
			mode,
		);
		if (!validation.ok) {
			const detail = validation.errors
				.map((error) => `${error.field}: ${error.message}`)
				.join("；");
			const repairPrompt =
				`${prompt}\n\n## 上一次输出未通过程序校验\n` +
				`错误：${detail}\n` +
				`上次输出（已截断）：\n${raw.slice(0, 4000)}\n\n` +
				"请根据错误修正，仍然只输出完整 JSON。";
			raw = await client.complete(system, repairPrompt, token);
			validation = validateAIResult(
				parseJsonLoose(raw),
				context,
				mode,
			);
		}
		return {
			raw,
			ok: validation.ok,
			analysis: validation.analysis,
			email: validation.email,
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
