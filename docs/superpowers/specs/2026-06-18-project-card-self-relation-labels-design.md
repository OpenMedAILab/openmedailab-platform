# Project Card Self Relation Labels Design

更新时间：2026-06-18

分支：`codex/project-card-self-relation-labels`

## Design Read

这是一个既有医疗科研协作平台的课题库卡片改造，不是营销页重设计。设计语言应保持当前白底、低饱和青蓝、紧凑信息层级和医疗协作产品的可信感，只增加清晰的个人关系提示和更近、更轻的资助选择入口。

## 背景与目标

用户希望在课题展示页的课题卡片左上角，以截图红色标注位置为参考，增加一个金色斜角标签。当登录用户本人已经参与、已经认领或已经资助某课题时，卡片应直接提示本人关系，文案统一为 `我已认领`、`我已参与`、`我已资助`。

用户进一步要求：如果同一课题存在多个本人关系，最高优先级关系继续作为主提示，其余本人关系以金色小标签展示在 `Txxxx` 课题编号标签前面；与我有关的课题在列表中优先展示；与我有关的课题 hover 时顶部绿色/青蓝横线改为金色。

用户还希望点击课题卡片上的“资助”后，不再使用远距离的单选下拉体验，而是在点击位置附近出现两个距离不远的 checkbox，允许多选：

- 资助劳务费
- 资助算力

本设计先给出可实现规格和验收标准，不直接修改功能代码。

## 当前代码基线

相关代码集中在：

- `frontend/src/main.js`
  - 首页课题库卡片模板：约 `4612` 附近。
  - 个人中心收藏卡片复用 `project-list-card`：约 `5158` 附近，本次默认不加斜角标签。
  - 关系状态函数：`isParticipationRequested`、`isLeadClaimed`、`isPaperClaimed`、`sponsorRequestCanWithdraw`、`interactionButtonActive`。
  - 资助交互：`submitSponsor`、`submitSponsorModal`、`markProjectSponsorSubmitted`、`sponsorButtonLabel`。
  - 资助选项：`preferredSponsorTypes` 当前保留 `compute`、`token`、`labor_fee`；本次卡片快捷 popover 使用独立的两项选项，不改全局 helper。
- `frontend/src/styles.css`
  - 卡片布局：`.project-card`、`.project-card-top`、`.project-card-meta`、`.project-card-side`。
  - 标签样式：`.project-card-meta span`、`.project-stage-chip`、`.project-funding-chip`。
  - 小屏布局：约 `3990` 和 `4210` 附近媒体查询。
- `api/ninja_api.py`
  - `viewer_state` 当前返回 `interest_roles`、`claim_types`、`sponsor_types`。
  - `/api/projects/{id}/sponsor/` 当前一次提交一个 `sponsor_type`。
- `interactions/models.py`
  - `SponsorIntent` 以 `user + project + sponsor_type` 唯一。
  - `SponsorType` 已包含 `compute` 和 `labor_fee`。

## 方案选择

### 方案 A：前端复用现有 viewer_state 和 sponsor API

卡片斜角标签直接从 `project.viewer_state` 推导。资助多选在前端打开轻量 popover，提交时对选中的每个类型依次调用现有 `api.sponsor(project.id, { sponsor_type, note })`。

优点：

- 不新增 API，符合 AGENTS.md 7.1 的复用原则。
- 不改数据库结构，降低迁移风险。
- 与 `SponsorIntent` 的唯一约束天然兼容。
- 可以先用前端测试和少量后端现有测试覆盖。

缺点：

- 多选会产生多次请求。需要处理部分成功与部分失败的反馈。
- 当前 `state.sponsorRequestsByProjectId` 以 project id 只存一个请求，后续实现要调整为支持同一课题多个 sponsor intent 的本地状态表达。

### 方案 B：新增后端批量 sponsor API

新增 `/api/projects/{id}/sponsor/bulk/` 或扩展当前 sponsor request 支持数组。

优点：

- 多选提交语义更原子。
- 服务器端可以一次性返回全部 sponsor intent。

缺点：

- 新增或改变 API 语义，违反“能复用 API 就不新增 API”的默认原则。
- 需要更多后端测试、审计路径和错误结构设计。
- 对本次小更新来说风险偏高。

### 推荐

采用方案 A。只有在实现中确认前端连续提交无法满足审计、反馈或一致性要求时，再升级到方案 B。

### 实施拆分建议

本设计可以拆成两个可独立验收的实现单元，避免一次改动过大：

