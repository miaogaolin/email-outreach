import { App, Modal } from "obsidian";
import type { ColumnPreference } from "../settings";

export class ColumnsModal extends Modal {
	private preferences: ColumnPreference[];
	private resolvePromise: (value: ColumnPreference[] | null) => void =
		() => undefined;

	constructor(
		app: App,
		allKeys: string[],
		current: ColumnPreference[],
	) {
		super(app);
		const currentMap = new Map(current.map((item) => [item.key, item]));
		this.preferences = allKeys.map((key) => ({
			key,
			visible: currentMap.get(key)?.visible ?? false,
			width: currentMap.get(key)?.width,
		}));
		// Keep the user's existing order first.
		this.preferences.sort((a, b) => {
			const ai = current.findIndex((item) => item.key === a.key);
			const bi = current.findIndex((item) => item.key === b.key);
			if (ai >= 0 && bi >= 0) return ai - bi;
			if (ai >= 0) return -1;
			if (bi >= 0) return 1;
			return a.key.localeCompare(b.key, "zh-CN");
		});
	}

	openAndWait(): Promise<ColumnPreference[] | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("eo-modal", "eo-columns-modal");
		contentEl.createEl("h2", { text: "工作台显示哪些属性" });
		contentEl.createEl("p", {
			cls: "eo-muted",
			text: "固定列（选择框、客户、邮件状态）始终显示。勾选要展示的属性，用 ↑↓ 调整顺序。",
		});
		const list = contentEl.createDiv({ cls: "eo-columns-list" });
		const render = (): void => {
			list.empty();
			if (this.preferences.length === 0) {
				list.createDiv({
					cls: "eo-empty",
					text: "没有可显示的属性：请确认客户目录里已有带 frontmatter 的客户笔记。",
				});
			}
			this.preferences.forEach((preference, index) => {
				const row = list.createDiv({ cls: "eo-columns-row" });
				const label = row.createEl("label");
				const checkbox = label.createEl("input", { type: "checkbox" });
				checkbox.checked = preference.visible;
				checkbox.addEventListener("change", () => {
					preference.visible = checkbox.checked;
				});
				label.createSpan({ text: preference.key });
				const up = row.createEl("button", { text: "↑" });
				up.disabled = index === 0;
				up.addEventListener("click", () => {
					const [item] = this.preferences.splice(index, 1);
					this.preferences.splice(index - 1, 0, item!);
					render();
				});
				const down = row.createEl("button", { text: "↓" });
				down.disabled = index === this.preferences.length - 1;
				down.addEventListener("click", () => {
					const [item] = this.preferences.splice(index, 1);
					this.preferences.splice(index + 1, 0, item!);
					render();
				});
			});
		};
		render();

		const buttons = contentEl.createDiv({ cls: "eo-modal-buttons" });
		buttons
			.createEl("button", { text: "恢复默认" })
			.addEventListener("click", () => this.finish([]));
		buttons
			.createEl("button", { text: "取消" })
			.addEventListener("click", () => this.finish(null));
		buttons
			.createEl("button", { cls: "mod-cta", text: "保存" })
			.addEventListener("click", () => {
				this.finish(this.preferences.filter((item) => item.visible));
			});
	}

	private finish(value: ColumnPreference[] | null): void {
		this.resolvePromise(value);
		this.resolvePromise = () => undefined;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
