# Project Card Self Relation Labels Design

更新时间：2026-06-18

分支：`codex/project-card-self-relation-labels`

## Design Read

这是一个既有医疗科研协作平台的课题库卡片改造，不是营销页重设计。设计语言应保持当前白底、低饱和青蓝、紧凑信息层级和医疗协作产品的可信感，只增加清晰的个人关系提示和更近、更轻的资助选择入口。

## 背景与目标

用户希望在课题展示页的课题卡片左上角，以截图红色标注位置为参考，增加一个金色斜角标签。当登录用户本人已经参与、已经认领或已经资助某课题时，卡片应直接提示本人关系。

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

## 视觉设计

### 金色斜角标签

位置与范围：

- 仅在首页课题库 `#/` 的 `state.projects` 卡片上显示。
- 不依赖 `project-list-card` 作为唯一选择器，因为个人中心收藏卡片也使用该类。
- 首页卡片应增加更明确的类，例如 `project-catalog-card`，设计和测试都以该类限定。
- 个人中心 `#/dashboard` 的收藏、任务或我上传卡片默认不显示该斜角标签，避免与个人中心已有关系摘要重复。
- 标签固定在卡片左上角，视觉上贴近截图红色标注处。
- 标签应浮在卡片表层，但不压住 `.project-card-meta` 中的编号、主题、阶段、待资助/已获资助标签。

布局：

- `.project-card` 保持 `position: relative`。
- 新增一个独立元素，例如：

```html
<span v-if="selfRelationRibbonLabel(project)" class="project-self-ribbon">
  {{ selfRelationRibbonLabel(project) }}
</span>
```

- 卡片内容区顶部需要为斜角标签预留空间。建议只在存在标签时给卡片添加类：

```html
:class="{ 'has-self-ribbon': selfRelationRibbonLabel(project) }"
```

- `.project-card.has-self-ribbon .project-card-top` 增加左上内边距或上边距，避免普通标签和斜角标签重叠。
- 桌面优先使用左上预留区，移动端优先使用顶部预留高度，不只依赖左内边距。

外观：

- 主色为金色，建议使用低饱和金色，避免高亮黄干扰医疗产品可信感。
- 文案固定只允许三种之一：
  - `已参与`
  - `已认领`
  - `已资助`
- 字体 12px 左右，字重 800 或 900。
- 对比度必须满足 WCAG AA。金色底上建议使用深棕色文字。
- 标签以旋转方式形成斜角感，旋转角度建议 `-42deg` 到 `-45deg`。
- 标签宽度固定，避免不同文案导致卡片跳动。

层级：

- 标签 `z-index` 低于所有 modal、popover、toast 和悬浮联系人卡。
- 标签不响应点击，不阻断课题标题、卡片按钮和悬浮卡交互，使用 `pointer-events: none`。
- 建议 `z-index: 2` 到 `5`；当前联系人悬浮卡为 `z-index: 35`，斜角标签不得高于它。

### 多关系优先级

同一用户可能同时参与、认领和资助同一个课题。为避免多个斜角标签堆叠，卡片只显示一个斜角标签。这里的 active self relation 指 `pending` 或 `approved`，不包含 `withdrawn` 和 `rejected`。优先级为：

1. `已认领`
2. `已参与`
3. `已资助`

原因：

- 认领代表更高责任关系，优先提示。
- 参与代表执行关系，优先于资助。
- 资助表示本人已有待处理或已通过的资助意向，不等同于项目公共状态的“已获资助”。
- `已认领` 只对应项目负责人 `leader` 和论文第一单位 `paper_first_unit` 两类当前主流程认领，不把历史兼容认领类型提升为斜角标签。

### 普通标签避让

普通标签包括：

- 课题编号
- 主题
- 阶段
- `待资助` 或 `已获资助`

验收时必须确认它们与斜角标签不重叠。具体要求：

- 桌面宽度下，普通标签仍从左到右自然换行，不能被斜角标签遮挡。
- 小屏下，斜角标签保留，但卡片顶部内容可换行；不得遮挡课题标题。
- 斜角标签不能覆盖右侧点赞/关注统计和创建者信息。

## 状态规则

新增纯前端推导函数，建议命名：

```js
function selfRelationRibbonLabel(project) {
  if (hasSelfClaim(project)) return "已认领";
  if (hasSelfParticipation(project)) return "已参与";
  if (hasSelfSponsor(project)) return "已资助";
  return "";
}
```