1. 本人关系标签与排序：主斜角标签、`Txxxx` 前的次级金色小标签、本人关系优先排序、本人关系 hover 金色顶线。
2. 资助快捷 popover：劳务费和算力两个 checkbox、多类型 sponsor intent 本地状态、按类型新增和撤回。

如果分阶段实现，第一阶段不得破坏现有资助入口；第二阶段不得回退第一阶段的标签、排序和 hover 验收。

## 视觉设计

### 金色本人关系标签

位置与范围：

- 仅在首页课题库 `#/` 的 `state.projects` 卡片上显示。
- 不依赖 `project-list-card` 作为唯一选择器，因为个人中心收藏卡片也使用该类。
- 首页卡片应增加更明确的类，例如 `project-catalog-card`，设计和测试都以该类限定。
- 个人中心 `#/dashboard` 的收藏、任务或我上传卡片默认不显示该斜角标签，避免与个人中心已有关系摘要重复。
- 主标签固定在卡片左上角，视觉上贴近截图红色标注处。
- 主标签应浮在卡片表层，但不压住 `.project-card-meta` 中的编号、主题、阶段、待资助/已获资助标签。
- 多关系时，除主标签外的其余关系以金色小标签插入 `.project-card-meta` 最前面，也就是 `Txxxx` 课题编号标签前面。

布局：

- `.project-card` 保持 `position: relative`。
- 新增一个独立元素，例如：

```html
<span v-if="selfRelationRibbonLabel(project)" class="project-self-ribbon">
  {{ selfRelationRibbonLabel(project) }}
</span>
```

- 在 `.project-card-meta` 中，课题编号前增加次级本人关系小标签，例如：

```html
<span
  v-for="label in secondarySelfRelationLabels(project)"
  :key="label"
  class="project-self-meta-chip"
>
  {{ label }}
</span>
<span>{{ topicCode(project) }}</span>
```

- 卡片内容区顶部需要为斜角标签预留空间。建议只在存在标签时给卡片添加类：

```html
:class="{ 'has-self-ribbon': selfRelationRibbonLabel(project) }"
```

- `.project-card.has-self-ribbon .project-card-top` 增加左上内边距或上边距，避免普通标签和斜角标签重叠。
- 桌面优先使用左上预留区，移动端优先使用顶部预留高度，不只依赖左内边距。

外观：

- 主色为金色，建议使用低饱和金色，避免高亮黄干扰医疗产品可信感。
- 主标签和次级小标签文案固定只允许三种之一：
  - `我已认领`
  - `我已参与`
  - `我已资助`
- 字体 12px 左右，字重 800 或 900。
- 对比度必须满足 WCAG AA。金色底上建议使用深棕色文字。
- 主标签以旋转方式形成斜角感，旋转角度建议 `-42deg` 到 `-45deg`。
- 主标签宽度固定，避免不同文案导致卡片跳动。
- 次级小标签不旋转，使用与普通 meta 标签一致的高度和圆角，但改为金色系。

层级：

- 主标签 `z-index` 低于所有 modal、popover、toast 和悬浮联系人卡。
- 主标签不响应点击，不阻断课题标题、卡片按钮和悬浮卡交互，使用 `pointer-events: none`。
- 建议主标签 `z-index: 2` 到 `5`；当前联系人悬浮卡为 `z-index: 35`，斜角标签不得高于它。
- 次级小标签在正常文档流中，不使用额外浮层。

### 多关系优先级

同一用户可能同时参与、认领和资助同一个课题。为避免多个斜角标签堆叠，卡片只显示一个主斜角标签。这里的 active self relation 指 `pending` 或 `approved`，不包含 `withdrawn` 和 `rejected`。主标签优先级为：

1. `我已认领`
2. `我已参与`
3. `我已资助`

原因：

- 认领代表更高责任关系，优先提示。
- 参与代表执行关系，优先于资助。
- 资助表示本人已有待处理或已通过的资助意向，不等同于项目公共状态的“已获资助”。
- `我已认领` 只对应项目负责人 `leader` 和论文第一单位 `paper_first_unit` 两类当前主流程认领，不把历史兼容认领类型提升为本人关系标签。
- 如果存在多个 active self relation，最高优先级关系显示为主斜角标签，其余关系按同一优先级顺序作为次级金色小标签显示在 `Txxxx` 课题编号前面。

示例：

| active self relation | 主斜角标签 | `Txxxx` 前的次级小标签 |
| --- | --- | --- |
| 认领 | `我已认领` | 无 |
| 参与 + 资助 | `我已参与` | `我已资助` |
| 认领 + 参与 | `我已认领` | `我已参与` |
| 认领 + 参与 + 资助 | `我已认领` | `我已参与`、`我已资助` |

