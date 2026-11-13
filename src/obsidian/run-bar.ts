export interface RunBarOptions {
	selectedCount: number;
	onRun: () => void;
	running?: boolean;
}

export interface RunBarHandle {
	updateSelectedCount(count: number): void;
}

/**
 * 底部只保留一个动作：为已勾选客户生成开发邮件。
 * 不再渲染分析/评分/发送时间等任务复选框。
 */
export function renderRunBar(
	container: HTMLElement,
	options: RunBarOptions,
): RunBarHandle {
	container.empty();
	container.addClass("eo-taskbar");

	const heading = container.createDiv({ cls: "eo-taskbar-heading" });
	heading.createSpan({ text: "本次执行：生成开发邮件" });
	const countEl = heading.createSpan({ cls: "eo-selected-count" });

	const summary = container.createDiv({ cls: "eo-run-summary" });
	summary.setText(
		"只为有邮箱且适合的联系人生成，一个客户可能生成多封；发送时间按客户地区与跟进节奏自动计算；没有合适联系人的客户会在列表里提醒。",
	);

	const footer = container.createDiv({ cls: "eo-taskbar-footer" });
	const hint = footer.createDiv({ cls: "eo-task-hint" });

	const runButton = footer.createEl("button", {
		cls: "mod-cta eo-run-button",
	});

	const apply = (count: number): void => {
		countEl.setText(`已选 ${count} 家`);
		hint.setText(
			count === 0
				? "请至少勾选一个客户"
				: "生成后到「开发邮件列表」审核，插件不会自动发送邮件",
		);
		runButton.setText(
			options.running ? "正在生成…" : `生成开发邮件（${count} 家）`,
		);
		runButton.disabled = Boolean(options.running) || count === 0;
	};
	apply(options.selectedCount);

	runButton.addEventListener("click", () => options.onRun());

	return { updateSelectedCount: apply };
}
