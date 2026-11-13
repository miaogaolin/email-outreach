import { App, TFile } from "obsidian";
import { fileSettingCandidates } from "../core/filenames";
import { extractWikiLinks } from "../core/wikilinks";
import type { KnowledgeArticle, KnowledgeBundle } from "../core/prompt";
import type { Settings } from "./settings";

export interface KnowledgeLoadResult {
	bundle: KnowledgeBundle | null;
	errors: string[];
}

export interface InstructionFileResolution {
	file: TFile | null;
	/** Paths queried in order, kept for diagnostics. */
	tried: string[];
	/** Real vault paths when several files share the requested basename. */
	duplicates: string[];
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

	/**
	 * Resolve the configured instruction file, tolerating the usual user
	 * mistakes: leading slashes, backslashes, wikilink/quote wrappers and a
	 * missing `.md` extension. If nothing matches by path, fall back to the
	 * metadata cache and then to a unique basename match.
	 */
	resolveMainFile(rawPath: string): InstructionFileResolution {
		const tried = fileSettingCandidates(rawPath);
		for (const candidate of tried) {
			const item = this.app.vault.getAbstractFileByPath(candidate);
			if (item instanceof TFile) {
				return { file: item, tried, duplicates: [] };
			}
		}
		const target = tried[0] ?? "";
		if (!target) return { file: null, tried, duplicates: [] };

		// Handles bare names and paths that Obsidian knows by linkpath.
		const byLink = this.app.metadataCache.getFirstLinkpathDest(target, "");
		if (byLink) return { file: byLink, tried, duplicates: [] };

		const baseName = (target.split("/").pop() ?? "")
			.replace(/\.md$/i, "")
			.toLowerCase();
		if (!baseName) return { file: null, tried, duplicates: [] };
		const matches = this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.basename.toLowerCase() === baseName);
		if (matches.length === 1) {
			return { file: matches[0]!, tried, duplicates: [] };
		}
		return {
			file: null,
			tried,
			duplicates: matches.map((file) => file.path),
		};
	}

	async load(): Promise<KnowledgeLoadResult> {
		const settings = this.getSettings();
		const errors: string[] = [];
		const rawPath = settings.instructionFile.trim();
		if (!rawPath) {
			return { bundle: null, errors: ["未设置 AI 指令文件"] };
		}
		const resolution = this.resolveMainFile(rawPath);
		if (!resolution.file) {
			if (resolution.duplicates.length > 0) {
				return {
					bundle: null,
					errors: [
						`指令文件不唯一：${rawPath} 匹配到 ${resolution.duplicates.join("、")}，请填写完整路径`,
					],
				};
			}
			return {
				bundle: null,
				errors: [
					`指令文件不存在：${rawPath}（已尝试：${resolution.tried.join("、")}）`,
				],
			};
		}
		const mainFile = resolution.file;
		const mainContent = await this.app.vault.cachedRead(mainFile);

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
