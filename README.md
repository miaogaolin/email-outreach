# Email Outreach 开发邮件（Obsidian 插件）

在 Obsidian 里完成「筛选客户 → 勾选客户 → 勾选 AI 任务 → 确认 → AI 分析/生成邮件 → 人工审核 → 落盘」的完整闭环。客户资料仍由你维护，AI 规则来自你指定的 Markdown 指令文件及其双链文章，插件不会自动发送邮件。

- 插件 id：`email-outreach`
- 版本：0.1.0
- 源码位置：`.obsidian/plugins/email-outreach/`
- 依赖：Obsidian 1.6+；Bases 工作台需要 1.10+；AI 接口需兼容 OpenAI `chat/completions`

## 功能

- **客户工作台**：复用 Obsidian Bases 的筛选/列/排序（推荐），或使用内置工作台自定义列、组合筛选、多列排序。
- **联系人解析**：本地解析 `## Contact` / `## 联系人`，支持 Tab 缩进、`- 姓名（职位）`、纯姓名行 + 顶级列表、多邮箱、mailto 链接；邮箱绝不跨联系人串用。
- **AI 任务**：客户类型、Opportunity（Fit/Intent/Potential）、Risk、联系人推荐、开发邮件、发送时间建议，可自由组合。
- **结构化输出**：插件固定 JSON 契约并校验；联系人 id、邮箱、评分范围、中文摘要都会被检查，非法结果不落盘。
- **邮件审核**：中文摘要、悬停预览、详情页编辑、重新生成、版本历史、验收/拒绝、标记已发送。
- **单文件沉淀**：每个客户只有一个 `客户名 - AI开发信息.md`，保存分析、全部邮件和修改历史；客户属性里只有一个双链。
- **经验规则**：把修改意见整理成长期规则，人工确认后写入 `Feedback.md`，后续生成自动参考。
- **安全**：未配置不执行；客户属性逐字段确认、冲突默认不覆盖；只有「标记已发送」才改 `跟进次数` / `最近联系时间`。

## 安装与启用

插件源码就在 vault 内，不需要打包安装：

1. 确认 `.obsidian/plugins/email-outreach/main.js`、`manifest.json`、`styles.css` 存在（仓库已包含构建产物）。
2. Obsidian → 设置 → 第三方插件 → 关闭「安全模式」→ 已安装插件里启用 **Email Outreach 开发邮件**。
3. 若看不到，重启 Obsidian。

修改源码后：

```bash
cd ".obsidian/plugins/email-outreach"
npm install --ignore-scripts
npm run build          # 生成 main.js
```

然后在 Obsidian 里关闭/重新启用插件，或重启。

## 首次配置

设置 → **Email Outreach 设置**：

| 配置 | 说明 |
|---|---|
| API 地址 | 默认 `https://api.deepseek.com`，也可填其他 OpenAI 兼容地址 |
| API Key | 优先存 Obsidian `secretStorage`；不可用时存插件 `data.json`（明文，已 git 忽略） |
| 模型名称 | 默认 `deepseek-chat` |
| AI 主指令文件 | 例如 `2. Permanent/AI 邮件开发/Email Instructions.md`（可参考 `docs/Email Instructions 模板.md`） |
| 客户目录 | 例如 `3. Project/客户` |
| 输出目录 | 例如 `4. AI Output/邮件开发`；每个客户在此生成一个 AI 开发信息文件 |
| Feedback 文件 | 留空则用 `输出目录/Feedback.md` |
| 默认排除标签 | 默认 `公海, 共享` |
| 工作台模式 | `Bases 视图（推荐）` / `内置工作台` / 两者 |

三项路径（指令文件、客户目录、输出目录）默认留空，未配置完时执行按钮会拦截并提示。

## 使用流程

1. 打开客户库的 `.base`（如 `3. Project/客户.base`），在视图菜单里新增视图，类型选 **Email Outreach 客户工作台**。
   - 也可以用命令「Email Outreach: 打开客户开发工作台」使用内置工作台。
   - 想快速开始：命令「Email Outreach: 生成示例 Base 文件」。
2. 在视图里用 Base 的筛选/列/排序控制显示内容；勾选客户。
3. 在底部任务栏勾选本次任务，点「执行所选任务」。
4. 确认弹窗查看客户数量、执行内容与请求数，确认后 AI 才开始。
5. 分析确认窗口里逐字段勾选要写入客户 YAML 的内容（冲突字段默认不勾），确认写入。
6. 打开「开发邮件列表」：悬停摘要快速预览，点击行进入详情编辑、重新生成、验收、拒绝。
7. 验收通过后，客户属性 `AI开发信息` 写入一个双链（可在设置里改名/关闭）。
8. 实际发出邮件后，在已验收邮件上点「标记已发送」——这是唯一会 `跟进次数 + 1` 并更新 `最近联系时间` 的操作。