### 普通标签避让

普通标签包括：

- 课题编号
- 主题
- 阶段
- `待资助` 或 `已获资助`
- 多关系次级小标签

验收时必须确认它们与斜角标签不重叠。具体要求：

- 桌面宽度下，次级小标签在 `Txxxx` 前方，普通标签仍从左到右自然换行，不能被斜角标签遮挡。
- 小屏下，斜角标签保留，但卡片顶部内容可换行；不得遮挡课题标题。
- 斜角标签不能覆盖右侧点赞/关注统计和创建者信息。

## 状态规则

新增纯前端推导函数，建议命名：

```js
function selfRelationLabels(project) {
  return [
    hasSelfClaim(project) ? "我已认领" : "",
    hasSelfParticipation(project) ? "我已参与" : "",
    hasSelfSponsor(project) ? "我已资助" : ""
  ].filter(Boolean);
}

function selfRelationRibbonLabel(project) {
  return selfRelationLabels(project)[0] || "";
}

function secondarySelfRelationLabels(project) {
  return selfRelationLabels(project).slice(1);
}

function selfRelationSortRank(project) {
  if (hasSelfClaim(project)) return 0;
  if (hasSelfParticipation(project)) return 1;
  if (hasSelfSponsor(project)) return 2;
  return 3;
}

function hasSelfRelation(project) {
  return selfRelationSortRank(project) < 3;
}

function hasSelfRelationHoverLine(project) {
  return hasSelfRelation(project);
}
```

如果实现拆分为多个 helper，最终语义必须等价。

排序函数必须与标签优先级一致：

```js
function selfRelationSortRank(project) {
  if (hasSelfClaim(project)) return 0;
  if (hasSelfParticipation(project)) return 1;
  if (hasSelfSponsor(project)) return 2;
  return 3;
}
```

hover 顶线判断：

```js
function hasSelfRelationHoverLine(project) {
  return selfRelationSortRank(project) < 3;
}
```

建议定义：

- `hasSelfParticipation(project)`：存在 `viewer_state.interest_roles` 或当前本地 participation request 为前端提交中的 `pending` 或已返回的 `approved`。
- `hasSelfClaim(project)`：存在 `viewer_state.claim_types` 中的 `leader` 或 `paper_first_unit`，或本地 leader / paper first unit claim request 为 `pending` 或 `approved`。其中 `pending` 可以是服务端真实待审状态。
- `hasSelfSponsor(project)`：存在 `viewer_state.sponsor_types`，或本地 sponsor request 为 `pending` 或 `approved`。

状态边界：

- 访客不显示斜角标签。
- 已撤回关系不显示。
- 已拒绝关系不显示。
- 普通参与在服务端仍必须自动 `approved`，不进入管理员审批；矩阵中的普通参与 `pending` 只允许表示前端提交中或响应尚未同步完成的瞬态 UI 状态。
- 项目负责人认领和论文第一单位认领提交后为服务端真实 `pending`，需要管理员审批；`pending` 和 `approved` 都可作为 `我已认领` 标签来源，但只有 `approved` 才能触发需要已通过关系的后续资格。
- 其他兼容认领类型仍按旧逻辑自动通过，但不提升为 `我已认领` 标签。
- 取消参与、撤回认领、撤回资助后，局部刷新该课题并移除斜角标签。
- pending 资助可以显示 `我已资助`，但不能让项目公共 `projectFundingLabel` 变成 `已获资助`。
- 本地 withdrawn / rejected 状态优先覆盖同类型的旧 `viewer_state.sponsor_types`，直到 `projectStatusCard` 或项目列表刷新返回最新服务端状态，避免撤回后短暂残留 `我已资助`。

### 状态矩阵

| 本人关系 | pending | approved | rejected | withdrawn |
| --- | --- | --- | --- | --- |
| 普通参与 | `我已参与` | `我已参与` | 不显示 | 不显示 |
| 项目负责人认领 | `我已认领` | `我已认领` | 不显示 | 不显示 |
| 论文第一单位认领 | `我已认领` | `我已认领` | 不显示 | 不显示 |
| 其他兼容认领 | 不显示 | 不显示 | 不显示 | 不显示 |
| 资助算力 | `我已资助` | `我已资助` | 不显示 | 不显示 |
| 资助劳务费 | `我已资助` | `我已资助` | 不显示 | 不显示 |
| 资助 token | `我已资助` | `我已资助` | 不显示 | 不显示 |

