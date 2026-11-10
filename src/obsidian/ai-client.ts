import { requestUrl } from "obsidian";
import type { Settings } from "./settings";

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

export class AIClient {
	constructor(private getSettings: () => Settings) {}

	async complete(
		system: string,
		user: string,
		token?: CancelToken,
	): Promise<string> {
		const maxAttempts = 4;
		let lastError: unknown = null;
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			if (token?.canceled) throw new CanceledError();
			try {
				return await this.requestOnce(system, user, token);
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

	private async requestOnce(
		system: string,
		user: string,
		token?: CancelToken,
	): Promise<string> {
		const settings = this.getSettings();
		if (!settings.apiKey.trim()) {
			throw new AIError("未设置 API Key", false);
		}
		if (!settings.model.trim()) {
			throw new AIError("未设置模型名称", false);
		}
		const endpoint = buildEndpoint(settings.apiBaseUrl);
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
				url: endpoint,
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
		if (!data || typeof data !== "object") {
			throw new AIError("AI 接口返回的不是 JSON", true);
		}
		const choices = (data as { choices?: unknown }).choices;
		if (!Array.isArray(choices) || choices.length === 0) {
			throw new AIError("AI 接口返回缺少 choices", false);
		}
		const first = choices[0] as { message?: { content?: unknown } };
		const content = first?.message?.content;
		if (typeof content !== "string" || !content.trim()) {
			throw new AIError("AI 返回内容为空", false);
		}
		return content;
	}
}