## 数据产物

### AI 开发信息文件

`{输出目录}/{客户名} - AI开发信息.md`，包含：

- frontmatter：`type: AI开发信息`、`customer: "[[客户]]"`、`updated`、`email_count`、`last_status`
- `## AI 分析`：最近一次确认的客户类型、fit/indent/potential/risk、风险说明、未确定字段
- `### 分析历史`：每次写回的一行记录
- `## 邮件`：每封邮件一个 `### 邮件 NNN · 联系人 · 状态` 块（元数据 + Subject + Body + 修改历史）

没有 `customer_path`：客户只靠双链定位，客户改名时 Obsidian 会自动维护链接。

### Feedback.md

人工确认后的长期规则，按日期追加，带来源邮件与客户双链。每次生成邮件都会读取。

### 客户属性写入

| 概念 | 属性 | 规则 |
|---|---|---|
| 客户类型 | `客户类型` | 逐字段确认 |
| Fit / Intent / Potential | `fit` / `indent` / `potential` | 1–10，逐字段确认 |
| Risk | `risk` | 1–10，逐字段确认 |
| AI 开发信息 | `AI开发信息` | 首次验收通过时写入一个双链 |
| 跟进次数 | `跟进次数` | 仅「标记已发送」+1 |
| 最近联系时间 | `最近联系时间` | 仅「标记已发送」写当天 |

风险理由（`risk_notes`）只存在 AI 开发信息文件里，不写客户 YAML。

## 命令

| 命令 | 作用 |
|---|---|
| Email Outreach: 打开客户开发工作台 | 打开内置工作台 |
| Email Outreach: 打开开发邮件列表 | 打开邮件审核列表 |
| Email Outreach: 运行自检 | 检查设置、目录、知识库、联系人解析、Bases 可用性 |
| Email Outreach: 生成示例 Base 文件 | 生成带插件视图的 `.base` |
| Email Outreach: 刷新视图 | 重新读取客户与邮件文件 |

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm run test        # 用 TypeScript API 编译 tests/ 后跑自研 runner
npm run build       # 用 TypeScript 编译器 API 打包成单文件 main.js
npm run dev         # 带 inline sourcemap 的构建
node scripts/smoke-load.cjs            # 用 stub 的 obsidian 模块验证 main.js 可加载
node scripts/dev-parse-report.mjs "D:\workspace\zhang-company\3. Project\客户"
```

说明：

- 打包脚本 `scripts/build.mjs` 用 TypeScript 编译器 API 把 `src/` 编译成 CJS 模块，再包一层极小的模块注册表，输出单文件 `main.js`。**不依赖 esbuild**（在本仓库的开发沙箱里，esbuild 需要 spawn 子进程会失败）。
- 测试不依赖 vitest，`scripts/test.mjs` 编译后在进程内跑 `tests/harness.ts`。
- `.test-build/`、`node_modules/`、`data.json` 都在 `.gitignore` 中。

## 安全与备份

- API Key 优先 `app.secretStorage`；回退明文 `data.json`，不要提交到 Git。
- `.obsidian/` 不在 fast-note-sync 的同步范围（`configSyncEnabled: false`），插件工程请用 git 备份和推送。
- 客户原始文件只会被写入上表中的 6 个属性，且都发生在你确认之后。

## 排错

| 现象 | 处理 |
|---|---|
| 看不到 Bases 视图类型 | Obsidian < 1.10 或 Bases 被关闭；改用内置工作台 |
| 自检显示客户目录不存在 | 检查设置里的目录路径（区分大小写、不要带首尾斜杠） |
| 某客户解析不到联系人 | 文件里需要有 `## Contact` / `## 联系人` 区段；自检会统计「有区段」数量 |
| AI 返回未通过校验 | 详情见通知与控制台；原始响应保存在 `输出目录/.state/` |
| 客户属性没更新 | 分析确认窗口里对应字段未勾选，或值冲突被默认跳过 |
| 邮件列表为空 | 尚未生成邮件，或输出目录配置错误 |

## 已知限制（v0.1）

- 不自动发送、不监控回复、不自动增加跟进次数、不抓取客户网站。
- 每客户每次生成 1 封邮件；换联系人再次生成会产生新的邮件块。
- `indent` 视为 Intent，沿用历史 1–10 数值（旧数据多为 1–3）。
- 手动大幅改写 AI 开发信息文件结构可能导致解析告警；插件只重写邮件块/分析区段，保存前会重新读取文件。
