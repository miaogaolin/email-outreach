import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import {
	AI_LOG_FILE_NAME,
	AI_LOG_MAX_ENTRIES,
	AI_LOG_STATE_DIR,
	aiLogStatusLabel,
	formatAILogDuration,
	formatAILogEntries,
	formatAILogEntry,
	formatAILogTime,
	type AILogEntry,
} from "../core/ai-log";
import { getConfigProblems, type WorkbenchMode } from "./settings";
import type { OutreachPluginApi } from "./plugin-api";
import { confirm } from "./modals/confirm";

export interface SettingsHost extends OutreachPluginApi {
	getKnowledgeSummary(): Promise<string>;
	clearSelection(): void;
	clearApiKey(): Promise<void>;
	listModels(): Promise<string[]>;
	reloadBasesView(): void;
	/** 读取本机 AI 日志（最新在前）。 */
	loadAILogs(): Promise<AILogEntry[]>;
	clearAILogs(): Promise<void>;
}

/** 复制文本；Electron 里 navigator.clipboard 偶尔不可用，回退到 textarea。 */
async function copyText(text: string): Promise<void> {
	try {
		if (
			navigator.clipboard &&
			typeof navigator.clipboard.writeText === "function"
		) {
			await navigator.clipboard.writeText(text);
			return;
		}
	} catch {
		// 继续走回退方案
	}
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	document.body.appendChild(textarea);
	textarea.select();
	try {
		const ok = document.execCommand("copy");
		if (!ok) throw new Error("浏览器拒绝了复制请求");
	} finally {
		document.body.removeChild(textarea);
	}
}