如果存在多个 active self relation，按 `我已认领`、`我已参与`、`我已资助` 的优先级选择主斜角标签，其余关系显示为 `Txxxx` 前的次级金色小标签。

## 展示排序设计

登录用户查看课题库时，所有与我有关的课题优先排在前面。本人关系排序优先级与标签优先级一致：

1. `我已认领`
2. `我已参与`
3. `我已资助`
4. 无本人关系

排序规则：

- 访客列表排序不变。
- 登录用户列表先按 `selfRelationSortRank(project)` 排序。
- 同一本人关系分组内，继续沿用用户当前选择的排序规则：
  - 默认排序：课题编号 `topic_id` 正序。
  - 最新编号：课题编号 `topic_id` 倒序。
  - 最近更新：`updated_at` 倒序。
- 如果一个课题同时有多个本人关系，只按最高优先级关系进入分组。例如同时认领和资助，归入 `我已认领` 分组。
- 搜索、主题筛选和分页都必须遵守本人关系优先级。仅在前端对当前页排序不够严格，因为与我有关的课题可能在后续页；实现时应优先在后端 `project_list` 查询层稳定排序，或确保前端拿到完整筛选结果后再分页。
- 这个排序会改变登录用户课题库的展示语义。实现该排序时必须同步更新 AGENTS.md 的公开课题列表排序规则、VERSION、CHANGELOG.md、`/api/meta/` 版本展示语义和前端版本弹窗内容。

验收示例：

| 用户关系 | 当前排序 | 预期结果 |
| --- | --- | --- |
| 有认领、参与、资助和无关系课题 | 默认排序 | 所有 `我已认领` 课题在最前，其次 `我已参与`，其次 `我已资助`，最后无关系；每组内按 `topic_id` 正序 |
| 有认领、参与、资助和无关系课题 | 最新编号 | 本人关系分组顺序不变，每组内按 `topic_id` 倒序 |
| 有认领、参与、资助和无关系课题 | 最近更新 | 本人关系分组顺序不变，每组内按 `updated_at` 倒序 |

## Hover 顶线设计

当前 `.project-card::before` 在 hover 时显示青绿到蓝色的顶部横线。新增规则：

- 无本人关系课题保持现有 hover 顶线颜色。
- 有任一本人关系的课题，也就是显示 `我已认领`、`我已参与` 或 `我已资助` 的课题，hover 顶线改为金色。
- 金色 hover 顶线不改变卡片布局高度，不造成内容抖动。
- 建议实现为条件 class，例如 `.project-card.has-self-relation:hover::before` 或 `.project-card.self-related:hover::before`。
- 金色顶线应与本人关系标签使用同一金色 token 或同一色系，避免出现两个不一致的金色。
- 金色顶线只在 hover 或 focus-visible 触发时出现，不要求默认常驻。

## 资助交互设计

### 入口

点击课题卡片底部的“资助”按钮：

- 如果已有可撤回资助意向，不再直接撤回第一条资助记录，而是打开同一个 popover 进行按类型管理。
- 如果当前阶段不可招募且用户没有 active 资助意向，按钮显示 `暂不资助` 且不可点击。
- 如果当前阶段不可招募但用户已有 active 资助意向，按钮仍显示 `管理资助` 并可打开管理 popover；此时禁止新增资助类型，但必须允许撤回已有 active 资助。
- 如果当前阶段可以资助，打开贴近该按钮的轻量 popover，而不是居中大弹窗。
- 按钮有 active 资助关系时可显示 `管理资助`，没有 active 资助关系时显示 `资助`。

### Popover 内容

卡片快捷 popover 的主要内容只包含用户要求的两个 checkbox：

- `资助劳务费`
- `资助算力`

注意：AGENTS.md 当前规定前端主入口展示资助算力、资助 token、资助劳务费三类。本次快捷 popover 不移除全局 `token` 能力。实现时应保留 `preferredSponsorTypes()` 的三类排序，并确认 `资助 token` 仍有用户可见、可到达的入口，例如完整资助表单或后续管理入口；如果最终产品决定完全移除或隐藏 token 资助，必须同步更新 AGENTS.md、VERSION、CHANGELOG.md、`/api/meta/` 和前端版本弹窗。

布局：

