# 方案：按「最近生成邮件时间」筛选客户，并阻止短时间内重复生成

> **v3 修订（2026-11-17）**：
> 1. 在**「开发状态」单元格内**增加「✉」入口，直接跳到**这个客户**的邮件列表（带客户筛选，可一键清除）。
> 2. 邮件列表对「同一客户 + 同一邮箱」的多条待审邮件**只保留最新一封显示**；被隐藏的可以一键展开，不删除任何数据。
> 3. 已确认：同邮箱最新一封已验收时，旧待审**隐藏**（避免验收后旧草稿又冒出来）。
>
> **v2 修订（2026-11-16）**：确认现有「开发状态」列与时间无关，且每次执行后会被其他客户的状态覆盖。本版把它与「最近生成」**合并成一个时间感知的「开发状态」列**，并把每个客户的「上次尝试结果」持久化，不再随批次丢失。
>
> 状态：已实现（2026-11-17）。实现与本文的差异：
> - 新增 `core/generation.ts`、`core/dev-state.ts`、`core/email-list.ts`、`obsidian/dev-status-cell.ts`；
> - `.state/customer-status.json` 的解析放在 `core/run-status.ts`（`parseCustomerStatusFile`），`state-store` 只负责读写；
> - 插件 API 除 `getGenerationIndex(records?)` 外增加 `getGenerationReport(records?)`，让视图同时拿到「无法对应客户」的 AI 文件；
> - 默认筛选保持「不限」（`generationFilter.mode = "off"`），与第 5.5 节一致；
> - 「运行中防双击」用 `plugin.isRunning()` 驱动 `run-bar` 的 `running`，在 `runTasks` 入口拒绝并发调用。
> 涉及：`src/core/generation.ts`（新增）、`src/core/dev-state.ts`（新增）、`src/core/email-list.ts`（新增）、`src/core/run-status.ts`、`src/core/filters.ts`、`src/core/settings.ts`、`src/obsidian/state-store.ts`、`src/obsidian/main.ts`、`src/obsidian/table.ts`、`src/obsidian/dev-status-cell.ts`（新增）、`src/obsidian/workbench-view.ts`、`src/obsidian/bases-view.ts`、`src/obsidian/email-store.ts`、`src/obsidian/email-list-view.ts`、`src/obsidian/settings.ts`、`src/obsidian/settings-tab.ts`、`src/obsidian/plugin-api.ts`、`src/obsidian/modals/confirm.ts`、`styles.css`

## 0. 一句话方案

**不往客户笔记里写任何新字段**：从输出目录的 `{客户名} - AI开发信息.md` 里每封邮件的 `generated_at` 只读推导「客户最近一次有效生成邮件的时间」，并把现有「开发状态」改造成一个时间感知的列：

1. 一个合并后的「开发状态」列：主行 = 最近生成时间，副行 = 上次尝试的未解决提醒（无联系人 / 上次失败），可排序；
2. 一个「生成时间」筛选：`不限 / ≥N 天未生成 / N 天内生成过 / 从未生成`；
3. 生成前的 24 小时冷却守卫：勾选的客户里，24 小时内已有有效邮件的默认跳过，可显式强制；
4. 每个客户的「上次尝试结果」持久化到 `.state/customer-status.json`，跨批次保留，不再被下一次执行覆盖；
5. 在「开发状态」单元格内提供「✉」入口，一键打开**该客户**的邮件列表；
6. 邮件列表按「同一客户 + 同一邮箱」合并待审邮件，只显示更新时间最新的一封，可一键展开全部。

核心保证：**AI 开发信息文件是生成时间的唯一真源，客户笔记零写入。**

---

## 1. 需求拆解与现状诊断

| 需求 | 落地方式 |
|---|---|
| 列表能看出「多久没生成邮件」 | 「开发状态」列主行：`刚刚 / 3 小时前 / 昨天 / 5 天前 / 从未 / 未知` |
| 能筛出「超过 N 天没生成」的客户 | 「生成时间」筛选：`不限 / ≥N 天未生成 / N 天内生成过 / 从未生成` |
| 防止一天内忘记已生成、又点一次 | 生成前冷却守卫：默认 `24 小时`，跳过并告知；需要时可「仍然全部生成」 |
| 从工作台直接看这个客户的邮件 | 「开发状态」单元格内的「✉」入口 → 打开邮件列表并自动筛选到该客户 |
| 同一邮箱的多条待审不要堆在列表里 | 邮件列表按「同一客户 + 同一邮箱」只保留更新时间最新的一封；被隐藏的可展开 |
| 不破坏现有写回边界 | 只读推导，客户 frontmatter 仍只由验收和「标记已发送」写 |

### 1.1 现有「开发状态」的问题（确认：与时间无关，且会丢）

| # | 现象 | 代码原因 | 后果 |
|---|---|---|---|
| 1 | 状态文案没有时间 | `CustomerDevStatus` 有 `at` 字段，但 [workbench-view.ts](../src/obsidian/workbench-view.ts) 的 `statusFor` 只取 `statusLabel(status)`，从不显示 `at` | 30 天前的「无可用联系人」看起来像当前状态 |
| 2 | 只反映「最后一次执行」 | [main.ts](../src/obsidian/main.ts) 的 `persistDevStatus` 用本次结果**整体替换** `devStatus`，`last-run.json` 也只存最后一次运行 | 跑一次别的批次后，上一批客户的状态全部消失，列上变回 `✓` / `—` |
| 3 | 兜底 `✓` / `—` 没有信息量 | 没有状态时只看客户有没有 `AI开发信息` 双链 | 用户无法区分「生成过」「从没生成」 |
| 4 | 与「最近生成」重复 | 成功状态显示「已生成 N 封」，如果再单加一列生成时间，两列会表达同一件事 | 列表变宽、概念重复 |
| 5 | 失败/无联系人没有和后续成功对账 | 状态是覆盖式的，不判断「这次失败之后是否又生成成功」 | 旧提醒可能在新成功后仍然挂着（或反过来消失） |

**结论**：不保留两个列。改成**一个「开发状态」列**，以「最近生成时间」为主信息；「上次尝试结果」只在它是**未解决的提醒**时作为副行出现，并持久化到每客户一条。

### 1.2 合并后的信息模型

每个客户只展示两个维度，且都以时间为锚：

| 维度 | 数据源 | 持久性 | 在列里的位置 |
|---|---|---|---|
| 最近一次有效生成 | AI 文件里的 `generated_at` | 永久（文件在就在） | **主行**，可排序、可筛选 |
| 最近一次尝试结果 | `.state/customer-status.json` 里该客户自己的记录 | 到下一次尝试为止，跨批次不丢 | **副行**，只显示未解决的 `no_contact / no_suitable / failed` |

「未解决」的判定：尝试时间 **不早于** 最近生成时间，或该客户从未生成。若之后已经有更晚的成功生成，旧提醒自动隐藏。

### 1.3 三个可选做法

| 做法 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 保留两列 | 改动最小 | 概念重复；旧列没有时间，仍会误导 | 否决 |
| 删掉「开发状态」，只留「最近生成」 | 实现最简单，列也最少 | 失去每客户「无可用联系人 / 上次失败」线索，只能靠顶部横幅 | 可作为最小版 |
| **合并 + 持久化（推荐）** | 一列说清「何时生成 + 上次为何没生成」；状态不再随批次丢失 | 多一个 `customer-status.json` 和合并逻辑 | 采用 |

---

## 2. 为什么不能用现成字段

| 候选数据源 | 能否作为「最近生成时间」 | 原因 |
|---|---|---|
| 客户属性 `最近联系时间` | ❌ | 只有「标记已发送」才更新，语义是联系而非生成 |
| 客户文件 `mtime` | ❌ | 生成邮件根本不写客户文件；验收/标记发送、手工编辑却会改 mtime |
| AI 文件 frontmatter `updated` | ❌ | 改状态、验收、编辑、标记发送都会刷新，不等于生成 |
| 邮件块 `generated_at` | ✅ | 只在创建邮件时写入，正好是「生成」语义 |
| 邮件块 `updated_at` | ⚠️ | 重新生成/编辑/改状态都会变；可做辅助，不做主口径 |
| `.state/ai-log.jsonl` | ❌ | 只保留最近 50 条，用户可清空，不是持久事实 |
| `.state/last-run.json` | ⚠️ | 只记录「上次执行」，下次执行即覆盖；适合顶部横幅，不适合每客户状态 |
| `.state/customer-status.json` | ✅（仅尝试结果） | 本方案新增，每客户一条，跨批次合并；不含生成时间 |
| 在客户属性里新增 `最近生成时间` | ❌ | 违反写回红线（客户笔记只允许验收双链、最近联系时间）；还会把客户笔记改成已修改状态，污染同步与 git 历史 |

