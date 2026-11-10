import { TASK_LABELS } from "../core/types";
import type { TaskSelection } from "../core/types";

const TASK_ORDER: (keyof TaskSelection)[] = [
	"customerType",
	"opportunity",
	"risk",
	"contactRecommendation",
	"email",
	"sendTime",
];

export interface TaskBarOptions {
	tasks: TaskSelection;
	onChange: (tasks: TaskSelection) => void;
	onRun: () => void;
	selectedCount: number;
	running?: boolean;
}

export function renderTaskBar(
	container: HTMLElement,
	options: TaskBarOptions,
): void {
	container.empty();
	container.addClass("eo-taskbar");

	const heading = container.createDiv({ cls: "eo-taskbar-heading" });
	heading.createSpan({ text: "本次 AI 执行任务" });
	heading.createSpan({
		cls: "eo-selected-count",
		text: `已选 ${options.selectedCount} 家`,
	});

	const grid = container.createDiv({ cls: "eo-task-grid" });
	for (const key of TASK_ORDER) {
		const label = grid.createEl("label", { cls: "eo-task-item" });
		const input = label.createEl("input", { type: "checkbox" });
		input.checked = options.tasks[key];
		const disabled = key === "sendTime" && !options.tasks.email;
		input.disabled = key === "contactRecommendation" && options.tasks.email;
		if (disabled) label.addClass("is-disabled");
		input.addEventListener("change", () => {
			const next: TaskSelection = { ...options.tasks, [key]: input.checked };
			if (key === "email" && input.checked) {
				next.contactRecommendation = true;
			}
			if (key === "email" && !input.checked) {
				next.sendTime = false;
			}
			if (key === "sendTime" && !next.email) {
				next.sendTime = false;
			}
			options.onChange(next);
		});
		label.createSpan({ text: TASK_LABELS[key] });
	}

	const footer = container.createDiv({ cls: "eo-taskbar-footer" });
	const hint = footer.createDiv({ cls: "eo-task-hint" });
	const anyTask = TASK_ORDER.some((key) => options.tasks[key]);
	if (!anyTask) hint.setText("请至少勾选一项任务");
	else if (options.selectedCount === 0) hint.setText("请至少勾选一个客户");
	else if (options.tasks.email || options.tasks.contactRecommendation) {
		hint.setText("生成邮件会自动选择收件人；所有结果都需要你审核后才写回客户文件");
	}

	const runButton = footer.createEl("button", {
		cls: "mod-cta eo-run-button",
		text: options.running
			? "正在执行…"
			: `执行所选任务（${options.selectedCount} 家）`,
	});
	runButton.disabled =
		options.running || !anyTask || options.selectedCount === 0;
	runButton.addEventListener("click", () => options.onRun());
}
