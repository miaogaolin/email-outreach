/**
 * 解析 OpenAI 兼容接口 `GET /models` 的返回。
 *
 * 官方接口返回 `{ object: "list", data: [{ id, object, owned_by }] }`；
 * 不同兼容服务（Ollama、LM Studio、各类中转）也会返回
 * `{ models: [{ name }] }` 或直接一个字符串数组。这里统一抽成模型 id 列表，
 * 保持服务端顺序并去重，避免界面顺序每次刷新都变。
 */

const MAX_MODELS = 500;

function modelIdOf(item: unknown): string {
	if (typeof item === "string") return item.trim();
	if (!item || typeof item !== "object") return "";
	const record = item as Record<string, unknown>;
	for (const key of ["id", "name", "model"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "";
}

export function parseModelList(payload: unknown): string[] {
	const candidates: unknown[] = [];
	if (Array.isArray(payload)) {
		candidates.push(...payload);
	} else if (payload && typeof payload === "object") {
		const record = payload as Record<string, unknown>;
		for (const key of ["data", "models"]) {
			const value = record[key];
			if (Array.isArray(value)) candidates.push(...value);
		}
	}

	const seen = new Set<string>();
	const models: string[] = [];
	for (const item of candidates) {
		const id = modelIdOf(item);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		models.push(id);
		if (models.length >= MAX_MODELS) break;
	}
	return models;
}

/**
 * 由用户填写的 base URL 推导 `GET /models` 地址。
 * 允许直接粘贴 chat 端点（`.../chat/completions`）或已是 `.../models`。
 * base URL 为空时返回 null，由调用方给出「未设置 API 地址」。
 */
export function modelsEndpoint(baseUrl: string): string | null {
	const trimmed = baseUrl.trim().replace(/\/+$/, "");
	if (!trimmed) return null;
	if (trimmed.endsWith("/models")) return trimmed;
	const base = trimmed.endsWith("/chat/completions")
		? trimmed.slice(0, -"/chat/completions".length)
		: trimmed;
	return `${base}/models`;
}