- checkbox 之间距离控制在 8px 到 12px，视觉上“不太远”。
- popover 宽度建议 220px 到 280px，最大宽度为 `calc(100vw - 24px)`。
- popover 靠近触发按钮，优先显示在按钮上方或下方；popover 与触发按钮的最近边缘距离不超过 16px。
- popover 使用独立根节点和 `position: fixed`，根据触发按钮的 `getBoundingClientRect()` 定位，不能渲染在 `.project-card` 内部，否则会被 `.project-card { overflow: hidden; }` 裁切。
- 小屏下允许退化为底部小面板，但宽度必须 clamp 到视口内，仍保持两个 checkbox 紧凑排列。

文案：

- 标题：`选择资助类型`
- 帮助文案：`可多选，提交后由管理员审核。`
- 操作按钮：`提交资助`、`取消`

无障碍：

- 使用原生 checkbox。
- 每个 checkbox 必须有可点击 label。
- 触发按钮设置 `aria-expanded` 和 `aria-controls`。
- popover 打开后焦点进入第一个可操作 checkbox。
- Escape 关闭 popover。
- 点击外部关闭 popover。
- 关闭后焦点返回触发资助按钮。
- 新增资助模式下，未选择任何 checkbox 时提交按钮禁用。
- 管理资助模式下，如果已有 active 资助，取消全部 checkbox 是有效提交，表示撤回全部 active 资助。

层级：

- 斜角标签低于联系人悬浮卡。
- sponsor popover 高于联系人悬浮卡和 topbar，低于 form modal、toast 和 confirm dialog。
- 建议 sponsor popover 使用 `z-index: 120` 到 `180`。当前 form modal 约 `310`、toast 约 `850`、confirm 约 `900`，不得超过这些层级。

### 提交行为

用户可以同时勾选一个或两个资助类型。

提交时：

- 对每个选中类型调用一次现有 `api.sponsor(project.id, payload)`。
- payload 的 `sponsor_type` 只允许：
  - `labor_fee`
  - `compute`
- 可保留说明字段，但本次交互不强制展示说明输入框。若保留说明，必须折叠或弱化，不影响两个 checkbox 的主任务。
- 全部成功后：
  - toast：`资助意向已记录`
  - 关闭 popover
  - 局部刷新该课题状态
  - 斜角标签变为 `我已资助`
- 部分成功后：
  - toast 明确展示成功和失败类型，例如：`已记录资助算力，资助劳务费提交失败`
  - 已成功的类型保留为本地关系
  - 斜角标签立即显示 `我已资助`
  - popover 保持打开
  - 已成功 checkbox 保持 checked 且 disabled，失败项保持可勾选和可重试
  - 重试只发送失败项，不重复发送已成功项
- 全部失败后：
  - popover 保持打开
  - 展示后端错误信息，不只显示“失败”

已有资助时：

- popover 打开时，已有 active 类型默认 checked。
- 已有 active 类型旁边显示 `待审核` 或 `已通过`，来自 sponsor request 的 `status_label`。
- 用户取消勾选已有 active 类型并提交，表示撤回该类型资助。
- 在开放招募和组队中，用户勾选新的类型并提交，表示新增该类型资助。
- 在开放招募和组队中，一次提交可以同时新增一种类型并撤回另一种类型。
- 在不可招募阶段，popover 只用于管理已有 active 资助；新类型 checkbox 必须不可新增或提交时被忽略并提示。
- 当用户撤回其中一种类型但仍有其他 active 资助时，斜角标签保持 `我已资助`。
- 当用户撤回所有 active 资助后，斜角标签移除。
- 管理资助模式下允许全部 checkbox 处于未选中状态并提交，提交含义为撤回所有 active 资助。

### 本地状态调整

当前 `state.sponsorRequestsByProjectId` 每个 project id 只存一个 sponsor request。本需求会出现同一课题多种资助类型，因此实现时应调整为按 project id 存数组或字典。

推荐结构：

```js
state.sponsorRequestsByProjectId = {
  [projectId]: {
    compute: sponsorRequest,
    labor_fee: sponsorRequest
  }
};
```

兼容要求：

- `sponsorRequestForProject(project)` 不再用于执行撤回，只可作为兼容读取首个 active request 的辅助。
- 新增 `sponsorRequestsForProject(project)` 返回当前课题全部 active sponsor intents。
- `hasSelfSponsor(project)` 应检查所有 active sponsor intents。
- `sponsorRequestCanWithdraw(project)`、`sponsorButtonLabel(project)`、`interactionButtonActive("sponsor", project)` 都应基于 active sponsor intents 集合。
- `syncDashboard`、`markProjectSponsorSubmitted`、`markProjectSponsorWithdrawn` 需要支持同一课题多个 sponsor intents。
- `applyProjectViewerState` 需要同步 sponsor 本地状态与 `viewer_state.sponsor_types`，并让本地 withdrawn / rejected 覆盖对应服务端旧值。

