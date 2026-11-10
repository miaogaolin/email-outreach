# Email Outreach 项目约定（Agent 指令）

本目录是 Obsidian 插件 **Email Outreach** 的源码与构建产物，独立 git 仓库。根目录另有 vault 级 `AGENTS.md`；本文件优先级更高。

## 定位与边界

- 插件只做：筛选客户、解析联系人、调用 AI、审核、把结果写回 Markdown。
- **不发送邮件**，不监控回复，不抓客户网站。
- 客户原始笔记只允许写：`客户类型`、`fit`、`indent`、`potential`、`risk`、`AI开发信息`、`跟进次数`、`最近联系时间`。
  - 前 6 项必须经过用户在「分析确认」里逐字段勾选。
  - `跟进次数` / `最近联系时间` 只能由「标记已发送」更新。
- AI 输出结构由插件定义（`src/core/schema.ts`），指令文件只能提供业务知识，不能改变字段。

## 目录结构

```
src/core/       纯 TS：解析、校验、提示词、文件格式、筛选、语言表（禁止 import "obsidian"）
src/obsidian/   Obsidian 层：设置、视图、Bases、模态框、AI 客户端、流水线
tests/          自研 runner（tests/harness.ts）+ fixtures
scripts/        build.mjs / test.mjs / smoke-load.cjs / dev-parse-report.mjs
main.js         构建产物（纳入 git，便于回滚到可用状态）
styles.css      手写样式（不是产物）
```

## 命令

```bash
npm install --ignore-scripts
npm run typecheck
npm run test
npm run build
node scripts/smoke-load.cjs
```

沙箱/CI 里不要用 esbuild、vitest：它们会 spawn 子进程，在受限环境直接失败。构建与测试都必须保持「纯 Node 进程内」。

## 架构红线

1. `src/core/**` 不得 `import "obsidian"`；所有 Obsidian API 只能在 `src/obsidian/**`。
2. AI 返回必须先 `parseJsonLoose` → `validateAIResult` → 才能落盘。禁止跳过校验。
3. 收件邮箱只能来自本地联系人解析结果；AI 返回的邮箱仅用于比对。
4. 写客户 frontmatter 只能经 `adapter.updateFrontmatter`，且写入值来自用户勾选的 `FieldCandidate`。
5. 修改邮件只能在原邮件块上追加版本（`addEmailVersion`），不新建「副本文件」。
6. 一个客户 = 一个 `{客户名} - AI开发信息.md`；客户属性只放一个双链（默认 `AI开发信息`）。
7. API 失败/取消不得删除已生成内容；未确认分析写 `{输出目录}/.state/`。

## 数据契约不变式

- AI 开发信息文件：`src/core/ai-file.ts` 的 `renderCustomerAIFile` / `parseCustomerAIFile` 必须保持往返一致（`tests/ai-file.test.ts`）。
- 邮件块标题格式：`### 邮件 NNN · 联系人 · 状态`；元数据为 `- key: value`；版本用动态加长反引号围栏。
- 不写 `customer_path`；客户定位只用 `customer: "[[...]]"`。
- 评分 1–10（允许 .5）；`unknown_fields` 中的字段一律按 null 处理。
- `email_summary_zh` 必须简体中文，30–60 字仅告警、不拦截。

## 改动流程

1. 先改 `src/core` 并补测试，`npm run test` 通过。
2. 再接 `src/obsidian`，`npm run typecheck` 通过。
3. `npm run build` + `node scripts/smoke-load.cjs`。
4. 在 Obsidian 里手动验证（重载插件），把结论写进提交正文。
5. 提交。

## 常见坑

- 联系人标题有 `## Contact` 和 `## 联系人` 两种；Tab 缩进要先换成 4 空格。
- 有的客户用「纯姓名行 + 顶级列表」，不要把它们误判成多个联系人（见 `looksLikeNameLine`）。
- 中文文件名清洗：`sanitizeFileName`。
- `app.secretStorage` 可能不存在，必须回退到 `data.json`。
- Bases API 自 1.10 起提供，但类型与行为仍在演进；只依赖 `data` / `config` / `onDataUpdated`，不要缓存 `entry` / `view.data` 引用。
- 客户改名时双链会自动更新，但 AI 文件名不会自动改；有「同步 AI 文件名」需求时另做命令。
- `.obsidian/` 不被 vault 索引，也不是 fast-note-sync 的同步对象；备份靠 git push。

## 提交约定

- 前缀：`feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `build:` / `chore:`。
- 每个可验证阶段一次提交；提交正文写「为什么」和手动验证结论。
- 不要把 `data.json`（含 API Key）、`node_modules/`、`.test-build/`、`.npm-cache/` 提交进去。
