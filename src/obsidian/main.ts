import {
	Notice,
	Plugin,
	TFile,
	type WorkspaceLeaf,
} from "obsidian";
import {
	analysisRecordToResult,
	addEmailVersion,
	emptyCustomerAIFile,
	nextEmailId,
	parseCustomerAIFile,
	renderCustomerAIFile,
	setEmailStatus,
	updateAnalysisInContent,
	updateEmailInContent,
} from "../core/ai-file";
import { findContact, parseContacts } from "../core/contact-parser";
import {
	collectPropertyKeys,
	isExcluded,
} from "../core/filters";
import {
	aiFileName,
	aiFilePath,
	feedbackFilePath,
	isoNow,
	localStamp,
	normalizeDir,
	shortStamp,
} from "../core/filenames";
import { guessLanguage, languageLabel } from "../core/language";
import {
	buildEmailUserPrompt,
	buildRuleSystemPrompt,
	buildRuleUserPrompt,
	buildSystemPrompt,
	parseRuleDraft,
	type KnowledgeBundle,
	type LanguageRequirement,
	type PromptCustomer,
	type RuleDraft,
} from "../core/prompt";
import { parseJsonLoose, validateAIResult } from "../core/schema";
import { selectedPatch, nextFollowUpCount, buildCandidates } from "../core/merge";
import type {
	AnalysisRecord,
	AnalysisResult,
	CustomerAIFile,
	CustomerRecord,
	EmailRow,
	RunOutcome,
	TaskSelection,
} from "../core/types";
import {
	ALL_TASKS,
	cloneTasks,
	effectiveTasks,
	hasAnalysisTask,
	TASK_LABELS,
} from "../core/types";
import {
	parseSingleWikilink,
	toWikilink,
} from "../core/wikilinks";
import { AIClient, CanceledError } from "./ai-client";
import { registerBasesView, BASES_VIEW_TYPE } from "./bases-view";
import { CustomerRepo } from "./customer-repo";
import { EmailStore } from "./email-store";
import { EmailListView } from "./email-list-view";
import { KnowledgeLoader } from "./knowledge-loader";
import type { OutreachPluginApi } from "./plugin-api";
import { Pipeline } from "./pipeline";
import {
	DEFAULT_SETTINGS,
	getConfigProblems,
	type Settings,
} from "./settings";
import { EmailOutreachSettingTab, type SettingsHost } from "./settings-tab";
import { StateStore } from "./state-store";
import { VaultAdapter } from "./vault-adapter";
import { WorkbenchView } from "./workbench-view";
import { AnalysisReviewModal, type AnalysisPlan } from "./modals/analysis-review";
import { BaseStarterModal } from "./modals/base-starter";
import { ColumnsModal } from "./modals/columns";
import { confirm, ProgressModal } from "./modals/confirm";
import { ContactModal } from "./modals/contacts";
import { EmailDetailModal, type EmailDetailHost } from "./modals/email-detail";
import { LanguageModal } from "./modals/language";
import { RuleModal } from "./modals/rule";
import { SelfCheckModal } from "./modals/self-check";

const WORKBENCH_VIEW_TYPE = "email-outreach-workbench";
const EMAIL_LIST_VIEW_TYPE = "email-outreach-emails";
const SECRET_KEY = "email-outreach-api-key";
const FEEDBACK_HEADER = [
	"# 开发邮件经验规则",
	"",
	"> 由 Email Outreach 插件维护。每条规则都经过人工确认，生成邮件时会自动参考。",
	"",
].join("\n");

type SecretStorageLike = {
	getSecret(key: string): string | null;
	setSecret(key: string, value: string): void;
	deleteSecret?(key: string): void;
};

