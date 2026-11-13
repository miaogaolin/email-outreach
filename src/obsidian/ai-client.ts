import { requestUrl } from "obsidian";
import {
	createAILogEntry,
	type AILogEntry,
	type AILogKind,
	type AILogStatus,
	type AILogUsage,
} from "../core/ai-log";
import { isoNow } from "../core/filenames";
import { modelsEndpoint, parseModelList } from "../core/models";
import type { Settings } from "./settings";

/** 调用方补的上下文，只用于日志展示，不参与请求内容。 */
export interface AIRequestMeta {
	kind?: AILogKind;
	/** 例如「ACME · 生成开发邮件」。 */
	label?: string;
	customerName?: string | null;
	customerPath?: string | null;
}

/** 从 OpenAI 兼容返回里读 token 统计；没有就返回 null。 */
function readUsage(data: unknown): AILogUsage | null {
	if (!data || typeof data !== "object") return null;
	const usage = (data as { usage?: unknown }).usage;
	if (!usage || typeof usage !== "object") return null;
	const record = usage as Record<string, unknown>;
	const number = (value: unknown): number | null =>
		typeof value === "number" && Number.isFinite(value) ? value : null;
	const result: AILogUsage = {
		promptTokens: number(record.prompt_tokens),
		completionTokens: number(record.completion_tokens),
		totalTokens: number(record.total_tokens),
	};
	if (
		result.promptTokens === null &&
		result.completionTokens === null &&
		result.totalTokens === null
	) {
		return null;
	}
	return result;
}

export class AIError extends Error {
	constructor(
		message: string,
		readonly retryable: boolean,
	) {
		super(message);
		this.name = "AIError";
	}
}

export class CanceledError extends Error {
	constructor() {
		super("已取消");
		this.name = "CanceledError";
	}
}

