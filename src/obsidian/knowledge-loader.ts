import { App } from "obsidian";
import { extractWikiLinks } from "../core/wikilinks";
import type { KnowledgeArticle, KnowledgeBundle } from "../core/prompt";
import type { Settings } from "./settings";

export interface KnowledgeLoadResult {
	bundle: KnowledgeBundle | null;
	errors: string[];
}

interface QueueItem {
	target: string;
	sourcePath: string;
	depth: number;
}

export class KnowledgeLoader {
	constructor(
		private app: App,
		private getSettings: () => Settings,
	) {}

	async load(): Promise<KnowledgeLoadResult> {
		const settings = this.getSettings();
		const errors: string[] = [];
		const mainPath = settings.instructionFile.trim();
		if (!mainPath) {
			return { bundle: null, errors: ["未设置 AI 指令文件"] };
		}
		const mainFile = this.app.vault.getAbstractFileByPath(
			mainPath.replace(/\\/g, "/"),
		);
		if (!mainFile || !("extension" in mainFile)) {
			return {
				bundle: null,
				errors: [`指令文件不存在：${mainPath}`],
			};
		}
		const mainContent = await this.app.vault.cachedRead(
			mainFile as import("obsidian").TFile,
		);

		const articles: KnowledgeArticle[] = [];
		const missingLinks: string[] = [];
		const visited = new Set<string>([mainFile.path]);
		const queue: QueueItem[] = [];

		const enqueue = (
			content: string,
			sourcePath: string,
			depth: number,
		): void => {
			if (depth > settings.knowledgeDepth) return;
			for (const link of extractWikiLinks(content)) {
				queue.push({ target: link.target, sourcePath, depth });
			}
		};

		enqueue(mainContent, mainFile.path, 0);

		let totalChars = mainContent.length;
		let truncated = false;

		while (queue.length > 0) {
			if (articles.length >= settings.maxKnowledgeFiles) {
				truncated = true;
				break;
			}
			const item = queue.shift();
			if (!item) break;
			const resolved = this.app.metadataCache.getFirstLinkpathDest(
				item.target,
				item.sourcePath,
			);
			if (!resolved) {
				const label = `[[${item.target}]]`;
				if (!missingLinks.includes(label)) missingLinks.push(label);
				continue;
			}
			if (visited.has(resolved.path)) continue;
			visited.add(resolved.path);
			let content: string;
			try {
				content = await this.app.vault.cachedRead(resolved);
			} catch {
				missingLinks.push(`[[${item.target}]]`);
				continue;
			}
			if (totalChars + content.length > settings.maxKnowledgeChars) {
				truncated = true;
				break;
			}
			totalChars += content.length;
			articles.push({
				path: resolved.path,
				title: resolved.basename,
				content,
			});
			enqueue(content, resolved.path, item.depth + 1);
		}

		const bundle: KnowledgeBundle = {
			mainPath: mainFile.path,
			mainContent,
			articles,
			missingLinks,
			truncated,
			totalChars,
		};
		return { bundle, errors };
	}
}
