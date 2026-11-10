import { App, Modal } from "obsidian";
import { guessLanguage, languageOptions } from "../../core/language";
import type { CustomerRecord } from "../../core/types";

export interface LanguageChoice {
	record: CustomerRecord;
	code: string;
}

export class LanguageModal extends Modal {
	private choices: LanguageChoice[] = [];
	private resolvePromise: (value: Map<string, string> | null) => void =
		() => undefined;

	constructor(
		app: App,
		private records: CustomerRecord[],
	) {
		super(app);
		this.choices = records.map((record) => {
			const guess = guessLanguage(record.fm["地区"]);
			return { record, code: guess?.code ?? "" };
		});
	}

	openAndWait(): Promise<Map<string, string> | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("eo-modal eo-language-modal");
		contentEl.createEl("h2", { text: "确认邮件语言" });
		contentEl.createEl("p", {
			text: "以下客户无法从「地区」可靠判断邮件语言。请先指定，或让 AI 自行判断。",
		});
		const list = contentEl.createDiv({ cls: "eo-language-list" });
		for (const choice of this.choices) {
			const row = list.createDiv({ cls: "eo-language-row" });
			row.createDiv({
				cls: "eo-language-customer",
				text: choice.record.name,
			});
			const region = choice.record.fm["地区"];
			row.createDiv({
				cls: "eo-language-region",
				text: `地区：${region ? String(region) : "未填写"}`,
			});
			const select = row.createEl("select");
			select.createEl("option", { value: "", text: "让 AI 判断" });
			for (const option of languageOptions()) {
				select.createEl("option", {
					value: option.code,
					text: `${option.label}（${option.code}）`,
				});
			}
			select.value = choice.code;
			select.addEventListener("change", () => {
				choice.code = select.value;
			});
		}
		const buttons = contentEl.createDiv({ cls: "eo-modal-buttons" });
		buttons
			.createEl("button", { text: "取消" })
			.addEventListener("click", () => this.finish(null));
		buttons
			.createEl("button", { cls: "mod-cta", text: "确认并继续" })
			.addEventListener("click", () => {
				const map = new Map<string, string>();
				for (const choice of this.choices) {
					if (choice.code) map.set(choice.record.path, choice.code);
				}
				this.finish(map);
			});
	}

	private finish(value: Map<string, string> | null): void {
		this.resolvePromise(value);
		this.resolvePromise = () => undefined;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