**结论**：生成时间从 AI 开发信息文件推导；尝试结果单独持久化。Bases 的原生 `filters`/`sort` 无法 JOIN 另一个目录的文件，所以筛选由插件自己的两个视图实现（Bases 视图本来就是我们注册的自定义视图，可以在 `drawTable` 里做）。

---

## 3. 数据口径

### 3.1 生成时间定义

- **有效邮件**：`status !== "Rejected"`。已拒绝的邮件不算「已生成」，允许立即重做。
- **单封生成时间**：`generatedAt`；老文件没有该字段时回退到第一个版本的 `versions[0].at`（`Generated` 版本的标题时间）。
- **客户最近生成时间**：该客户名下所有有效邮件的 `generatedAt` 的最大值。
- **一次都没生成**：没有可对应的 AI 文件 → `从未`。
- **无法判断**：AI 文件存在、但解析不出任何邮件块 → `未知`（**不参与「未生成」筛选**；未知本身不拦截，但若上次尝试记录是「已生成」，冷却会用尝试时间兜底，见 5.8）。
- **无法对应**：AI 文件找不到对应客户（客户改名但 AI 文件名没改、或客户已删除）→ 相关客户显示 `从未`，并在列表底部提示「有 N 个 AI 文件无法对应客户」。

> 已知局限：AI 文件被手动删除或移出输出目录后无法追溯，会回到「从未」。如果上次尝试记录说「已生成」，合并列会给出「文件缺失」警告，冷却守卫也会把这条记录当作兜底锚点（见 5.8）。客户改名若没有验收过（`AI开发信息` 反查不存在），会落入「无法对应」，主行变成 `从未`；这是本方案的已知风险，后续用「同步 AI 文件名」命令解决。

### 3.2 客户 ↔ AI 文件匹配（从强到弱）

> 现状：`pipeline.ts` 调用 `appendEmailsToContent(..., customer.name, ...)`，所以新文件的 `customer` 双链通常只有 **basename**（`[[Acme]]`），不是完整路径。因此实际最常用的是第 3 条，第 1 条主要覆盖老文件或手工写的完整路径。

1. AI 文件 frontmatter 的 `customer: "[[...]]"` 带目录时，去 `.md` 后与客户路径完全一致；
2. 客户属性 `AI开发信息`（`settings.linkPropertyName`）的双链指向该 AI 文件路径（客户改名后仍然有效，但只有验收过的客户才有）；
3. AI 文件的 `customer` 链接 basename 或文件名去掉 ` - AI开发信息` 后，与客户 basename 一致，且**客户目录里该 basename 唯一**；
4. 都不满足 → 不归属，相关客户显示「从未」，相关 AI 文件计入「无法对应」提示。

> 同名客户（不同目录、同一个 basename）只在第 1、2 条命中时才归属；靠名字匹配出现歧义时一律按 `未知` 处理。另外，当前 AI 文件名也只由 basename 生成，同名客户本身就会写进同一个 AI 文件（既有局限），本方案不扩大这个问题。

### 3.3 时间算法

- 解析 ISO 字符串时保留原有偏移（`2026-11-16T09:12:00+08:00`）；老格式 `2026-11-10 20:19` 按本机本地时间解释。
- 「距今 N 天」用**绝对时间差**（N × 24 小时），不用自然日。原因：昨天 23:50 生成，今天 00:10 打开列表，自然日算法会认为「新的一天可以再生成」，而实际只过了 20 分钟。自然日只用于展示（「昨天」）。
- 系统时间被调早导致「未来时间」时，差值按 0 处理（显示「刚刚」，不阻塞）。

### 3.4 「上次尝试」记录

新增 `{输出目录}/.state/customer-status.json`：

```json
{
  "version": 1,
  "customers": {
    "客户/Acme.md": {
      "kind": "no_contact",
      "customerName": "Acme",
      "emailCount": 0,
      "message": "没有解析到联系人区段，未调用 AI",
      "at": "2026-11-16T20:10:00+08:00"
    }
  }
}
```

- 每次执行结束后，**按客户合并**：本次出现的客户覆盖自己的旧记录，未出现的客户保留；`last-run.json` 仍按原样只写本次，供顶部横幅使用。
- 首次升级时若新文件不存在，用 `last-run.json` 里的客户记录做种子，避免第一屏没有状态。
- `at` 用于副行的相对时间和 tooltip；`message` 保留完整原因。
- 只存客户路径 → 状态，不存生成时间；生成时间永远以 AI 文件为准。
- 客户改名会换路径，旧记录成为孤儿（无害）；生成时间仍可按 basename 匹配，所以主行不受影响。

### 3.5 口径示例

| 场景 | 主行 | 副行 | ≥1 天未生成（含从未） | 24h 冷却 |
|---|---|---|---|---|
| 今天 09:00 生成，现在 18:00 | `9 小时前` | — | 隐藏 | 拦截 |
| 今天 09:00 生成，明天 10:00 | `昨天` | — | 显示 | 放行 |
| 从未生成 | `从未` | — | 显示 | 放行 |
| 从未生成，上次执行说无联系人 | `从未` | `⚠ 无可用联系人 · 2 小时前` | 显示 | 放行 |
| 3 天前生成，2 小时前又试了一次但失败 | `3 天前` | `⚠ 上次失败 · 2 小时前` | 显示 | 放行（除非最近一次生成在 24h 内） |
| 2 小时前失败，1 小时前重新生成成功 | `1 小时前` | —（旧失败已解决） | 隐藏 | 拦截 |
| 唯一一封邮件被拒绝 | `已拒绝` | — | 显示 | 放行（AI 文件里有邮件，不用尝试时间兜底） |
| AI 文件存在但解析不出邮件 | `未知` | 若有上次尝试则附上 | 隐藏 + 提示 | 通常不拦截；上次尝试为已生成时用其时间兜底 |
| AI 文件找不到对应客户（改名/删客户） | `从未` | — | 显示 + 底部「有 AI 文件无法对应」 | 无该客户的上次记录，不拦截（已知风险） |
| 上次记录说已生成，但 AI 文件找不到 | `从未` | `⚠ 上次已生成但文件缺失 · 1 小时前` | 显示 | **拦截**（用尝试时间兜底） |

---

## 4. 交互设计

### 4.1 内置工作台（`workbench-view.ts`）

把原来表格末尾固定的「开发状态」列移到「客户」之后，并改成两行单元格：

```
┌──────────────────────────────────────────────────────────────────────┐
│ 客户开发工作台            [刷新] [显示哪些属性] [邮件列表] [生成示例 Base] │
├──────────────────────────────────────────────────────────────────────┤
│ 筛选条件   [五星] [开发触达] [fit ≥ 8] [待开发] [清空]   [ ] 显示已排除    │
│ 最近生成   [≥ N 天未生成 ▾] [1] 天   [x] 包含从未生成                    │
│           快捷：[今日待开发] [24h 内已生成] [不限]                       │
├────┬────┬──────────┬────────────────────────┬──────┬──────────┬────────┤
│ ☐  │联系人│ 客户      │ 开发状态                 │ 地区  │ 进度      │ …      │
│ ☐  │ 3  │ Acme     │ 3 天前              ✉2  │ 美国  │ 1.待开发  │ …      │
│    │    │          │ ⚠ 无可用联系人 · 2 小时前  │      │          │        │
│ ☐  │ 1  │ Beta     │ 刚刚                ✉   │ 德国  │ 1.待开发  │ …      │
│ ☐  │ 0  │ Gamma    │ 从未                    │ 日本  │ 1.待开发  │ …      │
└────┴────┴──────────┴────────────────────────┴──────┴──────────┴────────┘
共 128 家 · 因生成时间隐藏 12 家 · 已排除 8 家 · 排序：开发状态 升序
```