建议定义：

- `hasSelfParticipation(project)`：存在 `viewer_state.interest_roles` 或当前本地 participation request 为 `pending` 或 `approved`。
- `hasSelfClaim(project)`：存在 `viewer_state.claim_types` 中的 `leader` 或 `paper_first_unit`，或本地 leader / paper first unit claim request 为 `pending` 或 `approved`。
- `hasSelfSponsor(project)`：存在 `viewer_state.sponsor_types`，或本地 sponsor request 为 `pending` 或 `approved`。

状态边界：

- 访客不显示斜角标签。
- 已撤回关系不显示。
- 已拒绝关系不显示。
- 取消参与、撤回认领、撤回资助后，局部刷新该课题并移除斜角标签。
- pending 资助可以显示 `已资助`，但不能让项目公共 `projectFundingLabel` 变成 `已获资助`。
- 本地 withdrawn / rejected 状态优先覆盖同类型的旧 `viewer_state.sponsor_types`，直到 `projectStatusCard` 或项目列表刷新返回最新服务端状态，避免撤回后短暂残留 `已资助`。

### 状态矩阵

| 本人关系 | pending | approved | rejected | withdrawn |
| --- | --- | --- | --- | --- |
| 普通参与 | `已参与` | `已参与` | 不显示 | 不显示 |
| 项目负责人认领 | `已认领` | `已认领` | 不显示 | 不显示 |
| 论文第一单位认领 | `已认领` | `已认领` | 不显示 | 不显示 |
| 其他兼容认领 | 不显示 | 不显示 | 不显示 | 不显示 |
| 资助算力 | `已资助` | `已资助` | 不显示 | 不显示 |
| 资助劳务费 | `已资助` | `已资助` | 不显示 | 不显示 |
| 资助 token | `已资助` | `已资助` | 不显示 | 不显示 |

如果存在多个 active self relation，按 `已认领`、`已参与`、`已资助` 的优先级只显示一个标签。

## 资助交互设计

### 入口

点击课题卡片底部的“资助”按钮：

- 如果已有可撤回资助意向，不再直接撤回第一条资助记录，而是打开同一个 popover 进行按类型管理。
- 如果当前阶段不可招募，按钮显示 `暂不资助` 且不可点击。
- 如果可以资助，打开贴近该按钮的轻量 popover，而不是居中大弹窗。
- 按钮有 active 资助关系时可显示 `管理资助`，没有 active 资助关系时显示 `资助`。

### Popover 内容

卡片快捷 popover 的主要内容只包含用户要求的两个 checkbox：

- `资助劳务费`
- `资助算力`

注意：AGENTS.md 当前规定前端主入口展示资助算力、资助 token、资助劳务费三类。本次快捷 popover 不移除全局 `token` 能力。实现时应保留 `preferredSponsorTypes()` 的三类排序，若页面仍存在完整资助表单或后续管理入口，`token` 继续可用；首页卡片快捷入口只突出本次要求的两项。

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
  - 斜角标签变为 `已资助`
- 部分成功后：
  - toast 明确展示成功和失败类型，例如：`已记录资助算力，资助劳务费提交失败`
  - 已成功的类型保留为本地关系
  - 斜角标签立即显示 `已资助`
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
- 用户勾选新的类型并提交，表示新增该类型资助。
- 一次提交中可以同时新增一种类型并撤回另一种类型。
- 当用户撤回其中一种类型但仍有其他 active 资助时，斜角标签保持 `已资助`。
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
- 断言斜角标签文案只包含 `已参与`、`已认领`、`已资助`。
- 断言样式存在 `.project-self-ribbon`、`.project-card.has-self-ribbon`。
- 断言 `.project-self-ribbon` 使用 `pointer-events: none`，避免遮挡点击。
- 断言 sponsor 快捷入口使用 fixed root popover，不渲染在 `.project-card` 内部。
- 断言 sponsor 快捷入口不再依赖单个 `<select v-model="state.forms.sponsor.sponsor_type">` 作为主要交互。
- 断言资助 checkbox 包含 `labor_fee` 和 `compute`。
- 断言 `preferredSponsorTypes()` 仍保留 `compute`、`token`、`labor_fee`，避免误删 token 能力。

### 前端逻辑测试