export default class EmailOutreachPlugin
	extends Plugin
	implements OutreachPluginApi, SettingsHost, EmailDetailHost
{
	settings!: Settings;
	repo!: CustomerRepo;
	emailStore!: EmailStore;
	adapter!: VaultAdapter;
	client!: AIClient;
	knowledgeLoader!: KnowledgeLoader;
	state!: StateStore;
	basesAvailable = false;

	private selected = new Set<string>();
	private saveChain: Promise<void> = Promise.resolve();
	private refreshTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.initializeServices();

		this.registerView(WORKBENCH_VIEW_TYPE, (leaf: WorkspaceLeaf) =>
			new WorkbenchView(leaf, this),
		);
		this.registerView(EMAIL_LIST_VIEW_TYPE, (leaf: WorkspaceLeaf) =>
			new EmailListView(leaf, this),
		);

		this.addRibbonIcon("mail", "Email Outreach：客户开发工作台", () => {
			void this.openWorkbench();
		});

		this.addCommand({
			id: "open-workbench",
			name: "打开客户开发工作台",
			callback: () => void this.openWorkbench(),
		});
		this.addCommand({
			id: "open-email-list",
			name: "打开开发邮件列表",
			callback: () => void this.openEmailList(),
		});
		this.addCommand({
			id: "run-self-check",
			name: "运行自检",
			callback: () => void this.runSelfCheck().then((report) => {
				new SelfCheckModal(this.app, report).open();
			}),
		});
		this.addCommand({
			id: "generate-starter-base",
			name: "生成示例 Base 文件",
			callback: () => this.openBaseStarter(),
		});
		this.addCommand({
			id: "reload-views",
			name: "刷新视图",
			callback: () => {
				void this.refreshEmailList();
				this.refreshWorkbenchViews();
			},
		});

		this.addSettingTab(new EmailOutreachSettingTab(this.app, this));

		this.registerEvents();
		await this.loadViewsOnce();

		if (this.settings.workbenchMode !== "builtin") {
			this.basesAvailable = registerBasesView(this);
			if (!this.basesAvailable) {
				new Notice(
					"未检测到 Obsidian Bases 自定义视图 API（需要 1.10+）。可以继续使用内置工作台。",
					8000,
				);
			}
		}
	}

	onunload(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
	}

	private async loadViewsOnce(): Promise<void> {
		try {
			await this.emailStore.refresh();
		} catch (error) {
			console.error("[email-outreach] 初始加载邮件失败", error);
		}
	}

	private initializeServices(): void {
		this.adapter = new VaultAdapter(this.app);
		this.repo = new CustomerRepo(
			this.app,
			() => this.settings.customerDir,
			this.adapter,
		);
		this.client = new AIClient(() => this.settings);
		this.knowledgeLoader = new KnowledgeLoader(
			this.app,
			() => this.settings,
		);
		this.state = new StateStore(this.adapter, () => this.settings.outputDir);
		this.emailStore = new EmailStore(
			this.app,
			() => this.settings.outputDir,
			this.adapter,
		);
	}

	private registerEvents(): void {
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (this.isInside(file.path, this.settings.customerDir)) {
					this.repo.invalidate();
					this.scheduleWorkbenchRefresh();
				}
				if (this.isInside(file.path, this.settings.outputDir)) {
					this.scheduleEmailRefresh();
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.isInside(file.path, this.settings.outputDir)) {
					this.scheduleEmailRefresh();
				}
				if (this.isInside(file.path, this.settings.customerDir)) {
					this.repo.invalidate();
					this.scheduleWorkbenchRefresh();
				}
			}),
		);
	}

	private isInside(path: string, dir: string): boolean {
		const normalized = normalizeDir(dir);
		if (!normalized) return false;
		return path === normalized || path.startsWith(`${normalized}/`);
	}

	private scheduleEmailRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			void this.refreshEmailList();
		}, 600);
	}

	private scheduleWorkbenchRefresh(): void {
		window.setTimeout(() => this.refreshWorkbenchViews(), 600);
	}

	// ---------------------------------------------------------------- settings

	private async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<Settings> | null;
		const merged = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
		merged.builtinFilters = {
			conditions: [],
			showExcluded: false,
			...(stored?.builtinFilters ?? {}),
		};
		merged.lastTasks = {
			...DEFAULT_SETTINGS.lastTasks,
			...(stored?.lastTasks ?? {}),
		};
		if (!Array.isArray(merged.excludeTags)) {
			merged.excludeTags = [...DEFAULT_SETTINGS.excludeTags];
		}
		if (!Array.isArray(merged.excludeProgressPrefixes)) {
			merged.excludeProgressPrefixes = [];
		}
		if (!Array.isArray(merged.selectedCustomers)) merged.selectedCustomers = [];
		this.settings = merged;

		const secret = this.secretStorage();
		if (secret) {
			try {
				const key = secret.getSecret(SECRET_KEY);
				if (key) this.settings.apiKey = key;
			} catch (error) {
				console.error("[email-outreach] 读取 secretStorage 失败", error);
			}
		}
		this.selected = new Set(this.settings.selectedCustomers);
	}

	private secretStorage(): SecretStorageLike | null {
		const storage = (this.app as unknown as { secretStorage?: SecretStorageLike })
			.secretStorage;
		if (
			storage &&
			typeof storage.getSecret === "function" &&
			typeof storage.setSecret === "function"
		) {
			return storage;
		}
		return null;
	}

	async saveSettings(): Promise<void> {
		this.saveChain = this.saveChain.then(async () => {
			const payload: Record<string, unknown> = { ...this.settings };
			const secret = this.secretStorage();
			if (secret) {
				try {
					if (this.settings.apiKey) {
						secret.setSecret(SECRET_KEY, this.settings.apiKey);
					} else if (secret.deleteSecret) {
						secret.deleteSecret(SECRET_KEY);
					}
					payload.apiKey = "";
				} catch (error) {
					console.error("[email-outreach] 写入 secretStorage 失败", error);
				}
			}
			await this.saveData(payload);
		});
		await this.saveChain;
	}

	async clearApiKey(): Promise<void> {
		this.settings.apiKey = "";
		const secret = this.secretStorage();
		if (secret?.deleteSecret) {
			try {
				secret.deleteSecret(SECRET_KEY);
			} catch {
				// ignore
			}
		}
		await this.saveSettings();
	}

	// --------------------------------------------------------------- selection

	getSelected(): Set<string> {
		return this.selected;
	}

	setSelected(paths: Set<string>): void {
		this.selected = new Set(paths);
		this.settings.selectedCustomers = Array.from(this.selected);
		void this.saveSettings();
	}

	getTaskSelection(): TaskSelection {
		return cloneTasks(this.settings.lastTasks ?? ALL_TASKS);
	}

	setTaskSelection(tasks: TaskSelection): void {
		this.settings.lastTasks = cloneTasks(tasks);
		void this.saveSettings();
	}

	clearSelection(): void {
		this.selected = new Set();
		this.settings.selectedCustomers = [];
		void this.saveSettings();
		this.refreshWorkbenchViews();
	}

	refreshWorkbenchViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof WorkbenchView) view.refresh();
		}
	}

	// ------------------------------------------------------------------- views

	async openWorkbench(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)[0];
		const leaf = existing ?? this.app.workspace.getLeaf("tab");
		if (!existing) {
			await leaf.setViewState({ type: WORKBENCH_VIEW_TYPE, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	async openEmailList(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(EMAIL_LIST_VIEW_TYPE)[0];
		const leaf = existing ?? this.app.workspace.getLeaf("tab");
		if (!existing) {
			await leaf.setViewState({ type: EMAIL_LIST_VIEW_TYPE, active: true });
		} else if (leaf.view instanceof EmailListView) {
			await leaf.view.refresh();
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	async refreshEmailList(): Promise<void> {
		try {
			await this.emailStore.refresh();
		} catch (error) {
			console.error("[email-outreach] 刷新邮件失败", error);
		}
		for (const leaf of this.app.workspace.getLeavesOfType(EMAIL_LIST_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof EmailListView) await view.refresh();
		}
	}

	async openFile(path: string): Promise<void> {
		try {
			await this.adapter.openFile(path);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : String(error));
		}
	}

	openAIFile(path: string): void {
		void this.openFile(path);
	}

	getAIFile(path: string): CustomerAIFile | null {
		return this.emailStore.getFile(path);
	}

	getRow(key: string): EmailRow | null {
		return this.emailStore.findRow(key);
	}

	async refreshEmails(): Promise<void> {
		await this.refreshEmailList();
	}

	async openContacts(record: CustomerRecord): Promise<void> {
		try {
			const payload = await this.repo.load(
				record,
				Math.max(500, this.settings.truncateBodyChars),
			);
			new ContactModal(this.app, record, payload.contacts, () => {
				void this.openFile(record.path);
			}).open();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : String(error));
		}
	}

	openEmailDetail(key: string): void {
		const row = this.emailStore.findRow(key);
		if (!row) {
			void this.refreshEmailList().then(() => {
				const refreshed = this.emailStore.findRow(key);
				if (!refreshed) {
					new Notice("找不到这封邮件，可能文件已被删除");
					return;
				}
				new EmailDetailModal(this.app, refreshed, this).open();
			});
			return;
		}
		new EmailDetailModal(this.app, row, this).open();
	}

	openBaseStarter(): void {
		const dir = normalizeDir(this.settings.customerDir);
		const suggested = dir
			? `${dir.split("/").slice(0, -1).join("/")}/客户开发.base`
			: "客户开发.base";
		new BaseStarterModal(this.app, suggested, (path) =>
			this.buildStarterBase(path),
		).open();
	}

	async buildStarterBase(path: string): Promise<void> {
		const customerDir = normalizeDir(this.settings.customerDir);
		if (!customerDir) {
			throw new Error("请先在设置里填写客户目录");
		}
		const normalized = path.replace(/\\/g, "/").replace(/\.base$/i, "") + ".base";
		const excluded = (this.settings.excludeTags ?? []).filter(Boolean);
		const excludeLine =
			excluded.length > 0
				? `    - '!file.tags.containsAny(${excluded.map((tag) => `"${tag}"`).join(", ")})'\n`
				: "";
		const content =
			"filters:\n" +
			"  and:\n" +
			`    - file.folder == "${customerDir}"\n` +
			excludeLine +
			"views:\n" +
			`  - type: ${BASES_VIEW_TYPE}\n` +
			"    name: Email Outreach 客户工作台\n" +
			"    order:\n" +
			"      - file.name\n" +
			"      - 客户类型\n" +
			"      - 地区\n" +
			"      - fit\n" +
			"      - indent\n" +
			"      - potential\n" +
			"      - risk\n" +
			"      - 跟进次数\n" +
			"      - 最近联系时间\n" +
			"    sort:\n" +
			"      - property: fit\n" +
			"        direction: DESC\n";
		await this.adapter.write(normalized, content);
		new Notice(`已生成 ${normalized}`);
	}

	// -------------------------------------------------------------------- run

	async runTasks(
		records: CustomerRecord[],
		tasks: TaskSelection,
	): Promise<void> {
		const problems = getConfigProblems(this.settings);
		if (problems.length > 0) {
			new Notice(
				"配置不完整，无法执行：\n" +
					problems.map((problem) => `· ${problem.label}：${problem.message}`).join("\n"),
				9000,
			);
			return;
		}
		const chosen = records.filter((record) => this.selected.has(record.path));
		if (chosen.length === 0) {
			new Notice("请先在客户列表里勾选客户");
			return;
		}
		const effective = effectiveTasks(tasks);

		let languageOverrides = new Map<string, string>();
		if (effective.email) {
			const unknown = chosen.filter(
				(record) => !guessLanguage(record.fm["地区"]),
			);
			if (unknown.length > 0) {
				const result = await new LanguageModal(this.app, unknown).openAndWait();
				if (result === null) return;
				languageOverrides = result;
			}
		}

		let knowledge: KnowledgeBundle;
		try {
			const loaded = await this.knowledgeLoader.load();
			if (!loaded.bundle) {
				throw new Error(loaded.errors.join("；") || "知识库加载失败");
			}
			knowledge = loaded.bundle;
		} catch (error) {
			new Notice(
				`知识库加载失败：${error instanceof Error ? error.message : String(error)}`,
				9000,
			);
			return;
		}

		const feedbackRules = await this.readFeedbackRules();
		const requests =
			chosen.length *
			((hasAnalysisTask(effective) ? 1 : 0) + (effective.email ? 1 : 0));

		const confirmed = await confirm(this.app, {
			title: "确认执行 AI 任务",
			confirmText: `确认执行（约 ${requests} 个请求）`,
			build: (container) => {
				container.createEl("p", { text: `客户数量：${chosen.length} 家` });
				const list = container.createEl("ul");
				for (const key of Object.keys(TASK_LABELS) as (keyof TaskSelection)[]) {
					if (!effective[key]) continue;
					list.createEl("li", { text: `✓ ${TASK_LABELS[key]}` });
				}
				container.createEl("p", {
					cls: "eo-muted",
					text: `知识库：${knowledge.mainPath} + ${knowledge.articles.length} 篇关联文章（${knowledge.totalChars} 字）`,
				});
				if (feedbackRules.trim()) {
					container.createEl("p", {
						cls: "eo-muted",
						text: "本次会参考已确认的 Feedback 规则。",
					});
				}
				if (!hasAnalysisTask(effective) && !effective.email) {
					container.createEl("p", { text: "没有勾选任何可执行任务。" });
				}
			},
		});
		if (!confirmed) return;

		const token = { canceled: false };
		const progress = new ProgressModal(this.app);
		progress.setOnCancel(() => {
			token.canceled = true;
		});
		progress.setMessage("正在准备…", `${chosen.length} 家客户`);
		progress.open();

		const pipeline = new Pipeline({
			settings: this.settings,
			knowledge,
			feedbackRules,
			adapter: this.adapter,
			repo: this.repo,
			client: this.client,
			state: this.state,
		});

		let outcome: RunOutcome;
		try {
			outcome = await pipeline.run({
				customers: chosen,
				tasks: effective,
				languageOverrides,
				token,
				onProgress: (event) => {
					progress.setMessage(
						`${event.phase} · ${event.customerName}`,
						`${Math.min(event.index + 1, event.total)} / ${event.total}`,
					);
				},
			});
		} catch (error) {
			if (error instanceof CanceledError) {
				new Notice("已取消");
				return;
			}
			new Notice(
				`执行失败：${error instanceof Error ? error.message : String(error)}`,
				9000,
			);
			return;
		} finally {
			progress.close();
		}

		await this.refreshEmailList();
		if (outcome.canceled) {
			new Notice("已取消；已经生成的内容已保存在磁盘上");
		}
		if (outcome.errors.length > 0) {
			console.error("[email-outreach] 本次执行错误", outcome.errors);
		}
		const withAnalysis = outcome.results.filter((result) => result.analysis);
		if (withAnalysis.length > 0) {
			new AnalysisReviewModal(
				this.app,
				withAnalysis,
				effective,
				async (plans) => {
					await this.applyAnalysis(plans);
				},
				() => void this.openEmailList(),
			).open();
		} else if (outcome.writtenFiles.length > 0) {
			new Notice(
				`已生成 ${outcome.writtenFiles.length} 封邮件草稿，请到邮件列表审核`,
				8000,
			);
		}
		if (outcome.errors.length > 0) {
			new Notice(
				`有 ${outcome.errors.length} 个客户出现错误，详情见分析确认窗口或控制台`,
				9000,
			);
		}
	}

	private async applyAnalysis(plans: AnalysisPlan[]): Promise<void> {
		let writtenCustomers = 0;
		let skipped = 0;
		for (const plan of plans) {
			const patch = selectedPatch(plan.candidates);
			const keys = Object.keys(patch);
			if (keys.length === 0) {
				skipped++;
				continue;
			}
			const customer = plan.result.customer;
			const analysis = plan.result.analysis;
			if (!analysis) continue;
			try {
				await this.adapter.updateFrontmatter(customer.path, (frontmatter) => {
					for (const key of keys) {
						frontmatter[key] = patch[key];
					}
				});
				const history = keys
					.map((key) => {
						const candidate = plan.candidates.find((item) => item.key === key);
						const before =
							candidate?.oldValue === undefined ||
							candidate?.oldValue === null ||
							String(candidate.oldValue).trim() === ""
								? "无"
								: String(candidate.oldValue);
						return `${key} ${before} → ${String(patch[key])}`;
					})
					.join(" · ");
				await this.writeAnalysisBack(
					customer,
					analysis,
					`${shortStamp()} · ${history}`,
				);
				writtenCustomers++;
			} catch (error) {
				new Notice(
					`写入 ${customer.name} 失败：${error instanceof Error ? error.message : String(error)}`,
					9000,
				);
			}
		}
		new Notice(
			`已更新 ${writtenCustomers} 家客户的属性${skipped > 0 ? `，${skipped} 家跳过` : ""}`,
		);
		this.refreshWorkbenchViews();
	}

	private async writeAnalysisBack(
		customer: CustomerRecord,
		analysis: AnalysisResult,
		historyLine: string,
	): Promise<void> {
		const path = aiFilePath(this.settings.outputDir, customer.name);
		const record: AnalysisRecord = {
			customerType: analysis.customerType,
			fit: analysis.fit,
			intent: analysis.intent,
			potential: analysis.potential,
			risk: analysis.risk,
			riskNotes: analysis.riskNotes,
			unknownFields: analysis.unknownFields,
			notes: analysis.analysisNotes,
		};
		if (this.adapter.exists(path)) {
			const content = await this.adapter.read(path);
			await this.adapter.write(
				path,
				updateAnalysisInContent(content, record, historyLine),
			);
			return;
		}
		const file = emptyCustomerAIFile(customer.name);
		file.analysis = record;
		file.analysisHistory = [historyLine];
		await this.adapter.write(path, renderCustomerAIFile(file));
	}

	// -------------------------------------------------------------- email flow

	async saveEmailEdit(
		row: EmailRow,
		subject: string,
		body: string,
	): Promise<void> {
		if (row.record.sent) {
			new Notice("这封邮件已标记为已发送，不能再修改");
			return;
		}
		const updated = addEmailVersion(row.record, {
			subject,
			body,
			action: "Edited",
			comment: "手动修改",
			status: "Revision",
		});
		await this.emailStore.saveRecord(row.filePath, updated);
		new Notice("已保存为新版本");
		await this.refreshEmailList();
	}

	async regenerateEmail(row: EmailRow, comment: string): Promise<void> {
		if (row.record.sent) {
			new Notice("已发送的邮件不能重新生成");
			return;
		}
		const problems = getConfigProblems(this.settings);
		if (problems.length > 0) {
			new Notice(problems.map((problem) => problem.message).join("\n"));
			return;
		}
		const content = await this.adapter.read(row.filePath);
		const parsed = parseCustomerAIFile(content);
		const record = parsed.file.emails.find((item) => item.id === row.record.id);
		if (!record) throw new Error("AI 文件中找不到这封邮件");
		const customer = await this.resolveCustomer(row.filePath, parsed.file.customerLink);
		if (!customer) throw new Error("客户文件链接失效，无法重新生成");
		const loaded = await this.knowledgeLoader.load();
		if (!loaded.bundle) throw new Error("知识库加载失败");
		const payload = await this.repo.load(
			customer,
			Math.max(500, this.settings.truncateBodyChars),
		);
		const contacts = payload.contacts.contacts;
		const validationContext = {
			contactIds: new Set(contacts.map((contact) => contact.id)),
			contactEmails: new Map(
				contacts.map((contact) => [contact.id, contact.emails]),
			),
			maxBodyChars: 8000,
		};
		const promptCustomer: PromptCustomer = {
			name: customer.name,
			path: customer.path,
			frontmatterText: payload.frontmatterText,
			contactSection: payload.contactSection,
			bodyExcerpt: payload.bodyExcerpt,
			bodyTruncated: payload.bodyTruncated,
		};
		const language: LanguageRequirement | null = record.language
			? {
					code: record.language,
					label: record.languageLabel || languageLabel(record.language),
					confidence: "high",
					source: "原邮件语言",
				}
			: null;
		const basePrompt = buildEmailUserPrompt({
			knowledge: loaded.bundle,
			feedbackRules: await this.readFeedbackRules(),
			customer: promptCustomer,
			contacts,
			analysis: analysisRecordToResult(parsed.file.analysis),
			language,
			sendTimeRequested: Boolean(record.suggestedTime),
		});
		const prompt =
			`${basePrompt}\n\n## 本次是修改现有邮件\n` +
			`原邮件 Subject：${record.subject}\n` +
			`原邮件 Body：\n${record.body}\n\n` +
			`用户修改意见：${comment.trim() || "没有具体意见，请写得更准确、更有说服力"}\n` +
			"请输出修改后的完整邮件 JSON；contact_id 使用联系人列表中的 id。";
		const raw = await this.client.complete(buildSystemPrompt(), prompt);
		const validation = validateAIResult(
			parseJsonLoose(raw),
			validationContext,
			"email",
		);
		if (!validation.ok || !validation.email) {
			throw new Error(
				`AI 返回未通过校验：${validation.errors.map((error) => error.message).join("；")}`,
			);
		}
		const draft = validation.email;
		const contact = findContact(contacts, draft.contactId);
		if (!contact || contact.emails.length === 0) {
			throw new Error("找不到修改后邮件的收件人邮箱");
		}
		let updated = addEmailVersion(record, {
			subject: draft.subject,
			body: draft.body,
			action: "Revised",
			comment: comment.trim() || "重新生成",
			status: "Revision",
		});
		updated = {
			...updated,
			summaryZh: draft.emailSummaryZh,
			language: draft.language,
			languageLabel: languageLabel(draft.language),
			contact: contact.raw,
			email: contact.emails[0]!,
			suggestedTime: draft.suggestedSendTime,
			timezone: draft.timezone,
			timeReason: draft.timeReason,
		};
		await this.emailStore.saveRecord(row.filePath, updated);
		new Notice("已生成新版本");
		await this.refreshEmailList();
	}

	async acceptEmail(row: EmailRow): Promise<void> {
		const propertyName = this.settings.linkPropertyName || "AI开发信息";
		const aiFile = await this.reloadAIFile(row.filePath);
		const link = aiFile?.customerLink ?? row.customerLink;
		const customer = await this.resolveCustomer(row.filePath, link);
		const linkPath = row.filePath.replace(/\.md$/i, "");
		let willWriteLink = false;
		let existingLink: string | null = null;
		if (customer && this.settings.writeCustomerLink) {
			const existing = customer.fm[propertyName];
			if (existing === undefined || String(existing).trim() === "") {
				willWriteLink = true;
			} else if (!String(existing).includes(linkPath)) {
				existingLink = String(existing);
			}
		}
		const confirmed = await confirm(this.app, {
			title: "验收通过",
			confirmText: "确认验收",
			build: (container) => {
				container.createEl("p", {
					text: "验收通过代表邮件内容审核通过，不代表已经发送。",
				});
				if (willWriteLink && customer) {
					container.createEl("p", {
						text: `会把客户属性「${propertyName}」写为 ${toWikilink(linkPath)}。`,
					});
				}
				if (existingLink) {
					container.createEl("p", {
						cls: "eo-warning-box",
						text: `客户属性「${propertyName}」已有其他值，不会覆盖：${existingLink}`,
					});
				}
				if (customer && !this.settings.writeCustomerLink) {
					container.createEl("p", {
						cls: "eo-muted",
						text: "设置里关闭了「验收时写入客户双链」，本次不改客户文件。",
					});
				}
			},
		});
		if (!confirmed) return;
		const updated = setEmailStatus(row.record, "Accepted");
		await this.emailStore.saveRecord(row.filePath, updated);
		if (willWriteLink && customer) {
			try {
				await this.adapter.updateFrontmatter(customer.path, (frontmatter) => {
					frontmatter[propertyName] = toWikilink(linkPath);
				});
				new Notice(`已验收，并写入客户属性「${propertyName}」`);
			} catch (error) {
				new Notice(
					`邮件已验收，但写客户属性失败：${error instanceof Error ? error.message : String(error)}`,
					9000,
				);
			}
		} else {
			new Notice("已验收");
		}
		this.repo.invalidate();
		this.refreshWorkbenchViews();
		await this.refreshEmailList();
	}

	async rejectEmail(row: EmailRow): Promise<void> {
		const updated = setEmailStatus(row.record, "Rejected");
		await this.emailStore.saveRecord(row.filePath, updated);
		new Notice("已拒绝这封邮件");
		await this.refreshEmailList();
	}

	async markEmailSent(row: EmailRow): Promise<void> {
		if (row.record.status !== "Accepted") {
			new Notice("只有验收通过的邮件才能标记为已发送");
			return;
		}
		if (row.record.sent) {
			new Notice("这封邮件已经标记为已发送");
			return;
		}
		const aiFile = await this.reloadAIFile(row.filePath);
		const link = aiFile?.customerLink ?? row.customerLink;
		const customer = await this.resolveCustomer(row.filePath, link);
		if (!customer) {
			new Notice("客户文件链接失效，无法更新跟进次数和最近联系时间");
			return;
		}
		const today = localStamp().date;
		const oldFollow = customer.fm["跟进次数"];
		const nextFollow = nextFollowUpCount(oldFollow);
		const oldLastContact = customer.fm["最近联系时间"];
		const confirmed = await confirm(this.app, {
			title: "标记为已发送",
			confirmText: "确认已发送",
			build: (container) => {
				container.createEl("p", {
					text: `邮件：${row.record.subject}`,
				});
				const list = container.createEl("ul");
				list.createEl("li", {
					text: `跟进次数：${oldFollow === undefined ? "（空）" : String(oldFollow)} → ${nextFollow}`,
				});
				list.createEl("li", {
					text: `最近联系时间：${oldLastContact === undefined || String(oldLastContact).trim() === "" ? "（空）" : String(oldLastContact)} → ${today}`,
				});
				container.createEl("p", {
					cls: "eo-muted",
					text: "这是唯一会修改跟进次数与最近联系时间的操作。",
				});
			},
		});
		if (!confirmed) return;
		const updated = { ...row.record, sent: true, sentAt: isoNow() };
		await this.emailStore.saveRecord(row.filePath, updated);
		try {
			await this.adapter.updateFrontmatter(customer.path, (frontmatter) => {
				frontmatter["跟进次数"] = nextFollow;
				frontmatter["最近联系时间"] = today;
			});
		} catch (error) {
			new Notice(
				`邮件已标记发送，但更新客户属性失败：${error instanceof Error ? error.message : String(error)}`,
				9000,
			);
		}
		this.repo.invalidate();
		this.refreshWorkbenchViews();
		await this.refreshEmailList();
	}

	async saveRuleFromEmail(row: EmailRow, comment: string): Promise<void> {
		const loaded = await this.knowledgeLoader.load();
		if (!loaded.bundle) {
			new Notice("知识库加载失败，无法整理规则");
			return;
		}
		const raw = await this.client.complete(
			buildRuleSystemPrompt(),
			buildRuleUserPrompt({
				knowledge: loaded.bundle,
				email: row.record,
				userComments: comment,
			}),
		);
		const draft = parseRuleDraft(parseJsonLoose(raw));
		if (!draft) {
			new Notice("AI 没有返回可用的规则，请重试");
			return;
		}
		new RuleModal(this.app, draft, `${row.customerName} · 邮件 ${row.record.id}`, (final) => {
			void this.appendFeedbackRule(final, row);
		}).open();
	}

	private async appendFeedbackRule(
		draft: RuleDraft,
		row: EmailRow,
	): Promise<void> {
		const path = feedbackFilePath(
			this.settings.outputDir,
			this.settings.feedbackFile,
		);
		let content = "";
		try {
			content = this.adapter.exists(path)
				? await this.adapter.read(path)
				: FEEDBACK_HEADER;
		} catch {
			content = FEEDBACK_HEADER;
		}
		if (!content.trim()) content = FEEDBACK_HEADER;
		const block = [
			`## ${localStamp().date} · ${draft.ruleTitle}`,
			"",
			`- 适用范围：${draft.scope}`,
			`- 来源：${toWikilink(row.filePath.replace(/\.md$/i, ""))} · 邮件 ${row.record.id} · 客户 ${toWikilink(row.customerName)}`,
			"",
			draft.ruleText,
			"",
		].join("\n");
		const updated = `${content.trimEnd()}\n\n${block}`;
		await this.adapter.write(path, updated);
		new Notice("规则已写入 Feedback.md");
	}

	private async reloadAIFile(path: string): Promise<CustomerAIFile | null> {
		try {
			const content = await this.adapter.read(path);
			return parseCustomerAIFile(content).file;
		} catch {
			return null;
		}
	}

	private async resolveCustomer(
		aiFilePathValue: string,
		link: string | null | undefined,
	): Promise<CustomerRecord | null> {
		const target = link?.trim();
		if (target) {
			const resolved = this.app.metadataCache.getFirstLinkpathDest(
				target,
				aiFilePathValue,
			);
			if (resolved) {
				const found = this.repo.find(resolved.path);
				if (found) return found;
			}
		}
		// Fallback: match by basename inside the customer directory.
		const records = this.repo.list(true);
		const byName = records.filter((record) => record.name === target);
		if (byName.length === 1) return byName[0]!;
		return null;
	}

	async readFeedbackRules(): Promise<string> {
		const path = feedbackFilePath(
			this.settings.outputDir,
			this.settings.feedbackFile,
		);
		try {
			if (!this.adapter.exists(path)) return "";
			return (await this.adapter.read(path)).trim();
		} catch {
			return "";
		}
	}

	// ------------------------------------------------------------- diagnostics

	async getKnowledgeSummary(): Promise<string> {
		const loaded = await this.knowledgeLoader.load();
		if (!loaded.bundle) {
			return `知识库未就绪：${loaded.errors.join("；")}`;
		}
		const bundle = loaded.bundle;
		const lines = [
			`主指令文件：${bundle.mainPath}`,
			`关联文章：${bundle.articles.length} 篇`,
			`总字数：${bundle.totalChars}`,
		];
		if (bundle.truncated) lines.push("注意：知识库超过上限，已截断");
		if (bundle.missingLinks.length > 0) {
			lines.push(`无法解析的双链：${bundle.missingLinks.join("、")}`);
		}
		return lines.join("\n");
	}

	async runSelfCheck(): Promise<string> {
		const lines: string[] = [];
		lines.push("=== Email Outreach 自检 ===");
		lines.push(`时间：${isoNow()}`);
		const problems = getConfigProblems(this.settings);
		lines.push("");
		lines.push(`[设置] ${problems.length === 0 ? "完整" : "缺失 " + problems.length + " 项"}`);
		for (const problem of problems) lines.push(`  - ${problem.label}：${problem.message}`);

		const customerDir = normalizeDir(this.settings.customerDir);
		const outputDir = normalizeDir(this.settings.outputDir);
		lines.push("");
		lines.push(
			`[目录] 客户目录 ${customerDir || "（空）"}：${customerDir && this.adapter.isFolder(customerDir) ? "存在" : "不存在"}`,
		);
		lines.push(
			`[目录] 输出目录 ${outputDir || "（空）"}：${outputDir && this.adapter.isFolder(outputDir) ? "存在" : "尚未创建（首次生成时自动创建）"}`,
		);
		if (this.settings.instructionFile.trim()) {
			lines.push(
				`[指令文件] ${this.settings.instructionFile}：${this.adapter.getFile(this.settings.instructionFile) ? "存在" : "不存在"}`,
			);
		}

		const knowledge = await this.getKnowledgeSummary();
		lines.push("");
		lines.push("[知识库]");
		for (const line of knowledge.split("\n")) lines.push(`  ${line}`);

		const records = this.repo.list(true);
		lines.push("");
		lines.push(`[客户] 共 ${records.length} 个 Markdown 文件`);
		const keys = collectPropertyKeys(records);
		lines.push(`[客户] 属性键 ${keys.length} 个：${keys.slice(0, 20).join("、")}${keys.length > 20 ? " …" : ""}`);
		const excluded = records.filter((record) =>
			isExcluded(record, {
				tags: this.settings.excludeTags,
				progressPrefixes: this.settings.excludeProgressPrefixes,
			}),
		).length;
		lines.push(`[客户] 默认排除 ${excluded} 家`);

		let withHeading = 0;
		let withEmail = 0;
		let unreadable = 0;
		let parseWarnings = 0;
		let totalContacts = 0;
		for (const record of records) {
			try {
				const payload = await this.repo.load(record, 2000);
				if (payload.contacts.headingFound) withHeading++;
				totalContacts += payload.contacts.contacts.length;
				if (payload.contacts.contacts.some((contact) => contact.emails.length > 0)) {
					withEmail++;
				}
				parseWarnings += payload.contacts.warnings.length;
			} catch {
				unreadable++;
			}
		}
		lines.push(`[联系人] 有联系人区段 ${withHeading} 家；有可用邮箱 ${withEmail} 家；联系人条目 ${totalContacts} 个`);
		lines.push(`[联系人] 解析提示 ${parseWarnings} 条；读取失败 ${unreadable} 个文件`);

		lines.push("");
		lines.push(`[Bases] 自定义视图 API：${this.basesAvailable ? "可用" : "不可用（使用内置工作台）"}`);
		lines.push(`[邮件] 已识别 AI 开发信息文件：${this.emailStore.getRows().length} 封邮件`);

		return lines.join("\n");
	}

	reloadBasesView(): void {
		new Notice("切换工作台模式后，请重载插件（或重启 Obsidian）生效。");
	}
}