要点：

- 主行就是「最近生成」时间，点击列头按 `lastGeneratedMs` 排序：升序 = 从未/最久在前，正好是「该开发谁」的顺序。
- 副行只在**未解决的提醒**时出现，颜色区分 `warn`（无联系人）和 `error`（失败）；没有副行的行保持单行高度。
- 单元格 `title` 显示完整信息：
  ```
  最近生成：2026-11-13 09:12
  有效 2 封 / 共 2 封
  上次尝试：2026-11-16 20:10 · 未找到合适联系人
  ```
- 冷却窗口内（<24h）主行用绿色弱提示；`未知` 用警告色；`从未` 用灰色。
- 生成时间筛选与属性条件**相互独立**（AND 关系）；「清空」同时把生成时间恢复为「不限」。
- 计数行显示「因生成时间隐藏 N 家」，让用户知道客户没丢，只是被筛掉。
- 表格末尾不再有第二个状态列。
- 「开发状态」单元格整体可点击：点击打开**这个客户**的邮件列表（见 4.5）；主行右侧的 `✉2` 是视觉提示 + 待审邮件数，`2` 不单独占点击区。没有邮件时单元格不可点击，tooltip 说明「还没有开发邮件」。
- 点击表头仍然是排序；点击单元格是跳转，两者不冲突。单元格 hover 时给背景/下划线提示，避免看起来像纯文本。

**默认值建议**：`≥1 天未生成（含从未生成）`。理由是这正是日常开发流的默认视角；升级后列表会立刻变短，符合本次需求。若担心老用户惊讶，可以先默认「不限」，在设置里提供「打开工作台时默认…」，二者只差一个默认常量。

### 4.2 Bases 视图（`bases-view.ts`）

Bases 仍是默认工作台，必须在 Bases 视图里也能筛，否则大多数用户用不上。

- 顶部搜索/排除开关旁增加一行紧凑控件（读写的都是同一个 `settings.generationFilter`，与内置工作台保持同步）：
  `最近生成 [不限 ▾] [1] 天 [x] 包含从未生成`
- 表格在「客户」后固定插入**合并后的「开发状态」列**（Bases 的属性列仍由 `.base` 的 `order` 控制），渲染逻辑与内置工作台一致。
- 表格末尾不再渲染固定的旧状态列。
- 底部信息追加：`因生成时间隐藏 N 家 · 无法判断 M 家`。
- 明确提示（`eo-muted` 小字）：Base 自身的筛选/排序看不到这个派生字段；它由插件的视图级筛选提供。

### 4.3 生成前冷却守卫（`main.ts › runTasks`）

流程：

1. 用户勾选客户 → 点「生成开发邮件」。
2. 先 `await emailStore.refresh()`，再用最新 AI 文件建索引（不信任可能过期的内存缓存）。
3. 把勾选客户分成两组：`可生成` 与 `冷却中`（`now - 最近生成 < settings.generateCooldownHours`）。
   - 冷却锚点取 `max(AI 文件的最近生成时间, 上次尝试为 generated 的 at)`；这样 AI 文件被删/损坏时仍能拦住 24h 内的重复。
4. 若「冷却中」为空：保持现有确认弹窗不变。
5. 否则在原有确认弹窗里增加一段说明与列表：

```
┌ 生成开发邮件 ──────────────────────────────────────┐
│ 已选 12 家，其中 3 家在 24 小时内生成过：             │
│   · Acme     今天 09:12   有效 2 封 / 共 2 封        │
│   · Beta     今天 08:40   有效 1 封 / 共 1 封        │
│   · Gamma    今天 07:05   有效 3 封 / 共 3 封（已验收）│
│ 将跳过这 3 家，只处理其余 9 家。                      │
│ 另有 1 家无法判断最近生成时间，且没有上次生成记录，不拦截。│
│                                                     │
│          [取消]  [仍然全部生成]  [跳过并生成 9 家]     │
└─────────────────────────────────────────────────────┘
```

- 默认按钮 = 「跳过并生成 9 家」（安全路径）。
- 次要按钮 = 「仍然全部生成」（显式覆盖，不算失误）。
- 全部都在冷却中时：默认按钮变成「知道了」，次要按钮仍是「仍然全部生成」。
- 执行完成后 Notice：`已生成 5 封（3 家）；跳过 2 家（24 小时内已生成）`。
- 冷却时长由 `settings.generateCooldownHours` 控制，默认 `24`，`0` = 关闭。

> 为什么不在 `pipeline.ts` 里拦：冷却判断是「用户意图」问题，不是 AI 流水线问题；放在入口 `runTasks` 能同时覆盖内置工作台、Bases 视图和命令调用，且不污染 Pipeline 的纯执行语义。

### 4.4 顶部横幅与邮件列表

- 工作台顶部横幅继续只汇总**上次执行**（`last-run.json`），文案保持「上次执行：…」；它回答「刚才那批怎么样」。
- 「开发状态」列回答「这个客户现在怎么样」，两者不重复。
- 邮件列表顶部提醒继续引导回到工作台「开发状态」列；列名不变，文案无需改。

### 4.5 从工作台跳到这个客户的邮件列表

- 入口：**「开发状态」单元格本身**（见 4.1）。主行右侧的 `✉` 是视觉提示；`✉2` 的 `2` 是待审邮件数；没有待审邮件时只显示图标；完全没有邮件时单元格不可点击。
- 点击行为：
  1. 打开（或切到）「开发邮件列表」视图；
  2. 自动带上客户筛选，顶部出现 `客户：Acme ×` 的筛选 chip；
  3. 邮件列表原有的状态筛选、搜索、去重继续在这个客户范围内工作；
  4. 点 `×` 清除客户筛选，回到全部客户。
- 客户识别优先用「该客户对应的 AI 文件路径」（来自生成索引，客户改名后仍能命中），匹配不到时再用 `customerLink` / 客户名兜底。
- 空状态：该客户还没有邮件时，显示 `这个客户还没有开发邮件` + `清除客户筛选` 按钮，而不是一句泛泛的「共 0 封」。
- 入口对内置工作台和 Bases 视图都生效；单元格里的「开发状态」排序仍由表头负责。

### 4.6 邮件列表：同邮箱待审去重

**定义**：待审 = `Generated`（待审核）+ `Revision`（已修改，待审核）；`Accepted` / `Rejected` 本身永远不会被隐藏。

**范围**：默认「同一客户 + 同一邮箱」——用 AI 文件路径作为客户分组键，避免跳转到 A 客户时因为 B 客户有更新的同邮箱邮件而把 A 的邮件藏掉。若希望全局按邮箱去重，只需把分组键改成邮箱（见第 10 节确认项）。

**最新判定**：取 `emailUpdatedAt(record)` 最大的一封（与列表「更新时间」列完全一致）；时间相同按邮件 ID 数字大者优先；仍相同则按文件路径稳定排序。

**一个容易漏掉的对账**：如果同邮箱的最新一封已经**验收**，旧的待审也不应该再冒出来。所以规则是：

- 同组里只有「最新的那封待审」保留；
- 若同组存在比它更新的 `Accepted`，连这封待审也隐藏（否则验收完最新一封，旧草稿又出现）；
- 更新的 `Rejected` **不**抑制旧待审（拒绝的是那封新草稿，不是这个邮箱）；
- 已验收 / 已拒绝的行本身始终按状态筛选显示，不参与隐藏。

**展示**：

```
开发邮件列表
[客户：Acme ×] [搜索客户/联系人/邮箱/摘要] [全部状态 ▾] [ ] 显示重复待审（1） [刷新] [客户工作台]
共 3 封 · 已隐藏 1 封同邮箱旧待审

客户   联系人   邮箱           中文摘要        更新时间          状态
Acme   John    john@acme.com  …              2026-11-17 09:12  待审核
Acme   John    john@acme.com  …（旧）        2026-11-16 18:30  待审核   ← 默认隐藏
Acme   Mary    mary@acme.com  …              2026-11-16 18:31  待审核
```