## 数据与 API 设计

默认不新增 API。

沿用：

- `POST /api/projects/{id}/sponsor/`
- `PATCH /api/me/interactions/sponsor/{id}/withdraw/`
- `GET /api/projects/{id}/status-card/`
- `GET /api/projects/`

所有前端请求必须继续经过 `frontend/src/api.js` 的统一 `request` 或 `requestForm` 包装，不在 `frontend/src/main.js` 中直接 `fetch`。

后端当前支持 `SponsorIntent` 按 `sponsor_type` 唯一，因此同一用户同一课题可同时存在 `compute` 和 `labor_fee` 两条记录。

不改变：

- 资助仍为 `pending`，由管理员审批。
- 资助不自动推进课题到进行中。
- pending 或 rejected 资助不得显示为公共 `已获资助`。
- 资助关系不赋予任务结果提交资格。

## 测试设计

### 前端源码结构测试

更新 `frontend/src/uiPlacement.test.js`：

- 断言课题卡片模板包含 `project-self-ribbon`。
- 断言首页卡片包含 `project-catalog-card` 或等效限定类。
- 断言个人中心复用卡片默认不包含 `project-self-ribbon`。
- 断言存在 `selfRelationRibbonLabel(project)`。
- 断言存在 `selfRelationLabels(project)`、`secondarySelfRelationLabels(project)`、`selfRelationSortRank(project)` 或等效 helper。
- 断言斜角标签和次级本人关系小标签文案只包含 `我已参与`、`我已认领`、`我已资助`。
- 断言 `.project-card-meta` 中次级本人关系小标签渲染在 `Txxxx` 课题编号前面。
- 断言样式存在 `.project-self-ribbon`、`.project-self-meta-chip`、`.project-card.has-self-ribbon`。
- 断言样式存在本人关系 hover 顶线规则，例如 `.project-card.has-self-relation:hover::before` 或 `.project-card.self-related:hover::before`。
- 断言 `.project-self-ribbon` 使用 `pointer-events: none`，避免遮挡点击。
- 断言有本人关系的首页卡片拥有 `has-self-relation`、`self-related` 或等效 class。
- 断言 sponsor 快捷入口使用 fixed root popover，不渲染在 `.project-card` 内部。
- 断言 sponsor 快捷入口不再依赖单个 `<select v-model="state.forms.sponsor.sponsor_type">` 作为主要交互。
- 断言资助 checkbox 包含 `labor_fee` 和 `compute`。
- 断言 `preferredSponsorTypes()` 仍保留 `compute`、`token`、`labor_fee`，避免误删 token 能力。

### 前端逻辑测试

如现有测试结构允许，新增或扩展前端测试覆盖：

- `viewer_state.interest_roles = ["学生"]` 时主斜角标签返回 `我已参与`。
- `viewer_state.claim_types = ["leader"]` 时主斜角标签返回 `我已认领`。
- `viewer_state.sponsor_types = ["compute"]` 时主斜角标签返回 `我已资助`。
- 同时存在 claim、interest、sponsor 时，`selfRelationLabels(project)` 返回 `["我已认领", "我已参与", "我已资助"]`。
- 同时存在 claim、interest、sponsor 时，主斜角标签返回 `我已认领`，次级小标签返回 `["我已参与", "我已资助"]`。
- 参与 + 资助时，主斜角标签返回 `我已参与`，次级小标签返回 `["我已资助"]`。
- rejected claim + approved participation 返回 `我已参与`。
- pending claim + approved sponsor 返回 `我已认领`。
- withdrawn sponsor + active participation 返回 `我已参与`。
- 只有历史兼容 claim type 时不显示 `我已认领`。
- withdraw 后本地状态不再显示斜角标签。
- `selfRelationSortRank(project)` 对认领、参与、资助、无关系分别返回 `0`、`1`、`2`、`3` 或等效可稳定排序的值。
- 登录用户课题列表排序优先级为 `我已认领`、`我已参与`、`我已资助`、无关系，且组内保留当前排序规则。
- sponsor 部分成功时，成功项 disabled，失败项可重试，且 `我已资助` 标签出现。
- sponsor 重试只发送失败项。

### 后端测试

若不改 API，仅补充现有测试即可：

- 同一用户同一课题可提交 `compute` 和 `labor_fee` 两种资助意向。
- `viewer_state.sponsor_types` 同时包含两个类型。
- status card 的公共资助计数仍只统计 approved。
- pending 资助不改变公共 funded 状态。

### 浏览器验收

