import { App, Modal } from "obsidian";

export interface ConfirmOptions {
	title: string;
	confirmText?: string;
	cancelText?: string;
	danger?: boolean;
	build: (container: HTMLElement) => void;
}

class ConfirmModal extends Modal {
	private resolved = false;
	private resolvePromise: (value: boolean) => void = () => undefined;

	constructor(
		app: App,
		private options: ConfirmOptions,
	) {
		super(app);
	}

	openAndWait(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("eo-modal");
		contentEl.createEl("h2", { text: this.options.title });
		const body = contentEl.createDiv({ cls: "eo-confirm-body" });
		this.options.build(body);
		const buttons = contentEl.createDiv({ cls: "eo-modal-buttons" });
		buttons
			.createEl("button", { text: this.options.cancelText ?? "取消" })
			.addEventListener("click", () => this.finish(false));
		const confirm = buttons.createEl("button", {
			cls: this.options.danger ? "mod-warning" : "mod-cta",
			text: this.options.confirmText ?? "确认",
		});
		confirm.addEventListener("click", () => this.finish(true));
	}

	private finish(value: boolean): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolvePromise(value);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.resolved = true;
			this.resolvePromise(false);
		}
	}
}

export function confirm(app: App, options: ConfirmOptions): Promise<boolean> {
	return new ConfirmModal(app, options).openAndWait();
}

export class ProgressModal extends Modal {
	private messageEl: HTMLElement | null = null;
	private detailEl: HTMLElement | null = null;
	private onCancel: (() => void) | null = null;

	constructor(app: App) {
		super(app);
	}

	setOnCancel(callback: () => void): void {
		this.onCancel = callback;
	}

	setMessage(message: string, detail = ""): void {
		if (this.messageEl) this.messageEl.setText(message);
		if (this.detailEl) this.detailEl.setText(detail);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("eo-modal");
		contentEl.createEl("h2", { text: "AI 正在执行" });
		this.messageEl = contentEl.createDiv({ cls: "eo-progress-message" });
		this.detailEl = contentEl.createDiv({
			cls: "eo-progress-detail",
			text: "准备中…",
		});
		const bar = contentEl.createDiv({ cls: "eo-progress-bar" });
		bar.createDiv({ cls: "eo-progress-bar-inner" });
		const buttons = contentEl.createDiv({ cls: "eo-modal-buttons" });
		const cancel = buttons.createEl("button", { text: "取消" });
		cancel.addEventListener("click", () => {
			this.onCancel?.();
			this.setMessage("正在取消…", "已完成的客户会保留");
			cancel.disabled = true;
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