- 默认隐藏旧待审；勾选「显示重复待审（N）」后全部展开，计数文案变为 `已显示 N 封旧待审`。
- 只影响显示，不删除、不修改任何 AI 文件；关掉插件或刷新后数据仍在。
- **先去重判定，再做状态 / 客户 / 搜索过滤**：这样「最新一封已验收」在任何状态筛选下都能压住旧待审。代价是搜索不会直接命中被隐藏的旧草稿，需要勾选「显示重复待审」；列表会显示 `有 N 封旧待审被合并` 提示，不会让人以为数据丢了。
- 邮箱比较忽略大小写和首尾空格；空邮箱不参与合并。
- 列表计数、隐藏数都按当前筛选后的结果计算；顶部「上次执行」横幅不受影响。

---

## 5. 技术设计

### 5.1 新增纯 TS 模块 `src/core/generation.ts`

```ts
export type GenerationState = "known" | "never" | "unknown";

export interface CustomerGeneration {
  state: GenerationState;
  /** 最近一次有效生成时间，保留原始 ISO 偏移；没有有效生成时为 null。 */
  lastGeneratedAt: string | null;
  lastGeneratedMs: number | null;
  /** 有效邮件数（status !== "Rejected" 且能解析出时间）。 */
  emailCount: number;
  /** 含已拒绝的总邮件数。 */
  totalEmailCount: number;
  /** 所有邮件都被拒绝（用于区分「已拒绝」和「时间无法解析」）。 */
  allRejected: boolean;
  /** 待审邮件数（Generated + Revision），用于开发状态单元格的「✉」角标。 */
  pendingCount: number;
  /** 匹配到的 AI 开发信息文件路径；没有匹配 / 从未生成时为 null。 */
  filePath: string | null;
  /** 最近一封有效邮件的状态，用于 tooltip。 */
  lastStatus: EmailStatus | null;
}

export type GenerationFilterMode = "off" | "stale" | "fresh" | "never";

export interface GenerationFilter {
  mode: GenerationFilterMode;
  /** stale / fresh 的窗口天数，允许 0.5（= 12 小时）；默认 1。 */
  days: number;
  /** stale 时是否把「从未生成 / 只有已拒绝」的客户也算进来。 */
  includeNever: boolean;
}

export const NEVER_GENERATION: CustomerGeneration;
export function normalizeGenerationFilter(value: unknown): GenerationFilter;

export function parseGenerationTime(value: string): number | null;
export function emailGeneratedAt(email: EmailRecord): string;
export function summarizeGeneration(
  emails: EmailRecord[],
  hasAIFile: boolean,
): CustomerGeneration;

export interface GenerationFileInput {
  path: string;
  customerLink: string;
  emails: EmailRecord[];
}
export interface GenerationCustomerInput {
  path: string;
  name: string;
  /** 客户属性里指向 AI 文件的双链目标（已去 .md）。 */
  linkedAIPaths: string[];
}
export function buildGenerationIndex(
  files: GenerationFileInput[],
  customers: GenerationCustomerInput[],
): { byCustomer: Map<string, CustomerGeneration>; unmatchedFiles: string[] };

export function matchesGenerationFilter(
  info: CustomerGeneration | undefined,
  filter: GenerationFilter,
  now: Date,
): boolean;
export function withinCooldown(
  info: CustomerGeneration | undefined,
  now: Date,
  hours: number,
  /** 兜底锚点：上次尝试为 generated 的时间。 */
  fallbackMs?: number | null,
): boolean;

export function formatGenerationAge(
  info: CustomerGeneration | undefined,
  now: Date,
): string;
export function formatElapsed(ms: number, now: Date): string;
export function formatGenerationTitle(
  info: CustomerGeneration | undefined,
): string;
export function describeGenerationFilter(filter: GenerationFilter): string;

export function customerGenerationInput(
  record: CustomerRecord,
  linkPropertyName: string,
): GenerationCustomerInput;
```

实现要点：

- `parseGenerationTime` 自己解析两种格式，不依赖 `Date.parse` 对 `YYYY-MM-DD HH:mm` 的实现差异：

```ts
const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
```

- `buildGenerationIndex` 按 3.2 的优先级匹配；一个客户命中多个文件时合并（时间取最大、计数相加、`filePath` 取最近生成所在的文件）；命中文件但 `emails.length === 0` → `unknown`。
- `summarizeGeneration` 负责算 `lastGeneratedAt`、`pendingCount`；`filePath` 由 `buildGenerationIndex` 在归属后填。
- 「✉」角标和跳转都用索引里的 `pendingCount` / `filePath`，不额外扫描邮件行。
- 模块只 import `./types`、`./wikilinks`，不 import `obsidian`。
- `formatGenerationAge` 边界：`未知` / `从未` / `已拒绝`（`allRejected`）；`allRejected` 为假又没有时间 → `未知`（老文件时间字段缺失）；`≤0` 或 `<60s` → `刚刚`；`<60min` → `N 分钟前`；`<24h` → `N 小时前`；`<48h` → `昨天`；`<30d` → `N 天前`；否则 `YYYY-MM-DD`。

### 5.2 新增纯 TS 模块 `src/core/dev-state.ts`（合并显示）

```ts
export interface CustomerDevView {
  /** 主行：最近生成时间 / 从未 / 已拒绝 / 未知。 */
  text: string;
  /** 副行：未解决的上次尝试提醒；没有则为 null。 */
  detail: string | null;
  level: "none" | "ok" | "warn" | "error";
  detailLevel: "warn" | "error" | null;
  /** 悬浮 tooltip，含精确时间。 */
  title: string;
}

export function describeDevState(
  info: CustomerGeneration | undefined,
  attempt: CustomerDevStatus | null,
  now: Date,
): CustomerDevView;
```

规则：

1. 主行：
   - `info.state === "unknown"` → `未知`，`level = warn`；
   - 有 `lastGeneratedMs` → `formatGenerationAge`（`刚刚` / `3 天前` / 日期），<24h 时 `level = ok`；
   - `state === "never"` → `从未`；
   - 有邮件但全是 Rejected → `已拒绝`；
   - 其余（老文件没有可用时间）→ `未知`。
2. 副行（`detail`）只在同时满足时出现：
   - `attempt` 存在且 `kind` 是 `no_contact` / `no_suitable` / `failed`；
   - 且 `attempt.at` 不早于 `info.lastGeneratedMs`，或客户没有有效生成；
   - 文案：`⚠ 无可用联系人 · 2 小时前`、`⚠ 未找到合适联系人 · 昨天`、`⚠ 上次失败 · 3 天前`；
   - `detailLevel`：`no_contact` / `no_suitable` → `warn`，`failed` → `error`。
3. 特殊情况：`info.lastGeneratedMs == null`（`state` 为 `never` 或 `unknown`）但 `attempt.kind === "generated"` → 主行保持 `从未` / `未知`，副行 `⚠ 上次已生成但文件缺失/无法解析 · 1 小时前`，`level = warn`。提示用户 AI 文件被删/移走/损坏，同时冷却仍会拦（见 5.8）。
4. tooltip 固定三行：最近生成精确时间 + 有效/总邮件数、上次尝试精确时间 + 原因；没有的维度省略。
5. `attempt.kind === "generated"` 且生成时间未丢失 → 不显示副行（成功不重复提示）。
6. `attempt.at` 解析失败时，副行只显示原因，不带相对时间。

### 5.3 每客户状态持久化（`run-status.ts` / `state-store.ts` / `main.ts`）

`core/run-status.ts` 增加：

```ts
export function parseDevStatusMap(value: unknown): DevStatusMap;
export function mergeDevStatuses(
  base: DevStatusMap,
  updates: DevStatusMap,
): DevStatusMap;
```

- `parseDevStatusMap` 复用现有 `parseStatus` 校验，坏条目跳过。
- `parseRunStatusFile` 改为调用它，行为不变。
- `mergeDevStatuses` 返回新对象：`{ ...base, ...updates }`；仅覆盖本次出现的客户。

`obsidian/state-store.ts` 增加：

```ts
async loadCustomerStatuses(): Promise<DevStatusMap | null>;
async saveCustomerStatuses(customers: DevStatusMap): Promise<void>;
```

文件为 `.state/customer-status.json`，写入 `{ version: 1, customers }`。

`main.ts`：

