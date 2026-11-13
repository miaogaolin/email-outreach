# Email Outreach 开发邮件（Obsidian 插件）

在 Obsidian 里完成「筛选客户 → 勾选客户 → 生成开发邮件 → 人工审核 → 落盘」的完整闭环。客户资料仍由你维护，AI 规则来自你指定的 Markdown 指令文件及其双链文章，插件不会自动发送邮件。

- 插件 id：`email-outreach`
- 版本：0.1.2
- 仓库：[miaogaolin/email-outreach](https://github.com/miaogaolin/email-outreach)
- 源码位置：`.obsidian/plugins/email-outreach/`
- 依赖：Obsidian 1.6+；Bases 工作台需要 1.10+；AI 接口需兼容 OpenAI `chat/completions`

## 功能

- **客户工作台**：复用 Obsidian Bases 的筛选/列/排序（推荐），或使用内置工作台自定义列、组合筛选（同一属性可选多个值，任一命中）、多列排序。
  - 勾选/取消客户只更新对应行和底部计数，不重绘整张表。
  - 固定的「联系人」列显示每家解析到的联系人数量（没有则 `0`），点击数字查看联系人详情；点击行不再打开联系人。
- **联系人解析**：本地解析 `## Contact` / `## 联系人`，支持 Tab 缩进、`- 姓名（职位）`、纯姓名行 + 顶级列表、多邮箱、mailto 链接；邮箱绝不跨联系人串用。
- **开发邮件生成**：勾选客户后一键生成。只为有邮箱且适合的联系人写信，一个客户可以生成多封；没有合适联系人的客户会在工作台「开发状态」列和邮件列表里提醒。
- **发送时间**：生成时按客户地区时区、`跟进次数`、`最近联系时间` 和已发送邮件记录计算建议发送时间（客户当地时间 + 北京时间对照），同客户多封按工作日错峰。
- **结构化输出**：插件固定 JSON 契约并校验；联系人 id、邮箱、每封邮件的中文摘要都会被检查，非法邮件会被丢弃并告警，全部非法才重试。
- **邮件审核**：中文摘要、悬停预览、详情页编辑、重新生成、版本历史、验收/拒绝、标记已发送。
  - 「重新生成」有进度条（当前步骤、已等待秒数、失败原因），执行期间按钮禁用，避免重复提交。
  - 重新生成只把**输出目录里已落盘的版本**当作「原邮件」：详情页里没点「保存修改」的 Subject/Body 不会发给 AI，界面会提示有未保存修改。
- **单文件沉淀**：每个客户只有一个 `客户名 - AI开发信息.md`，保存全部邮件和修改历史；客户属性里只有一个双链。
- **经验规则**：把修改意见整理成长期规则，人工确认后写入 `Feedback.md`，后续生成自动参考。
- **AI 请求日志**：设置页最底部逐条查看每次真正发给 AI 的完整系统提示词、用户提示词、模型参数、耗时、原始返回与错误；可复制单条/全部，也可一键清除。
- **安全**：未配置不执行；只写验收双链和「标记已发送」的跟进字段；旧分析区段只读不覆盖。

## 安装与启用

### 方式一：BRAT（推荐）

本插件不在社区插件市场，使用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 按 GitHub Release 安装和更新：

1. 在社区插件市场安装并启用 **BRAT**。
2. 命令面板执行 `BRAT: Add a beta plugin for testing`，输入 `miaogaolin/email-outreach`。
3. 回到 设置 → 第三方插件，启用 **Email Outreach 开发邮件**。
4. 之后 BRAT 会检查新 Release；每次发布都会附带 `main.js`、`manifest.json`、`styles.css`。

> BRAT 只能直接安装公开仓库；仓库需保持 public，Release 资产由 tag 触发自动构建上传。

### 方式二：本地源码（开发）

插件源码就在 vault 内，可直接加载：

1. 确认 `.obsidian/plugins/email-outreach/main.js`、`manifest.json`、`styles.css` 存在（仓库已包含构建产物）。
2. Obsidian → 设置 → 第三方插件 → 关闭「安全模式」→ 已安装插件里启用 **Email Outreach 开发邮件**。
3. 若看不到，重启 Obsidian。

修改源码后：

```bash
cd ".obsidian/plugins/email-outreach"
npm install --ignore-scripts
npm run build          # 生成 main.js
```

然后在 Obsidian 里关闭/重新启用插件，或重启。Obsidian 正在运行时可能占用 `main.js`，构建报 `EPERM` 时先退出 Obsidian 再构建。

### 发布新版本（维护者）

1. 更新 `manifest.json` 的 `version`，并把同一版本写进 `versions.json`（`"版本": "minAppVersion"`）。
2. `npm run test && npm run build`，提交。
3. `git tag 0.2.0 && git push origin main --tags`（tag 必须与 `manifest.json` 的 `version` 一致，允许 `v` 前缀）。
4. GitHub Actions（`.github/workflows/release.yml`）在 tag 上执行 typecheck/test/build，创建 Release 并上传 `main.js`、`manifest.json`、`styles.css`；BRAT 读取最新 Release。

## 首次配置

设置 → **Email Outreach 设置**：

| 配置 | 说明 |
|---|---|
| API 地址 | 默认 `https://api.deepseek.com`，也可填其他 OpenAI 兼容地址 |
| API Key | 优先存 Obsidian `secretStorage`；不可用时存插件 `data.json`（明文，已 git 忽略） |
| 模型名称 | 默认 `deepseek-flash`；可点右侧「获取模型列表」从当前 API 地址读取实际可用的模型，再从下拉框选择（DeepSeek 现提供 `deepseek-flash` 与 `deepseek-v4-pro`，旧名 `deepseek-chat` 已于 2026-07-24 下线） |
| AI 主指令文件 | 例如 `2. Permanent/AI 邮件开发/Email Instructions.md`（可省略 `.md`，也接受 `[[双链]]`；可参考 `docs/Email Instructions 模板.md`） |
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
2. 在视图里用 Base 的筛选/列/排序控制显示内容；勾选客户。筛选条件变化后，被筛掉的客户会自动从已选中移除。
3. 在底部点「生成开发邮件」。插件会先解析联系人；没有联系人邮箱的客户不调用 AI，并在「开发状态」列标记。
4. 确认弹窗查看客户数量与生成规则，确认后 AI 才开始；一个客户可能为多位适合联系人各生成一封，每客户最多 5 封。
5. 打开「开发邮件列表」：客户名是双链（点开客户笔记），列表带统一的「更新时间」；悬停摘要快速预览，点击行进入详情编辑、重新生成、验收、拒绝。建议发送时间和时间理由都在详情里。
6. 验收通过后，客户属性 `AI开发信息` 写入一个双链（可在设置里改名/关闭）。
7. 实际发出邮件后，在已验收邮件上点「标记已发送」——这是唯一会 `跟进次数 + 1` 并更新 `最近联系时间` 的操作，也会影响下次生成的发送时间。

## 数据产物

### AI 开发信息文件

`{输出目录}/{客户名} - AI开发信息.md`，包含：

- frontmatter：`type: AI开发信息`、`customer: "[[客户]]"`、`updated`、`email_count`、`last_status`
- `## AI 分析`：旧版本生成的分析区段仍会保留；新版本不再写入分析字段，只把已有分析作为写邮件的参考
- `## 邮件`：每封邮件一个 `### 邮件 NNN · 联系人 · 状态` 块（元数据 + Subject + Body + 修改历史）；一个客户的多位联系人会生成多个块，ID 连续

每封邮件的 `updated_at` 就是列表里的「更新时间」：首次生成时等于创建时间，之后保存修改、重新生成、验收/拒绝、标记已发送都会刷新它。

没有 `customer_path`：客户只靠双链定位，客户改名时 Obsidian 会自动维护链接。

### `.state/last-run.json`

保存上次执行的客户开发状态（已生成 N 封 / 无可用联系人 / 未找到合适联系人 / 执行失败），用于工作台「开发状态」列和邮件列表顶部提醒。它不参与邮件列表扫描。

### `.state/ai-log.jsonl`

每次真正发给 AI 的请求追加一行 JSON：完整系统提示词、用户提示词、模型与参数、HTTP 状态、原始返回、tokens、耗时、重试次数和错误。设置页最底部的「AI 请求日志」读取它，最多保留最近 50 条；点「清除日志」会同时清空内存和这个文件。未设置输出目录时日志只保留在本次会话。

### Feedback.md

人工确认后的长期规则，按日期追加，带来源邮件与客户双链。每次生成邮件都会读取。

### 客户属性写入

| 概念 | 属性 | 规则 |
|---|---|---|
| AI 开发信息 | `AI开发信息` | 验收通过时写入一个双链 |
| 跟进次数 | `跟进次数` | 仅「标记已发送」+1 |
| 最近联系时间 | `最近联系时间` | 仅「标记已发送」写当天 |

新版本不再自动写入 `客户类型` / `fit` / `indent` / `potential` / `risk`。旧 AI 文件里的分析区段仍会作为写邮件上下文读取。

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
| 工作台显示「无可用联系人」 | 客户笔记没有 `## Contact` / `## 联系人` 区段，或联系人都没有邮箱 |
| 工作台显示「未找到合适联系人」 | AI 认为没有适合发送开发邮件的联系人；把鼠标悬停在状态上可看原因 |
| 邮件列表为空 | 尚未生成邮件，或输出目录配置错误 |

## 已知限制（v0.1）

- 不自动发送、不监控回复、不自动增加跟进次数、不抓取客户网站。
- 每客户每次最多生成 5 封邮件（多位适合联系人）；同一联系人再次生成会产生新的邮件块。
- 发送时间是规则计算（工作日 09:30 客户当地时间，跟进间隔 3/5/7 个工作日），不考虑客户当地节假日；多时区国家按城市关键词或国家默认时区。
- 旧 AI 文件里的分析区段保留；新版本不再生成或写回分析字段。
- 手动大幅改写 AI 开发信息文件结构可能导致解析告警；解析失败时插件不会覆盖该文件。
