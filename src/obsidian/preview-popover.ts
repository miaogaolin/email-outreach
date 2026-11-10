export class PreviewController {
	private el: HTMLElement | null = null;
	private timer: number | null = null;
	private anchor: HTMLElement | null = null;

	attach(anchor: HTMLElement, build: (target: HTMLElement) => void): void {
		anchor.addClass("eo-preview-anchor");
		anchor.addEventListener("mouseenter", () => {
			this.cancel();
			this.anchor = anchor;
			this.timer = window.setTimeout(() => {
				this.show(anchor, build);
			}, 300);
		});
		anchor.addEventListener("mouseleave", () => this.hide());
		anchor.addEventListener("click", () => this.hide());
	}

	private cancel(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private show(anchor: HTMLElement, build: (target: HTMLElement) => void): void {
		this.hide();
		const popover = document.body.createDiv({ cls: "eo-preview" });
		build(popover);
		const rect = anchor.getBoundingClientRect();
		const width = 380;
		popover.style.width = `${width}px`;
		const left = Math.min(
			Math.max(8, rect.left),
			window.innerWidth - width - 8,
		);
		popover.style.left = `${left}px`;
		const estimatedHeight = 240;
		const top =
			rect.bottom + estimatedHeight + 8 < window.innerHeight
				? rect.bottom + 8
				: Math.max(8, rect.top - estimatedHeight - 8);
		popover.style.top = `${top}px`;
		this.el = popover;
	}

	hide(): void {
		this.cancel();
		if (this.el) {
			this.el.remove();
			this.el = null;
		}
		this.anchor = null;
	}

	destroy(): void {
		this.hide();
	}
}