```ts
private devStatus: DevStatusMap = {};          // 每客户上次尝试（跨批次）
private lastRunStatusFile: RunStatusFile | null = null; // 仍只存上次执行

private async loadDevStatus(): Promise<void> {
  const lastRun = await this.state.loadLastRunStatus();
  if (lastRun) this.lastRunStatusFile = lastRun;
  const stored = await this.state.loadCustomerStatuses();
  // 升级种子：新文件不存在时用 last-run 的记录，避免第一屏没有状态
  this.devStatus = stored ?? lastRun?.customers ?? {};
}

private async persistDevStatus(results: RunOutcome["results"]): Promise<void> {
  const updates: DevStatusMap = {};
  for (const result of results) updates[result.customer.path] = result.status;
  this.devStatus = mergeDevStatuses(this.devStatus, updates);
  this.lastRunStatusFile = { at: isoNow(), customers: updates };
  await Promise.all([
    this.state.saveLastRunStatus(updates),        // 顶部横幅：只含本次
    this.state.saveCustomerStatuses(this.devStatus), // 每客户列：跨批次
  ]);
}
```

`getCustomerDevStatus(path)` 继续返回 `this.devStatus[path]`，但现在拿到的是该客户自己的上次尝试，而不是「上次执行是否包含它」。

> 文件大小：每个客户一条，几百到几千条都是几十 KB；本期不做清理。后续可加「删除不存在客户/超过 365 天的记录」的维护命令。

### 5.4 筛选管线 `src/core/filters.ts`

不把生成时间塞进 `FilterCondition`（通用操作符表达不了「从未或超过 N 天」，也不该污染属性下拉框），而是给 `applyFilters` 增加一个可选的运行时上下文：

```ts
export interface FilterRuntime {
  generation?: {
    filter: GenerationFilter;
    of: (record: CustomerRecord) => CustomerGeneration | undefined;
    now: Date;
  };
}

export function applyFilters(
  records: CustomerRecord[],
  config: FilterConfig,
  rules: ExclusionRules,
  runtime?: FilterRuntime,
): {
  included: CustomerRecord[];
  excluded: CustomerRecord[];
  /** 通过了属性筛选与排除规则，但被生成时间筛掉的客户数。 */
  hiddenByGeneration: number;
};
```

顺序：**属性条件 → 公海/共享排除 → 生成时间**。这样「因生成时间隐藏 N 家」是在当前属性筛选结果内的数字，不会误导。

`FilterConfig` 结构不变；生成时间筛选单独存 `settings.generationFilter`，两个视图共用，Bases 视图也能直接读。

### 5.5 设置 `src/obsidian/settings.ts` / `settings-tab.ts`

```ts
export interface Settings {
  // ...
  /** 生成前冷却窗口（小时）；0 表示关闭。 */
  generateCooldownHours: number;
  /** 工作台「最近生成」筛选；两个视图共用。 */
  generationFilter: GenerationFilter;
}
```

- 默认：`generateCooldownHours: 24`，`generationFilter: { mode: "off", days: 1, includeNever: true }`（是否默认 `stale` 见第 10 节待确认）。
- `loadSettings()` 里用 `normalizeGenerationFilter` 兜底旧数据/手改坏的 data.json。
- 设置页「筛选与写回」增加一行：
  - 名称：`重复生成保护（小时）`
  - 描述：`勾选客户中，N 小时内已生成过有效邮件的默认跳过；0 表示关闭。`
  - 输入 0–720 的整数，非法值回退 24。

### 5.6 `EmailStore` / `plugin-api.ts`

`EmailStore` 增加只读访问器（`files` 目前是私有字段）：

```ts
listFiles(): Array<{ path: string; file: CustomerAIFile }>;
```

`OutreachPluginApi` 增加：

```ts
getGenerationIndex(records?: CustomerRecord[]): Map<string, CustomerGeneration>;
```

`main.ts` 实现：

```ts
getGenerationIndex(records = this.repo.list()): Map<string, CustomerGeneration> {
  return buildGenerationIndex(
    this.emailStore.listFiles().map(({ path, file }) => ({
      path,
      customerLink: file.customerLink,
      emails: file.emails,
    })),
    records.map((record) =>
      customerGenerationInput(record, this.settings.linkPropertyName),
    ),
  ).byCustomer;
}
```

索引按需构建（O(客户数 + AI 文件数 + 邮件数)），不额外做持久缓存：工作台一次渲染只建一次，几百个客户量级可以忽略。

> **必须用全量客户构建**（`repo.list()`，或直接调用无参 `getGenerationIndex()`），不能用 Base / 属性筛选后的行子集。否则 basename 唯一性判断会失真，「无法对应」也会误报。索引以客户 `path` 为 key，筛选后的行照样能查到。

### 5.7 表格与两个视图（`table.ts` / `workbench-view.ts` / `bases-view.ts`）

- `table.ts` 删除写死的末尾「开发状态」列和 `status` 选项；表格只保留勾选、联系人、业务列。
- 两个视图在自己的 `columns` 里、「客户」之后插入合并列：

```ts
{
  id: DEV_STATUS_COLUMN_ID, // "eo:devStatus"
  label: "开发状态",
  width: 180,
  render: (row) => {
    const view = describeDevState(
      index.get(row.record.path),
      plugin.getCustomerDevStatus(row.record.path),
      now,
    );
    const cell = document.createElement("div");
    cell.className = "eo-dev-cell";
    const main = document.createElement("div");
    main.className = `eo-dev-main eo-dev-${view.level}`;
    main.setText(view.text);
    cell.appendChild(main);
    if (view.detail) {
      const detail = document.createElement("div");
      detail.className = `eo-dev-detail eo-dev-${view.detailLevel ?? "warn"}`;
      detail.setText(view.detail);
      cell.appendChild(detail);
    }
    cell.title = view.title;
    return cell;
  },
}
```

- `workbench-view` 的筛选计数、排序、生成时间控件按 5.4 接入；`sortRows` 对 `DEV_STATUS_COLUMN_ID` 特判 `lastGeneratedMs ?? -Infinity`。
- 每个视图在渲染开始时调用一次 `plugin.getGenerationIndex()` 拿到 `index` 和 `now`，不要每行重建。
- `bases-view` 的 `drawTable` 同样用**全量客户**索引（`plugin.getGenerationIndex()`，不要传 Base 过滤后的行）、过滤、插入列，并统计隐藏数与「无法对应」数。
- 删除 `statusFor` / `statusForCustomer`；`CustomerStatus` 类型不再需要（`CustomerDevView` 取代）。
- 打开视图时若 `emailStore` 还没加载完（首次启动），先渲染一次，再 `void plugin.refreshEmailList().then(() => this.render())`（用现有 `renderToken` 防过期重绘）。

### 5.8 冷却守卫细节

`runTasks` 里：

```ts
const index = this.getGenerationIndex(this.repo.list(true));
const now = new Date();
const cooling: CustomerRecord[] = [];
const runnable: CustomerRecord[] = [];
for (const record of chosen) {
  const info = index.get(record.path);
  const attempt = this.getCustomerDevStatus(record.path);
  // AI 文件不可用（没有/解析不出/0 封）时，才用上次「已生成」记录兜底；
  // 文件里有邮件但全被拒绝时，视为用户显式放弃，不拦。
  const aiUnavailable =
    !info || info.state !== "known" || info.totalEmailCount === 0;
  const fallbackMs =
    aiUnavailable && attempt?.kind === "generated"
      ? parseGenerationTime(attempt.at)
      : null;
  if (withinCooldown(info, now, hours, fallbackMs)) {
    cooling.push(record);
  } else {
    runnable.push(record);
  }
}
```

- 冷却锚点取 `max(info.lastGeneratedMs, fallbackMs)`；AI 文件丢失时仍能拦住。
- 冷却中的客户在确认弹窗里列出：客户名、`formatGenerationAge`、有效/总邮件数；无法判断且没有上次生成记录的单独提示、不拦截。
- 三态按钮见 4.3；若不想改 `confirm.ts`，用「仍然生成」复选框的闭包方案替代。

### 5.9 确认弹窗三态（`modals/confirm.ts`）

新增 `confirmChoice`，保留现有 `confirm`：

```ts
export type ConfirmChoice = "primary" | "secondary" | null;

export interface ConfirmChoiceOptions {
  title: string;
  primaryText: string;
  secondaryText: string;
  cancelText?: string;
  build: (container: HTMLElement) => void;
}

export function confirmChoice(app: App, options: ConfirmChoiceOptions): Promise<ConfirmChoice>;
```