export interface CancelToken {
	canceled: boolean;
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const timer = window.setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new AIError(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒）`, true));
		}, timeoutMs);
		promise.then(
			(value) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function buildEndpoint(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, "");
	if (!trimmed) throw new AIError("未设置 API 地址", false);
	if (trimmed.endsWith("/chat/completions")) return trimmed;
	return `${trimmed}/chat/completions`;
}

/** 与 chat 端点同源：去掉 `/chat/completions`，补 `/models`。 */
function buildModelsEndpoint(baseUrl: string): string {
	const endpoint = modelsEndpoint(baseUrl);
	if (!endpoint) throw new AIError("未设置 API 地址", false);
	return endpoint;
}

export class AIClient {
	constructor(
		private getSettings: () => Settings,
		/** 每次真正发出请求后回调一条日志；失败不影响请求本身。 */
		private onLog?: (entry: AILogEntry) => void,
	) {}

	async complete(
		system: string,
		user: string,
		token?: CancelToken,
		meta?: AIRequestMeta,
	): Promise<string> {
		const maxAttempts = 4;
		let lastError: unknown = null;
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			if (token?.canceled) throw new CanceledError();
			try {
				return await this.requestOnce(
					system,
					user,
					token,
					meta,
					attempt + 1,
					maxAttempts,
				);
			} catch (error) {
				lastError = error;
				const retryable =
					error instanceof AIError ? error.retryable : false;
				if (!retryable || attempt >= maxAttempts - 1) break;
				await sleep(1000 * Math.pow(2, attempt));
			}
		}
		if (lastError instanceof Error) throw lastError;
		throw new AIError("AI 请求失败", false);
	}

	/**
	 * 读取 OpenAI 兼容接口的 `GET /models`，返回该服务实际提供的模型 id。
	 * 不支持的服务（如部分只做 chat 的中转）会抛错，调用方保留手动填写入口。
	 */
	async listModels(): Promise<string[]> {
		const settings = this.getSettings();
		const endpoint = buildModelsEndpoint(settings.apiBaseUrl);
		const headers: Record<string, string> = { Accept: "application/json" };
		const key = settings.apiKey.trim();
		if (key) headers.Authorization = `Bearer ${key}`;

		const response = await withTimeout(
			requestUrl({
				url: endpoint,
				method: "GET",
				headers,
				throw: false,
			}),
			Math.min(30000, Math.max(10000, settings.timeoutMs)),
		);

		if (response.status < 200 || response.status >= 300) {
			const detail = (response.text ?? "").slice(0, 300);
			throw new AIError(
				`获取模型列表失败：接口返回 ${response.status}${detail ? `：${detail}` : ""}`,
				false,
			);
		}

		let data: unknown = null;
		try {
			data = response.json;
		} catch {
			data = null;
		}
		const models = parseModelList(data);
		if (models.length === 0) {
			throw new AIError(
				"接口没有返回模型列表；该服务可能不支持 /models，请手动填写模型名称",
				false,
			);
		}
		return models;
	}

	private async requestOnce(
		system: string,
		user: string,
		token: CancelToken | undefined,
		meta: AIRequestMeta | undefined,
		attempt: number,
		maxAttempts: number,
	): Promise<string> {
		const settings = this.getSettings();
		const startedAt = Date.now();
		const startedIso = isoNow(new Date(startedAt));
		let url = "";
		let httpStatus: number | null = null;
		let rawBody: string | null = null;
		let finishReason: string | null = null;
		let usage: AILogUsage | null = null;

		const log = (
			status: AILogStatus,
			content: string | null,
			error: string | null,
		): void => {
			if (!this.onLog) return;
			try {
				this.onLog(
					createAILogEntry({
						id: `${startedAt.toString(36)}-${Math.random()
							.toString(36)
							.slice(2, 8)}`,
						at: startedIso,
						finishedAt: isoNow(),
						durationMs: Date.now() - startedAt,
						attempt,
						maxAttempts,
						kind: meta?.kind ?? "email",
						label: meta?.label ?? "",
						customerName: meta?.customerName ?? null,
						customerPath: meta?.customerPath ?? null,
						status,
						request: {
							url,
							method: "POST",
							model: settings.model.trim(),
							temperature: settings.temperature,
							responseFormat: "json_object",
							stream: false,
							system,
							user,
						},
						response: {
							status: httpStatus,
							content,
							finishReason,
							usage,
							rawBody,
							error,
						},
					}),
				);
			} catch (logError) {
				console.error("[email-outreach] 记录 AI 请求日志失败", logError);
			}
		};

		try {
			if (!settings.apiKey.trim()) {
				throw new AIError("未设置 API Key", false);
			}
			if (!settings.model.trim()) {
				throw new AIError("未设置模型名称", false);
			}
			url = buildEndpoint(settings.apiBaseUrl);
			const payload = {
				model: settings.model.trim(),
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
				temperature: settings.temperature,
				response_format: { type: "json_object" },
				stream: false,
			};

			const response = await withTimeout(
				requestUrl({
					url,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${settings.apiKey.trim()}`,
					},
					body: JSON.stringify(payload),
					throw: false,
				}),
				Math.max(10000, settings.timeoutMs),
			);

			httpStatus = response.status;
			rawBody = response.text ?? null;

			if (token?.canceled) throw new CanceledError();

			if (response.status < 200 || response.status >= 300) {
				const retryable = response.status === 429 || response.status >= 500;
				const detail = (response.text ?? "").slice(0, 500);
				throw new AIError(
					`AI 接口返回 ${response.status}${detail ? `：${detail}` : ""}`,
					retryable,
				);
			}

			let data: unknown;
			try {
				data = response.json;
			} catch {
				data = null;
			}
			usage = readUsage(data);
			if (!data || typeof data !== "object") {
				throw new AIError("AI 接口返回的不是 JSON", true);
			}
			const choices = (data as { choices?: unknown }).choices;
			if (!Array.isArray(choices) || choices.length === 0) {
				throw new AIError("AI 接口返回缺少 choices", false);
			}
			const first = choices[0] as {
				message?: { content?: unknown };
				finish_reason?: unknown;
			};
			finishReason =
				typeof first?.finish_reason === "string"
					? first.finish_reason
					: null;
			const content = first?.message?.content;
			if (typeof content !== "string" || !content.trim()) {
				throw new AIError("AI 返回内容为空", false);
			}
			log("ok", content, null);
			return content;
		} catch (error) {
			const canceled = error instanceof CanceledError;
			const message = error instanceof Error ? error.message : String(error);
			log(canceled ? "canceled" : "error", null, message);
			throw error;
		}
	}
}