export class EmailOutreachSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private host: SettingsHost,
	) {
		super(app, host as unknown as import("obsidian").Plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Email Outreach 设置" });

		const problems = getConfigProblems(this.host.settings);
		if (problems.length > 0) {
			const box = containerEl.createDiv({ cls: "eo-warning-box" });
			box.createEl("strong", { text: "还需要配置：" });
			const list = box.createEl("ul");
			for (const problem of problems) {
				list.createEl("li", { text: `${problem.label} — ${problem.message}` });
			}
		} else {
			const ok = containerEl.createDiv({ cls: "eo-success-box" });
			ok.setText("基础配置已完成。");
		}

		new Setting(containerEl).setName("AI 服务").setHeading();

		new Setting(containerEl)
			.setName("API 地址")
			.setDesc("OpenAI 兼容接口的 base URL，例如 https://api.deepseek.com")
			.addText((text) =>
				text
					.setPlaceholder("https://api.deepseek.com")
					.setValue(this.host.settings.apiBaseUrl)
					.onChange(async (value) => {
						const next = value.trim();
						if (next !== this.host.settings.apiBaseUrl) {
							// 模型列表随服务商变化，换地址后旧列表不再可信。
							this.host.settings.availableModels = [];
						}
						this.host.settings.apiBaseUrl = next;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("API Key")
			.setDesc(
				"优先保存在 Obsidian secretStorage；不可用时保存在插件 data.json（明文），请勿提交到 Git。",
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setValue(this.host.settings.apiKey)
					.onChange(async (value) => {
						this.host.settings.apiKey = value.trim();
						await this.host.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("模型名称")
			.setDesc(
				"可手动填写；也可点右侧按钮，从该 API 服务读取实际可用的模型列表。",
			)
			.addText((text) =>
				text.setValue(this.host.settings.model).onChange(async (value) => {
					this.host.settings.model = value.trim();
					await this.host.saveSettings();
				}),
			)
			.addButton((button) =>
				button.setButtonText("获取模型列表").onClick(async () => {
					button.setDisabled(true).setButtonText("获取中…");
					try {
						const models = await this.host.listModels();
						if (!this.host.settings.model.trim() && models.length === 1) {
							this.host.settings.model = models[0]!;
							await this.host.saveSettings();
						}
						new Notice(
							`已获取 ${models.length} 个模型：\n${models.join("、")}`,
							12000,
						);
						this.display();
					} catch (error) {
						new Notice(
							error instanceof Error ? error.message : String(error),
							12000,
						);
						button.setDisabled(false);
						button.setButtonText("获取模型列表");
					}
				}),
			);

		const availableModels = this.host.settings.availableModels ?? [];
		if (availableModels.length > 0) {
			const current = this.host.settings.model.trim();
			const missing = current !== "" && !availableModels.includes(current);
			new Setting(containerEl)
				.setName("可用模型")
				.setDesc(
					missing
						? `接口返回 ${availableModels.length} 个模型；当前填写的「${current}」不在列表里，可能已下线，建议从下面重新选择。`
						: `接口返回 ${availableModels.length} 个模型。选择后会同时更新上面的模型名称。`,
				)
				.addDropdown((dropdown) => {
					const options: Record<string, string> = { "": "— 选择模型 —" };
					for (const id of availableModels) options[id] = id;
					dropdown.addOptions(options);
					dropdown.setValue(availableModels.includes(current) ? current : "");
					dropdown.onChange(async (value) => {
						if (!value) return;
						this.host.settings.model = value;
						await this.host.saveSettings();
						new Notice(`模型已改为 ${value}`);
						this.display();
					});
				});
		}

		new Setting(containerEl)
			.setName("温度")
			.setDesc("0–1。邮件与评分建议 0.2–0.4。")
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.1)
					.setValue(this.host.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.host.settings.temperature = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("请求超时（毫秒）")
			.addText((text) =>
				text
					.setValue(String(this.host.settings.timeoutMs))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (Number.isFinite(parsed) && parsed >= 10000) {
							this.host.settings.timeoutMs = parsed;
							await this.host.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("并发请求数")
			.setDesc("1–5。过高容易触发限流。")
			.addSlider((slider) =>
				slider
					.setLimits(1, 5, 1)
					.setValue(this.host.settings.concurrency)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.host.settings.concurrency = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl).setName("文件路径").setHeading();

		new Setting(containerEl)
			.setName("AI 主指令文件")
			.setDesc(
				"指向一个 Markdown 文件。可省略 .md 扩展名，也接受 [[双链]] 写法；插件会读取它和其中 [[双链]] 指向的知识文章。",
			)
			.addText((text) =>
				text
					.setPlaceholder("2. Permanent/AI 邮件开发/Email Instructions.md")
					.setValue(this.host.settings.instructionFile)
					.onChange(async (value) => {
						this.host.settings.instructionFile = value.trim();
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("客户目录")
			.setDesc("客户 Markdown 文件所在目录。")
			.addText((text) =>
				text
					.setPlaceholder("3. Project/客户")
					.setValue(this.host.settings.customerDir)
					.onChange(async (value) => {
						this.host.settings.customerDir = value.trim();
						this.host.repo.invalidate();
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("输出目录")
			.setDesc(
				"每个客户在这里生成一个「客户名 - AI开发信息.md」，保存全部邮件和修改历史。",
			)
			.addText((text) =>
				text
					.setPlaceholder("4. AI Output/邮件开发")
					.setValue(this.host.settings.outputDir)
					.onChange(async (value) => {
						this.host.settings.outputDir = value.trim();
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Feedback 规则文件")
			.setDesc("留空则使用「输出目录/Feedback.md」。")
			.addText((text) =>
				text
					.setValue(this.host.settings.feedbackFile)
					.onChange(async (value) => {
						this.host.settings.feedbackFile = value.trim();
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl).setName("筛选与写回").setHeading();

		new Setting(containerEl)
			.setName("默认排除标签")
			.setDesc("逗号分隔；命中的客户默认不进入开发列表。")
			.addText((text) =>
				text
					.setValue(this.host.settings.excludeTags.join(", "))
					.onChange(async (value) => {
						this.host.settings.excludeTags = value
							.split(/[,，]/)
							.map((item) => item.trim())
							.filter(Boolean);
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("默认排除进度前缀")
			.setDesc("逗号分隔，例如 6.2.正式订单。")
			.addText((text) =>
				text
					.setValue(this.host.settings.excludeProgressPrefixes.join(", "))
					.onChange(async (value) => {
						this.host.settings.excludeProgressPrefixes = value
							.split(/[,，]/)
							.map((item) => item.trim())
							.filter(Boolean);
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("客户双链属性名")
			.setDesc("邮件验收通过后，把 AI 开发信息文件的双链写入客户这个属性。")
			.addText((text) =>
				text
					.setValue(this.host.settings.linkPropertyName)
					.onChange(async (value) => {
						this.host.settings.linkPropertyName =
							value.trim() || "AI开发信息";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("验收时写入客户双链")
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.writeCustomerLink)
					.onChange(async (value) => {
						this.host.settings.writeCustomerLink = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("工作台模式")
			.setDesc(
				"Bases 视图复用 .base 的筛选、列与排序；内置工作台不依赖 Bases。切换后需要重载插件。",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						bases: "Bases 视图（推荐）",
						builtin: "内置工作台",
						both: "两者都启用",
					})
					.setValue(this.host.settings.workbenchMode)
					.onChange(async (value) => {
						this.host.settings.workbenchMode = value as WorkbenchMode;
						await this.host.saveSettings();
						new Notice("工作台模式已保存，重载插件后完全生效");
					}),
			);

		new Setting(containerEl).setName("知识库与提示词预算").setHeading();

		new Setting(containerEl)
			.setName("客户正文截断字数")
			.setDesc("客户笔记可能很长，只把前 N 字送进 AI。")
			.addText((text) =>
				text
					.setValue(String(this.host.settings.truncateBodyChars))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (Number.isFinite(parsed) && parsed >= 500) {
							this.host.settings.truncateBodyChars = parsed;
							await this.host.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("知识库最大字数")
			.addText((text) =>
				text
					.setValue(String(this.host.settings.maxKnowledgeChars))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (Number.isFinite(parsed) && parsed >= 1000) {
							this.host.settings.maxKnowledgeChars = parsed;
							await this.host.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("知识库最大文件数")
			.addText((text) =>
				text
					.setValue(String(this.host.settings.maxKnowledgeFiles))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (Number.isFinite(parsed) && parsed >= 1) {
							this.host.settings.maxKnowledgeFiles = parsed;
							await this.host.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("双链递归深度")
			.setDesc("0 = 只读主指令文件；2 = 主文件 + 一层 + 二层链接。")
			.addSlider((slider) =>
				slider
					.setLimits(0, 4, 1)
					.setValue(this.host.settings.knowledgeDepth)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.host.settings.knowledgeDepth = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl).setName("工具").setHeading();

		new Setting(containerEl)
			.setName("知识库状态")
			.setDesc("加载主指令文件及其双链文章，并显示统计。")
			.addButton((button) =>
				button.setButtonText("重新加载并检查").onClick(async () => {
					const summary = await this.host.getKnowledgeSummary();
					new Notice(summary, 12000);
				}),
			);

		new Setting(containerEl)
			.setName("自检")
			.setDesc("检查设置、目录、客户数量、联系人解析与 Bases 可用性。")
			.addButton((button) =>
				button.setButtonText("运行自检").onClick(async () => {
					const report = await this.host.runSelfCheck();
					new Notice(report.slice(0, 800), 15000);
					console.log("[email-outreach] 自检报告\n" + report);
				}),
			);

		new Setting(containerEl)
			.setName("示例 Base")
			.setDesc("生成一个包含本插件视图的 .base 文件。")
			.addButton((button) =>
				button.setButtonText("生成").onClick(() => this.host.openBaseStarter()),
			);

		new Setting(containerEl)
			.setName("清除 API Key")
			.addButton((button) =>
				button.setButtonText("清除").onClick(async () => {
					await this.host.clearApiKey();
					new Notice("API Key 已清除");
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("已选客户")
			.setDesc(`当前已选 ${this.host.getSelected().size} 家。`)
			.addButton((button) =>
				button.setButtonText("清空已选").onClick(() => {
					this.host.clearSelection();
					this.display();
				}),
			);

		this.renderAILogSection(containerEl);
	}

	/** 设置页最底部：AI 请求日志。 */
	private renderAILogSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("AI 请求日志").setHeading();

		const dir = this.host.settings.outputDir.trim();
		const storage = dir
			? `日志同时写入「${dir}/${AI_LOG_STATE_DIR}/${AI_LOG_FILE_NAME}」，重载插件后仍可查看。`
			: "当前未设置输出目录，日志只保存在本次会话。";
		containerEl.createDiv({
			cls: "eo-log-desc",
			text: `逐条记录真正发给 AI 的内容：完整系统提示词、用户提示词、模型与参数、耗时、原始响应和错误。最多保留最近 ${AI_LOG_MAX_ENTRIES} 条。${storage}`,
		});

		const toolbar = containerEl.createDiv({ cls: "eo-log-toolbar" });
		const refreshButton = toolbar.createEl("button", { text: "刷新" });
		const copyAllButton = toolbar.createEl("button", { text: "复制全部" });
		const clearButton = toolbar.createEl("button", {
			cls: "mod-warning",
			text: "清除日志",
		});
		const listEl = containerEl.createDiv({ cls: "eo-log-list" });

		const fill = async (): Promise<void> => {
			listEl.empty();
			listEl.createDiv({ cls: "eo-muted", text: "正在读取日志…" });
			let entries: AILogEntry[];
			try {
				entries = await this.host.loadAILogs();
			} catch (error) {
				listEl.empty();
				listEl.createDiv({
					cls: "eo-log-empty",
					text: `读取日志失败：${error instanceof Error ? error.message : String(error)}`,
				});
				return;
			}
			// 等待期间用户可能已经切走或重新打开设置页。
			if (!listEl.isConnected) return;
			listEl.empty();
			if (entries.length === 0) {
				listEl.createDiv({
					cls: "eo-log-empty",
					text: "还没有记录。生成邮件、重新生成邮件或提炼规则后，这里会显示发给 AI 的完整内容。",
				});
				return;
			}
			listEl.createDiv({
				cls: "eo-muted",
				text: `共 ${entries.length} 条，最新在前。点击一条展开完整内容。`,
			});
			for (const entry of entries) this.renderAILogEntry(listEl, entry);
		};

		refreshButton.addEventListener("click", () => {
			void fill();
		});

		copyAllButton.addEventListener("click", async () => {
			try {
				const entries = await this.host.loadAILogs();
				if (entries.length === 0) {
					new Notice("还没有 AI 日志");
					return;
				}
				await copyText(formatAILogEntries(entries));
				new Notice(`已复制 ${entries.length} 条 AI 日志`);
			} catch (error) {
				new Notice(
					`复制失败：${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});

		clearButton.addEventListener("click", async () => {
			const ok = await confirm(this.app, {
				title: "清除 AI 请求日志",
				confirmText: "清除",
				danger: true,
				build: (container) => {
					container.createEl("p", {
						text: "会删除当前保存的全部 AI 请求记录（包括 .state/ai-log.jsonl），不影响已生成的邮件。",
					});
				},
			});
			if (!ok) return;
			await this.host.clearAILogs();
			new Notice("AI 日志已清除");
			await fill();
		});

		void fill();
	}

	private renderAILogEntry(parent: HTMLElement, entry: AILogEntry): void {
		const details = parent.createEl("details", {
			cls: `eo-log-entry eo-log-entry-${entry.status}`,
		});
		const summary = details.createEl("summary", { cls: "eo-log-summary" });
		summary.createSpan({
			cls: `eo-log-badge eo-log-badge-${entry.status}`,
			text: aiLogStatusLabel(entry.status),
		});
		summary.createSpan({ cls: "eo-log-time", text: formatAILogTime(entry.at) });
		summary.createSpan({ cls: "eo-log-label", text: entry.label });
		const meta = [
			entry.request.model || "（未配置模型）",
			formatAILogDuration(entry.durationMs),
			`系统 ${entry.request.systemChars} 字 / 用户 ${entry.request.userChars} 字`,
		];
		if (entry.attempt > 1) meta.push(`第 ${entry.attempt} 次尝试`);
		summary.createSpan({ cls: "eo-log-meta", text: meta.join(" · ") });
		if (entry.status === "error" && entry.response.error) {
			summary.createSpan({
				cls: "eo-log-error-hint",
				text: entry.response.error.slice(0, 90),
			});
		}

		let rendered = false;
		details.addEventListener("toggle", () => {
			if (!details.open || rendered) return;
			rendered = true;
			this.renderAILogBody(details, entry);
		});
	}

	private renderAILogBody(parent: HTMLElement, entry: AILogEntry): void {
		const body = parent.createDiv({ cls: "eo-log-body" });
		const facts = body.createDiv({ cls: "eo-log-facts" });
		const fact = (key: string, value: string): void => {
			const row = facts.createDiv({ cls: "eo-log-fact" });
			row.createSpan({ cls: "eo-log-fact-key", text: key });
			row.createSpan({ cls: "eo-log-fact-value", text: value });
		};
		fact("记录", entry.label);
		fact("时间", `${formatAILogTime(entry.at)}（${entry.at}）`);
		if (entry.customerName || entry.customerPath) {
			fact(
				"客户",
				[entry.customerName, entry.customerPath].filter(Boolean).join(" · "),
			);
		}
		fact("尝试", `第 ${entry.attempt} / ${entry.maxAttempts} 次`);
		fact("模型", entry.request.model || "（未设置）");
		fact("接口", `${entry.request.method} ${entry.request.url || "（未设置）"}`);
		fact(
			"参数",
			`temperature=${entry.request.temperature ?? "—"} · response_format=${entry.request.responseFormat ?? "—"} · stream=${entry.request.stream}`,
		);
		fact(
			"提示词",
			`系统 ${entry.request.systemChars} 字 / 用户 ${entry.request.userChars} 字 / 合计 ${entry.request.totalChars} 字`,
		);
		fact("耗时", formatAILogDuration(entry.durationMs));
		fact(
			"HTTP 状态",
			entry.response.status === null ? "未收到响应" : String(entry.response.status),
		);
		if (entry.response.finishReason) {
			fact("finish_reason", entry.response.finishReason);
		}
		if (entry.response.usage) {
			const usage = entry.response.usage;
			fact(
				"tokens",
				`prompt ${usage.promptTokens ?? "—"} / completion ${usage.completionTokens ?? "—"} / total ${usage.totalTokens ?? "—"}`,
			);
		}

		if (entry.response.error) {
			body.createDiv({
				cls: "eo-log-error",
				text: `错误：${entry.response.error}`,
			});
		}

		const section = (title: string, content: string | null): void => {
			if (content === null || content === "") return;
			const block = body.createDiv({ cls: "eo-log-section" });
			const head = block.createDiv({ cls: "eo-log-section-head" });
			head.createSpan({ cls: "eo-log-section-title", text: title });
			head.createSpan({
				cls: "eo-log-section-size",
				text: `${content.length} 字`,
			});
			block.createEl("pre", { cls: "eo-log-pre", text: content });
		};
		section("系统提示词（完整）", entry.request.system);
		section("用户提示词（完整）", entry.request.user);
		section("AI 返回内容", entry.response.content);
		section("原始响应体", entry.response.rawBody);

		const actions = body.createDiv({ cls: "eo-log-actions" });
		actions
			.createEl("button", { text: "复制这条日志" })
			.addEventListener("click", async () => {
				try {
					await copyText(formatAILogEntry(entry));
					new Notice("已复制这条日志");
				} catch (error) {
					new Notice(
						`复制失败：${error instanceof Error ? error.message : String(error)}`,
					);
				}
			});
	}
}