### 5.10 样式（`styles.css`）

新增少量类：

- `.eo-dev-cell`、`.eo-dev-main`、`.eo-dev-detail`
- `.eo-dev-cell-clickable`（hover 背景、cursor）、`.eo-dev-jump`、`.eo-dev-count`
- `.eo-dev-ok`、`.eo-dev-warn`、`.eo-dev-error`、`.eo-dev-none`
- `.eo-customer-filter`、`.eo-dedupe-toggle`
- `.eo-filter-generation`、`.eo-bases-generation`
- 复用现有 `.eo-filter-row`、`.eo-muted`、`.eo-dev-status-*` 的视觉语言，不引入新色板。

### 5.11 新增纯 TS 模块 `src/core/email-list.ts`（客户过滤 + 待审去重）

```ts
export type PendingDedupeScope = "customer" | "global";

export interface EmailCustomerFilter {
  path: string;
  name: string;
  /** 该客户匹配到的 AI 文件路径；匹配不到时为 null。 */
  aiFilePath: string | null;
}

export interface EmailListQuery {
  status: EmailStatus | "all";
  search: string;
  customer: EmailCustomerFilter | null;
  /** 是否显示被合并掉的旧待审。 */
  showDuplicatePending: boolean;
  /** 默认 "customer"：同一客户 + 同一邮箱；"global"：整个列表按邮箱。 */
  scope?: PendingDedupeScope;
}

export interface EmailListResult {
  /** 默认不含被合并的旧待审；showDuplicatePending 打开时包含全部，顺序不变。 */
  visible: EmailRow[];
  /** 当前过滤结果里被合并掉的待审数量。 */
  hiddenDuplicateCount: number;
}

export function isPendingStatus(status: EmailStatus): boolean;
export function normalizeEmail(value: string): string;
export function emailRecencyMs(row: EmailRow): number;
export function matchesCustomerFilter(
  row: EmailRow,
  filter: EmailCustomerFilter | null,
): boolean;
export function dedupePendingRows(
  rows: EmailRow[],
  scope?: PendingDedupeScope,
): { kept: EmailRow[]; hidden: EmailRow[] };
export function filterEmailRows(
  rows: EmailRow[],
  query: EmailListQuery,
): EmailListResult;
```

实现要点：

- `isPendingStatus`：`Generated` / `Revision` 为 true；`Accepted` / `Rejected` 为 false。
- 状态筛选保持现有语义：`all` 排除 `Rejected`，其他状态精确匹配；客户筛选先按 `aiFilePath` 精确匹配 `row.filePath`，再按规范化后的 `customerLink` / 客户名兜底。
- `normalizeEmail`：`trim().toLowerCase()`；空串返回空，空邮箱不参与合并。
- 分组键：
  - `customer`（默认）：`${row.filePath}\u0000${normalizeEmail(row.record.email)}`；
  - `global`：`normalizeEmail(row.record.email)`。
- 组内判定（`dedupePendingRows` 对**全量行**执行，不先看筛选）：
  1. `newestPending` = 组内待审行里 `emailRecencyMs` 最大的一封；
  2. `newestAccepted` = 组内 `Accepted` 行里 `emailRecencyMs` 最大的一封；
  3. 除 `newestPending` 外的待审行 → 隐藏；
  4. 若 `newestAccepted` 比 `newestPending` 更新，连 `newestPending` 也隐藏；
  5. `Rejected` 不参与判定，`Accepted` / `Rejected` 行本身不隐藏。
- 组内并列：`emailRecencyMs` 相同 → 邮件 ID 数字大者优先 → 再按 `key` 稳定排序。
- `filterEmailRows` 顺序：**先 `dedupePendingRows` 得到隐藏集合 → 再按状态 / 客户 / 搜索过滤 → 从结果中去掉隐藏行（除非 `showDuplicatePending`）**。
  - `hiddenDuplicateCount` = 「通过当前状态/客户/搜索过滤、但被隐藏」的行数，保证文案和开关数字对得上。
  - 搜索不会命中被隐藏的旧草稿；视图在「可见 0 封但有隐藏」时给出提示，引导勾选「显示重复待审」。
- 纯函数，不读 Obsidian；测试用固定 `EmailRow[]`，不依赖运行机器时区。

### 5.12 邮件列表视图与跳转入口

`EmailListView`：

- 新增状态：
  ```ts
  private customerFilter: EmailCustomerFilter | null = null;
  private showDuplicatePending = false;
  ```
- 新增 `setCustomerFilter(filter: EmailCustomerFilter | null): void`：设置并 `render()`；由跳转入口和「×」调用。
- `filteredRows()` 改为调用 `filterEmailRows(rows, { status: this.statusFilter, search: this.search, customer: this.customerFilter, showDuplicatePending: this.showDuplicatePending })`，返回 `{ visible, hiddenDuplicateCount }`。
- 头部：
  - 有客户筛选时显示 `客户：Acme ×` chip，`×` 清除；
  - 有隐藏项时显示复选框 `显示重复待审（N）`，勾选后 `showDuplicatePending = true` 并重绘；
  - 计数行：`共 X 封` + 客户名 + `已隐藏 N 封同邮箱旧待审` / `已显示 N 封旧待审`。
- 空状态：
  - 客户筛选下确实没有邮件：显示 `这个客户还没有开发邮件` + 清除按钮；
  - 客户有邮件但都被拒绝：显示 `这个客户只有已拒绝的邮件`，并可把状态筛选切到「已拒绝」；
  - 有可见行之外还有被合并的旧待审：显示 `有 N 封旧待审被合并` + 提示勾选「显示重复待审」，不要让用户以为数据丢了；
  - 其余保持原文案。
- `refresh()` 不清空筛选；`onOpen` 初始为 null。

`OutreachPluginApi` 增加：

```ts
openEmailListForCustomer(
  record: CustomerRecord,
  aiFilePath?: string | null,
): Promise<void>;
```

`main.ts`：

```ts
async openEmailListForCustomer(record, aiFilePath): Promise<void> {
  await this.openEmailList(); // 打开/切到列表；内部会清空旧的客户筛选
  const leaf = this.app.workspace.getLeavesOfType(EMAIL_LIST_VIEW_TYPE)[0];
  const view = leaf?.view;
  if (view instanceof EmailListView) {
    view.setCustomerFilter({
      path: record.path,
      name: record.name,
      aiFilePath: aiFilePath ?? null,
    });
  }
}
```

`openEmailList()` 本身在打开时调用 `view.setCustomerFilter(null)`，这样顶部「邮件列表」按钮看到的是全部；`openEmailListForCustomer` 随后再设置目标客户。

两个工作台的「开发状态」列：

- 单元格本身渲染成可点击容器（`a` 或 `button`，加 `eo-dev-cell-clickable`），内部仍然显示主行 + 副行；
- 主行右侧放 `✉`（有待审时带 `eo-dev-count` 角标），提示「可跳转」；
- 点击时 `event.preventDefault(); event.stopPropagation();`，再调用
  `plugin.openEmailListForCustomer(row.record, index.get(row.record.path)?.filePath ?? null)`；
- 完全没有邮件（`totalEmailCount === 0`）时不加点击行为，`title` 说明「还没有开发邮件」；有邮件但无待审时仍可跳转，tooltip 给「待审 0 封 / 共 N 封」；
- 键盘可达：使用原生 `a`/`button`，Enter 触发；表头排序不受影响；
- 建议抽一个 `renderDevStatusCell(row, plugin, index, now)` 供两个视图复用，避免复制点击逻辑；客户名链接保持现状（只打开客户笔记）。

> 角标按 AI 文件里的待审邮件数统计；如果同邮箱有重复，邮件列表会合并显示，并在列表顶部注明隐藏数，两处口径都保留说明。

---

## 6. 关键决策与备选