桌面宽度：

1. 登录普通用户。
2. 对一个开放招募课题提交参与。
3. 回到课题库，卡片左上角出现金色斜角 `我已参与`。
4. 普通标签行中的编号、主题、阶段、资助状态不与斜角标签重叠。
5. 对另一个课题提交负责人认领或第一单位认领，卡片显示 `我已认领`。
6. 点击资助按钮，按钮附近出现两个紧凑 checkbox。
7. 同时勾选资助劳务费和资助算力，提交后显示 `我已资助`。
8. 资助提交后不刷新整个列表，当前筛选、滚动位置和课题卡展开状态必须保持。
9. 再次点击 `管理资助`，取消勾选其中一种资助并提交；若另一种仍 active，卡片仍显示 `我已资助`。
10. 取消全部 active 资助后，卡片移除 `我已资助`。
11. 对同一个课题形成参与 + 资助关系时，主斜角标签显示 `我已参与`，`Txxxx` 课题编号前显示金色次级小标签 `我已资助`。
12. 对同一个课题形成认领 + 参与 + 资助关系时，主斜角标签显示 `我已认领`，`Txxxx` 课题编号前依次显示 `我已参与`、`我已资助`。
13. 登录用户课题库中，`我已认领` 课题排在 `我已参与` 前面，`我已参与` 排在 `我已资助` 前面，三类都排在无本人关系课题前面。
14. hover 与我有关的课题时，顶部横线为金色；hover 无本人关系课题时，顶部横线保持现有青绿/蓝色。

小屏宽度：

1. 打开课题库。
2. 有斜角标签的卡片不产生横向滚动。
3. 斜角标签不遮挡课题标题。
4. 资助 popover 不超出屏幕，checkbox 仍可点击。
5. 触控目标不小于 44px 高或有等效点击区域。
6. 必须覆盖 320px、360px、390px 三个宽度，且页面 `document.documentElement.scrollWidth <= window.innerWidth`。

自动化浏览器验收：

- 使用 Playwright 或当前可用浏览器工具检查桌面 1440px 和移动 390px。
- 读取 `.project-self-ribbon` 与 `.project-card-meta`、`.project-title-link` 的 bounding box，断言没有相交。
- 读取 `.project-self-meta-chip`、`Txxxx` 课题编号标签、`.project-title-link` 的 bounding box，断言次级小标签在编号前方且不遮挡标题。
- 读取当前可见课题卡的本人关系 class 或标签文本，断言列表顺序符合 `我已认领`、`我已参与`、`我已资助`、无关系。
- hover 有本人关系卡片并读取顶部横线颜色，断言为金色系；hover 无本人关系卡片并读取顶部横线颜色，断言仍为既有青绿/蓝色系。
- 打开 sponsor popover 后，读取 popover 与 sponsor button 的 bounding box，断言最近边缘距离不超过 16px。
- 断言 popover bounding box 完全在 viewport 内。
- 断言 Escape 可以关闭 popover。
- 断言点击外部可以关闭 popover。
- 断言关闭后焦点返回 sponsor button。

## 严格验收标准

### 功能验收

- 本节 active self relation 只指 `pending` 或 `approved`，不指课题阶段 `active`。
- 登录用户本人有 approved 参与关系，或前端提交中的 pending 参与状态时，卡片显示 `我已参与`。
- 登录用户本人有 pending 或 approved 主流程认领关系时，卡片显示 `我已认领`。
- 登录用户本人有 pending 或 approved 资助关系时，卡片显示 `我已资助`。
- 同时存在多个关系时，只显示一个主斜角标签，优先级为 `我已认领`、`我已参与`、`我已资助`。
- 同时存在多个关系时，未作为主斜角标签展示的其余本人关系必须以金色次级小标签展示在 `Txxxx` 课题编号前面。
- 登录用户课题库展示顺序必须优先为 `我已认领`、`我已参与`、`我已资助`、无本人关系；每个关系分组内继续遵守用户当前选择的排序规则。
- 访客和无关系登录用户不显示斜角标签。
- withdrawn 和 rejected 关系不显示斜角标签。
- 首页卡片快捷资助 popover 只提供 `资助劳务费` 和 `资助算力` 两个主选项。
- `资助 token` 的既有全局能力仍必须有用户可见且可到达的入口，除非同步更新 AGENTS.md、VERSION、CHANGELOG.md、`/api/meta/` 和前端版本弹窗。
- 资助 checkbox 可多选。
- 新增资助模式下，未选择任何资助类型时不能提交。
- 管理资助模式下，取消全部已选资助类型后可以提交，结果为撤回全部 active 资助。
- 不可招募阶段禁止新增资助类型，但已有 active 资助仍可通过 `管理资助` 撤回。
- 提交一个资助类型只产生对应一条 sponsor intent。
- 提交两个资助类型产生两条 sponsor intent。
- 已有 active 资助时，点击资助按钮打开管理 popover，不直接撤回任意一条资助。
- 撤回其中一种资助后，如果仍有其他 active 资助，斜角标签继续显示 `我已资助`。
- 撤回全部 active 资助后，斜角标签移除。
- 资助成功后按钮和斜角标签状态更新有明确反馈。