如现有测试结构允许，新增或扩展前端测试覆盖：

- `viewer_state.interest_roles = ["学生"]` 时返回 `已参与`。
- `viewer_state.claim_types = ["leader"]` 时返回 `已认领`。
- `viewer_state.sponsor_types = ["compute"]` 时返回 `已资助`。
- 同时存在 claim、interest、sponsor 时返回 `已认领`。
- rejected claim + approved participation 返回 `已参与`。
- pending claim + approved sponsor 返回 `已认领`。
- withdrawn sponsor + active participation 返回 `已参与`。
- 只有历史兼容 claim type 时不显示 `已认领`。
- withdraw 后本地状态不再显示斜角标签。
- sponsor 部分成功时，成功项 disabled，失败项可重试，且 `已资助` 标签出现。
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
3. 回到课题库，卡片左上角出现金色斜角 `已参与`。
4. 普通标签行中的编号、主题、阶段、资助状态不与斜角标签重叠。
5. 对另一个课题提交负责人认领或第一单位认领，卡片显示 `已认领`。
6. 点击资助按钮，按钮附近出现两个紧凑 checkbox。
7. 同时勾选资助劳务费和资助算力，提交后显示 `已资助`。
8. 资助提交后不刷新整个列表，当前筛选、滚动位置和课题卡展开状态必须保持。
9. 再次点击 `管理资助`，取消勾选其中一种资助并提交；若另一种仍 active，卡片仍显示 `已资助`。
10. 取消全部 active 资助后，卡片移除 `已资助`。

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
- 打开 sponsor popover 后，读取 popover 与 sponsor button 的 bounding box，断言最近边缘距离不超过 16px。
- 断言 popover bounding box 完全在 viewport 内。
- 断言 Escape 可以关闭 popover。
- 断言点击外部可以关闭 popover。
- 断言关闭后焦点返回 sponsor button。

## 严格验收标准

### 功能验收

- 本节 active self relation 只指 `pending` 或 `approved`，不指课题阶段 `active`。
- 登录用户本人有 pending 或 approved 参与关系时，卡片显示 `已参与`。
- 登录用户本人有 pending 或 approved 主流程认领关系时，卡片显示 `已认领`。
- 登录用户本人有 pending 或 approved 资助关系时，卡片显示 `已资助`。
- 同时存在多个关系时，只显示一个斜角标签，优先级为 `已认领`、`已参与`、`已资助`。
- 访客和无关系登录用户不显示斜角标签。
- withdrawn 和 rejected 关系不显示斜角标签。
- 首页卡片快捷资助 popover 只提供 `资助劳务费` 和 `资助算力` 两个主选项。
- 不删除 `资助 token` 的既有全局能力，除非同步更新 AGENTS.md、VERSION 和 CHANGELOG.md。
- 资助 checkbox 可多选。
- 新增资助模式下，未选择任何资助类型时不能提交。
- 管理资助模式下，取消全部已选资助类型后可以提交，结果为撤回全部 active 资助。
- 提交一个资助类型只产生对应一条 sponsor intent。
- 提交两个资助类型产生两条 sponsor intent。
- 已有 active 资助时，点击资助按钮打开管理 popover，不直接撤回任意一条资助。
- 撤回其中一种资助后，如果仍有其他 active 资助，斜角标签继续显示 `已资助`。
- 撤回全部 active 资助后，斜角标签移除。
- 资助成功后按钮和斜角标签状态更新有明确反馈。

### 视觉验收

- 斜角标签为金色系，并可读。
- 斜角标签文字与背景对比度至少 4.5:1。
- 斜角标签文案只能是 `已参与`、`已认领`、`已资助`。
- 斜角标签不遮挡编号、主题、阶段、资助状态标签。
- 斜角标签不遮挡课题标题。
- 斜角标签不遮挡点赞、关注、创建者信息。
- 普通标签行仍可换行。
- 卡片 hover 效果不让斜角标签抖动或错位。
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
- 不让 pending 或 rejected 资助显示为公共 `已获资助`。
- 不让单纯资助关系获得任务结果提交资格。
- 不展示邮箱。
- 不把旧 `ProjectTask` 或积分奖励流程带回主入口。

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
- 个人中心复用课题卡片模板时必须避免误显示斜角标签。默认本设计只要求首页课题库卡片显示，个人中心保持现状，避免重复表达。