| 决策 | 选择 | 备选 / 理由 |
|---|---|---|
| 数据源（生成时间） | AI 文件里的 `generated_at` | 写客户属性可让 Bases 原生筛，但违反写回红线，否决 |
| 两列还是合并 | **合并成一个「开发状态」列**，主行时间、副行提醒 | 两列会重复表达「已生成 N 封」，且旧状态没有时间，容易误读 |
| 「上次尝试」存哪 | 新增 `.state/customer-status.json`，按客户合并 | 继续用 `last-run.json` 会在下次执行时丢客户；`last-run` 只留给顶部横幅 |
| 旧提醒何时隐藏 | 之后有更晚的成功生成就隐藏 | 永远显示会让「已修好的客户」一直挂警告 |
| 已拒绝邮件 | 不计入「已生成」 | 拒绝是显式动作，允许当天重做；如需最严格可改成计入（一个常量 + 测试） |
| 筛选窗口 | 绝对时间差（N×24h） | 自然日会漏掉「23:50 生成、00:10 再看」的重复风险 |
| 冷却窗口 | 默认 24h，可关；AI 文件缺失时用上次生成记录兜底 | 可配置成 12h/48h；0 = 关闭 |
| 未知状态 | 不参与「未生成」筛选、通常不拦截，但提示；上次记录为已生成时用其时间兜底 | 既不能把损坏文件当「从未」再生成，也不能让文件丢失绕过冷却 |
| 改名后无法对应 | 显示「从未」+ 底部提示孤立 AI 文件，不伪造归属 | 没有可靠的改名映射；硬猜可能把 A 的邮件算到 B 头上 |
| 默认筛选 | 建议 `≥1 天未生成（含从未）` | 保守方案默认「不限」；只差一个默认值，见第 10 节 |
| 重新生成（邮件详情） | 不刷新 `generated_at`，不计入冷却 | 单封手动重生成不是误操作；若以后要计入，应新增 `last_generated_at` 字段，而不是改 `generated_at` 语义 |
| 列名 | 「开发状态」（主行显示时间） | 也可叫「最近生成」，但会丢掉「上次尝试」的语义；列头 tooltip 会解释两行含义 |
| 同邮箱待审去重范围 | **同一客户 + 同一邮箱**（按 AI 文件路径分组） | 全局按邮箱更彻底，但跳到 A 客户时可能被 B 客户的更新邮件挤掉；需要时把分组键改成邮箱即可 |
| 最新已验收时的旧待审 | **隐藏**（已确认） | 否则验收完最新一封，旧草稿又冒出来；拒绝不抑制 |
| 「最新」的判定 | `emailUpdatedAt` 最大，时间相同按邮件 ID 大者 | 与列表「更新时间」列一致；只看 `generated_at` 会忽略后来的编辑/重生成 |
| 去重的副作用 | 只影响显示，不删不改 AI 文件 | 被隐藏的旧待审可一键展开；真要清理另做命令 |
| 跳转入口 | **「开发状态」单元格整体可点击 + ✉ 角标**（已确认） | 客户名旁按钮会挤占名称位置；单独加列会增加宽度 |
| 跳转的客户识别 | 优先 AI 文件路径，其次 `customerLink` / 客户名 | 只按名字在重名客户时会串号 |

---

## 7. 测试与验收

### 7.1 单元测试

新增 `tests/generation.test.ts`（并在 `tests/run.ts` 引入）：

1. `parseGenerationTime`：带偏移 ISO、`YYYY-MM-DD HH:mm`、纯日期、非法值；固定 `now`，不依赖运行机器时区。
2. `emailGeneratedAt`：有 `generatedAt` 用它；没有则回退 `versions[0].at`；都没有返回空。
3. `summarizeGeneration`：多封取最大；忽略 Rejected；全部 Rejected → `lastGeneratedMs = null`、`state = known`、`allRejected = true`；`hasAIFile && emails.length === 0` → `unknown`；`pendingCount` 只数 `Generated` / `Revision`。
4. `buildGenerationIndex`：
   - 链接精确路径命中；
   - 客户改名后靠唯一 basename 命中；
   - 同名客户 → 不归属 / `unknown`；
   - 客户 `AI开发信息` 反查命中；
   - 同一客户多个 AI 文件合并；
   - `filePath` 指向最近生成所在的 AI 文件；
   - `unmatchedFiles` 正确。
5. `matchesGenerationFilter`：`off / stale / fresh / never`；`includeNever` 开/关；恰好 24h 边界；未知状态永不被 stale 选中；未来时间。
6. `withinCooldown`：23h59m 拦截、24h 放行、0 关闭、从未/null 放行、`fallbackMs` 生效。
7. `formatGenerationAge` / `formatElapsed`：59s / 59min / 23h / 25h / 29d / 31d / 从未 / 未知 / 已拒绝。
8. `normalizeGenerationFilter`：`undefined`、`mode` 非法、`days` 负数/NaN、`includeNever` 非布尔。

新增 `tests/dev-state.test.ts`：

1. 3 天前生成、无尝试 → `3 天前`，`detail === null`。
2. 3 天前生成、2 小时前失败 → 主行 `3 天前`，副行 `⚠ 上次失败 · 2 小时前`，`detailLevel = error`。
3. 2 小时前失败、1 小时前重新生成成功 → 副行消失。
4. 从未生成、上次无联系人 → `从未` + `⚠ 无可用联系人 · …`。
5. 从未生成、上次记录已生成 → `从未` + `⚠ 上次已生成但文件缺失 · …`，`level = warn`；AI 文件存在但解析不出时主行 `未知`，同样带该副行。
6. 全部已拒绝 → `已拒绝`。
7. `unknown` → `未知` + `warn`。
8. tooltip 包含精确时间和邮件数。
9. 未来时间不产生负数文案。
10. `attempt.at` 非法 → 副行只有原因，不带时间。

更新 `tests/run-status.test.ts`：

1. `parseDevStatusMap` 接受合法 map、跳过坏条目。
2. `mergeDevStatuses` 保留未出现的客户、覆盖出现的客户、不改原对象。
3. `parseRunStatusFile` 行为不变。

更新 `tests/core.test.ts`：

1. `applyFilters` 传 runtime 时隐藏数正确。
2. `showExcluded` 与生成时间叠加顺序。
3. 旧三参调用行为不变。

新增 `tests/email-list.test.ts`（并在 `tests/run.ts` 引入）：

1. `isPendingStatus`：`Generated` / `Revision` 为 true；`Accepted` / `Rejected` 为 false。
2. `normalizeEmail`：大小写、首尾空格；空串返回空。
3. 同一客户 + 同一邮箱两封待审：保留 `updatedAt` 更新的一封，另一封进入 `hidden`；可见顺序不变。
4. 同一邮箱属于两个不同客户：默认 `customer` scope 两封都保留；`global` scope 只留最新。
5. 最新一封是 `Accepted`、旧的是 `Generated`：旧待审被隐藏；最新是 `Generated`、旧的是 `Accepted`：都显示（旧 Accepted 不被隐藏）。
6. 最新一封是 `Rejected`、旧的是 `Generated`：旧待审仍然显示（拒绝不抑制）。
7. 两封待审时间相同：保留邮件 ID 数字大的一封。
8. 空邮箱 / 只有空格：不参与合并。
9. `filterEmailRows` 客户过滤：按 `aiFilePath`、`customerLink` basename、客户路径分别命中；不匹配返回空。
10. 状态 / 搜索过滤后 `hiddenDuplicateCount` 只统计通过过滤的隐藏行；`showDuplicatePending` 打开时可见行包含它们。
11. 搜索只匹配旧待审时：默认可见 0 封、`hiddenDuplicateCount = 1`；打开开关后可见 1 封。
12. `emailRecencyMs`：优先 `updatedAt`，回退 `generatedAt` / 版本时间；非法时间按 0。

### 7.2 手动验收（Obsidian 内）

