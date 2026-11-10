# Email Outreach 设计说明

## 目标

在 Obsidian 内完成「筛选客户 → 勾选任务 → AI 分析/写邮件 → 人工审核 → 写回 Markdown」，AI 规则由用户的知识库决定，插件只固定输出结构与安全边界。

## 模块地图

| 模块 | 职责 |
|---|---|
| `core/contact-parser.ts` | 解析 `## Contact` / `## 联系人`；两种写法：列表项姓名 + 缩进子项，纯姓名行 + 顶级列表 |
| `core/ai-file.ts` | AI 开发信息文件的渲染与解析（往返一致）；邮件块、版本历史、分析区段 |
| `core/schema.ts` | AI JSON 校验：评分范围、联系人 id、邮箱比对、摘要、语言、时间格式 |
| `core/prompt.ts` | 固定 system 契约 + 业务知识注入 + 分析/邮件/规则三类 user prompt |
| `core/merge.ts` | 客户属性写入计划：空字段默认勾选，冲突默认不勾 |
| `core/filters.ts` | 内置工作台的属性筛选、排除规则、类型推断 |
| `core/language.ts` | 国家/地区 → 语言 + IANA 时区；未知地区返回 null 触发人工确认 |
| `obsidian/pipeline.ts` | 批量编排：并发、重试、取消、失败隔离、邮件即时落盘 |
| `obsidian/bases-view.ts` | 自定义 Bases 视图：复用 Base 的筛选/列/排序，加固定列与任务栏 |
| `obsidian/email-store.ts` | 扫描输出目录，聚合所有 AI 文件中的邮件行 |
| `obsidian/main.ts` | 生命周期、命令、视图注册、审核动作、属性写回、规则沉淀 |

## 关键决策

1. **一个客户一个 AI 文件**：`{客户名} - AI开发信息.md`。分析、全部邮件、版本历史都在一起；客户属性只放一个 `AI开发信息` 双链。多次生成不会产生副本文件。
2. **客户定位只用双链**：`customer: "[[...]]"`，不存路径；客户改名由 Obsidian 维护链接，失效时按 basename 兜底。
3. **收件人来自本地解析**：AI 选 `contact_id`，插件从本地联系人取邮箱，AI 给的邮箱只用于比对，防止幻觉地址。
4. **评分 1–10**：与 vault 现有 `fit` / `potential` / `indent` / `risk` 一致（历史值含 .5）。
5. **风险理由不进客户 YAML**：`risk_notes` 只存 AI 文件；客户 YAML 只写数字 `risk`。
6. **写回逐字段确认**：冲突默认不覆盖；写前快照到 `.state`。
7. **只有「标记已发送」改跟进字段**：验收（Accepted）只代表内容通过，不代表已发送。
8. **Bases 优先，内置兜底**：Bases 1.10+ 提供 `registerBasesView`；不注册 `options`，只依赖 `data/config/onDataUpdated`。
9. **构建不依赖子进程**：沙箱禁止 spawn，`scripts/build.mjs` 用 TypeScript API 编译 + 自定义 CJS 注册表输出单文件 `main.js`。

## 数据流

```
Bases/内置工作台 ──勾选──▶ runTasks
   │                          │
   │ 知识库加载：主指令 + [[双链]] 文章（深度/字数上限）
   │ 确认弹窗（客户数、任务、请求数）
   ▼
Pipeline（并发 1–5）
   ├─ 解析联系人（本地）
   ├─ 分析请求（可选）→ 校验 → 内存暂存
   ├─ 邮件请求（可选）→ 校验 → 立即写入 AI 文件（状态 Generated）
   └─ 失败：原始响应写 {输出目录}/.state/
   ▼
分析确认窗口（逐字段勾选）→ 写客户 YAML + AI 文件分析区段
   ▼
邮件列表（悬停预览 / 详情）→ 编辑/重生成（追加版本）→ 验收/拒绝
   ▼
验收通过：状态 Accepted + 客户属性写一个双链
   ▼
标记已发送：sent=true + 跟进次数+1 + 最近联系时间=当天
   ▼
保存为长期规则 → Feedback.md → 下次生成自动参考
```

## 文件格式不变式

- 邮件块标题：`### 邮件 NNN · 联系人 · 状态`。
- 元数据：`- key: value`，单行；中文摘要、时间理由都在这里。
- `#### Subject` / `#### Body` / `#### 修改历史`。
- 版本围栏：反引号数量 = 内容中最长反引号串 + 1（最少 4），避免正文含 ``` 时错位。
- 顶层 YAML：`type`、`customer`、`updated`、`email_count`、`last_status`；不写 `customer_path`。

## 安全边界

- 未配置完整不执行；确认弹窗之前不发起任何请求。
- AI 输出必须过校验；不合法就重试一次，仍失败只报错不落盘。
- 客户原始文件只改允许的 8 个属性；其他内容不动。
- 不发送邮件、不抓网站、不自动加跟进次数。

## 验证方式

- `npm run typecheck`、`npm run test`（34 项）、`npm run build`、`node scripts/smoke-load.cjs`。
- 真实客户库抽样：`node scripts/dev-parse-report.mjs "<客户目录>"`（当前 477 个文件、103 个联系人人区段、约 155 个可发邮件联系人）。
- Obsidian 内手动验收：启用插件 → 配置 → Bases 视图勾选 → 执行 → 审核 → 详情编辑 → 验收。