### 视觉验收

- 斜角标签为金色系，并可读。
- 斜角标签文字与背景对比度至少 4.5:1。
- 主斜角标签和次级本人关系小标签文案只能是 `我已参与`、`我已认领`、`我已资助`。
- 次级本人关系小标签在 `Txxxx` 课题编号前面，且同样为金色系。
- 斜角标签不遮挡编号、主题、阶段、资助状态标签。
- 斜角标签不遮挡课题标题。
- 斜角标签不遮挡点赞、关注、创建者信息。
- 普通标签行仍可换行。
- 卡片 hover 效果不让斜角标签抖动或错位。
- 与我有关的课题 hover 顶部横线为金色系；无本人关系课题 hover 顶部横线保持现有青绿/蓝色系。
- 小屏不出现横向滚动。
- 金色斜角标签尺寸固定，任一文案不引起卡片布局跳动。

### 交互验收

- 点击资助按钮后，popover 距离按钮近，checkbox 间距在 8px 到 12px。
- popover 与按钮最近边缘距离不超过 16px。
- popover 不被卡片 `overflow: hidden` 裁切。
- 点击外部、取消按钮或 Escape 能关闭 popover。
- popover 打开时焦点管理明确，键盘可操作。
- popover 关闭后焦点返回触发按钮。
- 提交中按钮禁用，避免重复提交。
- 部分失败时给出明确提示，并允许重试失败项。
- 成功、失败和取消都有可理解反馈。

### 产品规则验收

- 不新增同义 API。
- 不改变课题生命周期。
- 不改变管理员审批资助的规则。
- 不改变项目负责人认领和论文第一单位认领需要管理员审批并返回审核意见的规则。
- 不让 pending 或 rejected 资助显示为公共 `已获资助`。
- 不让单纯资助关系获得任务结果提交资格。
- 普通参与提交后仍由后端自动 `approved`，不得新增管理员审批或持久 pending 审批流。
- 不展示邮箱。
- 不把旧 `ProjectTask` 或积分奖励流程带回主入口。
- 实现登录用户课题库本人关系优先排序时，必须同步更新 AGENTS.md、VERSION、CHANGELOG.md、`/api/meta/` 和前端版本弹窗，因为这改变了用户可感知的列表排序规则。

### 必跑命令

实现完成后必须运行：

```bash
conda run -n openmedailab python manage.py check
conda run -n openmedailab python manage.py test
node --test frontend/src/*.test.js
node --check frontend/src/main.js
git diff --check
```

涉及前端视觉和交互实现时，还必须执行浏览器验收中的自动化 bounding box、focus、Escape、outside click 和移动端横向滚动检查。不能只依赖源码正则测试声称视觉通过。

如果仅修改本文档，至少运行：

```bash
git diff --check
rg -n 'TO[D]O|TB[D]|FIX[M]E|待[定]|不确[定]' docs/superpowers/specs/2026-06-18-project-card-self-relation-labels-design.md
```

## 非目标

- 不重设计课题卡整体视觉语言。
- 不修改课题生命周期。
- 不新增管理员审批类型。
- 不恢复参与审批。
- 不新增邮箱、真实姓名或敏感信息展示。
- 不在本阶段实现功能代码。

## 开放风险

- 当前资助本地状态按课题只存一条 request，多选资助需要调整为多 request 结构。
- 当前 sponsor modal 是全局居中弹窗，改为 fixed 根节点 popover 后需要仔细处理 z-index、焦点和小屏定位。
- 如果连续提交两个 sponsor intent 中一个失败，需要明确前端状态与后端事实一致。
- 与我有关课题优先排序如果只在前端当前页处理，会漏掉后续页的本人关系课题；实现时需要在后端排序或前端完整数据分页之间做明确取舍。
- 个人中心复用课题卡片模板时必须避免误显示斜角标签。默认本设计只要求首页课题库卡片显示，个人中心保持现状，避免重复表达。