1. 给 A（联系人正常）和 B（没有联系人）跑一次 → A 主行「刚刚」，B 显示 `从未` + `⚠ 无可用联系人`；旧末尾状态列消失。
2. 再只给 C（有联系人）跑一次 → A、B 的「开发状态」**仍然在**（不再被 C 覆盖），B 的无联系人提醒没有丢。
3. 修复 B 的联系人后再生成 → B 主行「刚刚」，副行消失。
4. 筛选切到「≥1 天未生成（含从未）」→ A、B、C 消失，从未生成的 D 出现；切换「不限」→ 全部回来。
5. 勾选 D（从未生成）和 A（刚生成）→ 点生成 → 弹窗列出 A，默认「跳过并生成 1 家」→ 只给 D 生成。
6. 重复上一步但选「仍然全部生成」→ A 的 AI 文件新增邮件，ID 连续，不产生副本文件。
7. 设置冷却为 `0` → 不再弹冷却提示。
8. 拒绝 B 的唯一邮件 → B 显示 `已拒绝`，筛选和冷却都放行。
9. 手动删除 C 的 AI 文件 → C 主行变 `从未`，副行提示「上次已生成但文件缺失」；24h 内再次勾选 C 仍会被冷却拦截。
10. 把 D 改名但不改 AI 文件名（且未验收过）→ 主行变 `从未`，底部提示「有 AI 文件无法对应客户」；这是已知风险，不会被误判成别的客户。
11. 只用 Bases 视图重复 1–5 → 合并列、筛选、隐藏计数一致。
12. 重启 Obsidian → 筛选、冷却、每客户状态都还在。
13. 点 A 的「开发状态」单元格（主行右侧有 `✉2`）→ 邮件列表打开并带 `客户：A ×`，只显示 A 的邮件；点 `×` 回到全部；再点 B 的开发状态单元格切换筛选；点表头仍是排序，不跳转。
14. 对 A 的同一联系人强制生成两次 → 邮件列表默认只显示最新一封待审，计数 `已隐藏 1 封同邮箱旧待审`；勾选「显示重复待审」看到两封；更新时间列确认保留的是最新那封。
15. 验收最新那封 → 旧待审不再重新出现（被更新的 Accepted 压住）。
16. 同一邮箱同时出现在 A、B 两个客户下 → 默认各自保留一封（customer scope）；如果切到 global，只留全局最新。
17. 搜索一个只存在于旧待审里的关键词 → 默认可见 0 封，但显示 `有 1 封旧待审被合并`；勾选「显示重复待审」后能搜到。

### 7.3 命令

```bash
npm run typecheck
npm run test
npm run build
node scripts/smoke-load.cjs
```

---

## 8. 实施顺序（建议 7 个可验证提交）

| # | 提交 | 内容 | 验证 |
|---|---|---|---|
| 1 | `feat: 从 AI 开发信息推导客户最近生成时间` | 新增 `core/generation.ts` + 测试；`CustomerGeneration` 的 `filePath` / `pendingCount`；`EmailStore.listFiles()`；`plugin-api` 的 `getGenerationIndex` | `npm run test`、`npm run typecheck` |
| 2 | `feat: 持久化每客户上次开发结果并合并显示状态` | `run-status.ts` 的 `parseDevStatusMap`/`mergeDevStatuses`；`state-store` 的 `customer-status.json`；`core/dev-state.ts` + 测试；`main` 加载/合并/迁移 | 单测 + 重启后状态仍在 |
| 3 | `feat: 工作台合并开发状态列并按最近生成筛选排序` | `filters.ts` 的 `FilterRuntime`；`generationFilter` 设置；`table.ts` 去掉旧状态列；workbench 合并列/控件/排序/计数；样式 | 单测 + 手动 1–4 |
| 4 | `feat: Bases 视图支持合并开发状态与生成时间筛选` | `bases-view.ts` 控件、合并列、隐藏计数 | Bases 手动验收 |
| 5 | `feat: 客户邮件跳转与同邮箱待审合并` | 新增 `core/email-list.ts` + 测试；`EmailListView` 客户筛选/去重/开关；`openEmailListForCustomer`；两个工作台「开发状态」单元格跳转 | 单测 + 手动 13–17 |
| 6 | `feat: 生成前跳过冷却窗口内已生成的客户` | `runTasks` 冷却守卫（含 AI 文件缺失兜底）；`confirmChoice`；`generateCooldownHours` 设置项；运行中防双击 | 手动 5–9 |
| 7 | `docs: 说明最近生成筛选、合并状态、客户跳转与待审去重` | 更新 `docs/DESIGN.md` 模块图/关键决策、README 功能表；本方案落档 | 文档校对 + 全量命令 |

工作量估计：**2.5–3 人日**（core/状态合并 0.8、两个视图 0.6、邮件列表跳转与去重 0.5、守卫 0.3、测试与文档 0.5）。

---

## 9. 风险与后续

| 风险 | 影响 | 缓解 |
|---|---|---|
| `.state/customer-status.json` 随客户数增长 | 文件变大 | 每客户一条，常规量级可忽略；后续加清理命令 |
| 升级时新状态文件不存在 | 列上没有历史尝试 | 用 `last-run.json` 种子；生成时间本来就来自 AI 文件，不受影响 |
| 客户改名 | 旧尝试记录成为孤儿；未验收的客户主行变「从未」 | 生成时间按 basename 兜底，验收过的客户靠 `AI开发信息` 反查仍能匹配；底部提示孤立 AI 文件；后续可加「同步 AI 文件名」 |
| 同名客户 | 无法按名字归属 | 只认双链/反查；歧义按未知处理 |
| AI 文件损坏/被删 | 被当成「从未」→ 重复生成 | 0 封邮件一律 `unknown`；上次 `generated` 记录同时用于副行警告和冷却兜底 |
| 旧提醒看起来过时 | 用户误判 | 副行始终带相对时间；tooltip 给精确时间；有更晚成功生成就隐藏 |
| 用户不理解「开发状态」两行 | 误读 | 列头 tooltip 写明「主行最近生成，副行上次未解决的提醒」 |
| 默认筛选改变列表 | 升级后「客户变少」 | 默认值可调；计数行明确显示隐藏了多少家 |
| 同邮箱旧待审被隐藏，用户以为丢了 | 误判 | 只隐藏显示，不动文件；计数 + 「显示重复待审」开关；搜索不到时给出「有 N 封被合并」提示 |
| 同一邮箱属于多个客户 | 默认各自保留，可能重复联系同一地址 | 默认 `customer` scope；需要更严格时切 `global`（一个分组键的改动） |
| 客户改名/删文件后跳转筛选为空 | 打开后看不到邮件 | 优先 AI 文件路径，失败回退 link/name；空状态给「清除客户筛选」；后续加「同步 AI 文件名」 |
| 去重后「共 N 封」变少 | 与 AI 文件数量对不上 | 计数行同时显示隐藏数；开关可还原全部 |
| Bases API 变化 | 固定列/控件渲染异常 | 只依赖 `data/config/onDataUpdated`，已有约定不变 |

后续可选（本期不做）：

- 把「重新生成」也计入冷却（需要新增 `last_generated_at` 元数据，涉及 AI 文件往返契约与测试）。
- 本次被跳过的客户写进 `customer-status.json`，新增状态 `skipped_recent`，让副行显示「已跳过（冷却）」。
- 运行期间禁用生成按钮（`run-bar` 已支持 `running`，只差 `main` 维护状态）。
- 按「跟进次数 / 最近联系时间 / 最近生成」组合出「今日待开发」智能排序。
- `customer-status.json` 的清理命令（删除不存在客户、超过 365 天的记录）。

---

## 10. 需要确认的产品默认值

> 已确认（2026-11-17）：
> - 同邮箱最新一封已验收时，旧待审**隐藏**；
> - 跳转入口放在**「开发状态」单元格**（整体可点击 + `✉` 角标）。

1. **默认筛选**：工作台打开时默认「≥1 天未生成（含从未生成）」还是「不限」？
   - 推荐前者（直接符合本次需求，列表即待开发队列）。
2. **已拒绝邮件**：是否算「已生成」？
   - 推荐不算（允许当天重做），与文中口径一致。
3. **冷却时长**：固定 24 小时，还是设置项可调？
   - 推荐设置项可调，默认 24，0 关闭。
4. **合并列名**：叫「开发状态」（主行显示时间）还是「最近生成」？
   - 推荐「开发状态」：它同时承载时间与上次尝试提醒；若叫「最近生成」，副行的提醒会显得突兀。
5. **同邮箱去重范围**：同一客户（推荐）还是整个邮件列表全局？
   - 推荐同一客户：跳到某客户时不会被别的客户挤掉；全局更严格，但会跨客户隐藏草稿。
6. **「最新」怎么算**：按更新时间（推荐，和列表列一致）还是按首次生成时间？
   - 推荐更新时间：用户刚改过的那封才是要审核的那封。

这些大多只影响一个常量、文案或默认配置，代码结构不变；确认后即可按第 8 节开始实现。
