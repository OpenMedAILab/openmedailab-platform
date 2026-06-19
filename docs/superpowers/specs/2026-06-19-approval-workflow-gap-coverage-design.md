# 申请审批流程缺口补齐设计方案

更新时间：2026-06-19

状态：方案待审，未进入代码实现

关联基线：

- `AGENTS.md` 2.4、2.6、2.9
- `docs/superpowers/specs/2026-06-18-claim-approval-button-state-design.md`
- `docs/pm-full-site-audit-2026-06-19.md`

使用 skill：

- `ui-ux-pro-max`：用于表单反馈、管理后台、可访问性、移动端和真实浏览器验收标准。
- `superpowers:brainstorming`：用于把现有问题收敛为可审阅的产品设计。
- `superpowers:writing-plans`：用于把设计拆成可执行、可验收的实施阶段。
- `superpowers:dispatching-parallel-agents`：用于后续多 agent 并行审核。

## 1. 目标

补齐申请审批流程的产品体验缺口，使认领项目负责人、论文第一单位认领、资助意向这三类需要审批的申请，从“可提交、可审核”升级为“用户知道申请进展、管理员有足够信息做判断、拒绝后用户知道如何修正、验收能通过真实浏览器操作证明”的完整流程。

本方案不改变以下已确认基线：

- 普通参与自动通过，不进入管理员审批。
- 项目负责人认领和论文第一单位认领提交后为 `pending`，由管理员审批。
- 资助意向提交后为 `pending`，由管理员审批。
- 课题卡片上，本人认领 `pending` 时只显示 `项目负责人审批中` 或 `第一单位认领审批中`，不显示通过后撤回入口。
- 只有认领 `approved` 后，课题卡片才显示 `撤回项目负责人认领` 或 `撤回论文第一单位认领`。
- 同一课题同一时间最多 1 个 active 项目负责人认领和 1 个 active 论文第一单位认领。

## 2. 当前代码基线

### 2.1 已经完善的部分

| 能力 | 当前依据 |
| --- | --- |
| 统一审批状态 | `interactions/models.py` 已有 `pending / approved / rejected / withdrawn` |
| 认领审核字段 | `ProjectClaimIntent` 已有 `review_comment / reviewed_by / reviewed_at` |
| 资助审核字段 | `SponsorIntent` 已有 `review_comment / reviewed_by / reviewed_at` |
| 认领席位唯一约束 | `ProjectClaimIntent` 有 `unique_active_review_claim_slot` 条件唯一约束 |
| 第一单位结构化字段 | `ProjectClaimIntent.claimed_unit_name` 已存在，提交接口强制校验 |
| 管理员审批接口 | `PATCH /api/admin/interactions/{type}/{id}/status/` 支持 claim/sponsor 审批 |
| 申请人可见审核意见 | `dashboard_payload()` 返回 claims/sponsors，payload 包含审核意见 |
| 管理员待审计数 | `pending_interaction_count()` 只统计 pending sponsor 和 review-required claim |
| 用户侧审批中按钮 | 前端已显示 `项目负责人审批中`、`第一单位认领审批中` |

### 2.2 仍需补齐的缺口

| 缺口 | 当前表现 | 产品风险 |
| --- | --- | --- |
| 管理端命名不准 | 管理 tab 仍叫 `任务审批` | 容易误解为任务结果也要审批 |
| 审批交互太轻 | 管理员通过/拒绝使用 `window.prompt` | 信息不足、不可扩展、可访问性弱 |
| 拒绝理由不强制 | 前后端均允许空 `review_note` | 申请人不知道怎么修正 |
| 申请人缺少集中入口 | 审核意见散落在个人空间任务摘要里 | 用户难以追踪全部申请 |
| 资助多选与审批粒度割裂 | 用户一次多选，管理员看到多条 sponsor row | 管理员难以理解这是同一次资助意向 |
| 错误恢复弱 | pending 认领填错第一单位时缺少明显指引 | 用户会重复点击课题卡或误以为卡住 |
| 验收证据不足 | 现有大量测试是源码正则 | 无法证明真实弹窗、表格、移动端和键盘路径可用 |

## 3. 产品设计原则

1. 审批对象必须明确：所有用户可见文案都要写清 `项目负责人认领`、`论文第一单位认领` 或具体资助类型。
2. 拒绝必须给可执行原因：拒绝不是终点，而是告诉用户如何补正。
3. 管理员审批必须基于上下文：审批弹窗必须展示课题、申请人、申请类型、申请内容、当前席位和历史状态。
4. 用户申请必须集中可追踪：个人空间要有“我的申请”视图，展示状态、审核意见和下一步。
5. 真实浏览器验收优先：最终验收必须包含截图、Playwright 自主操作、移动端视口和键盘路径。
6. 不用颜色单独表达状态：状态必须同时有文字标签，颜色只作辅助。

## 4. 推荐方案

### 4.1 管理端从“任务审批”改为“申请审批”

把管理员工作台中的 `任务审批` 重命名为 `申请审批`，并调整说明文案：

- 一级导航：`申请审批`
- 面板标题：`协作申请审批`
- 说明文案：`普通参与自动通过；项目负责人认领、论文第一单位认领和资助意向由管理员审批。`
- 统计卡：`待审申请`

保留任务结果查看在 `任务管理` 中，不把任务结果重新纳入审批主流程。

### 4.2 管理员审批弹窗

用正式审批弹窗替代 `window.prompt`。

弹窗标题按类型动态展示：

- `审核项目负责人认领`
- `审核论文第一单位认领`
- `审核资助意向`

弹窗内容：

| 区域 | 字段 |
| --- | --- |
| 申请摘要 | 课题编号、课题标题、当前阶段、主题 |
| 申请人 | UID、用户身份、提交时间 |
| 申请内容 | 申请类型、第一单位名称、资助类型、申请留言 |
| 当前状态 | 当前申请状态、是否待处理、同席位占用提示 |
| 审核意见 | 预设原因、自由文本、可见性提示 |

操作按钮：

- `通过申请`
- `拒绝申请`
- `取消`

交互规则：

1. 点击 `通过` 时，审核意见可选，默认填入 `审核通过`，管理员可修改。
2. 点击 `拒绝` 时，审核意见必填，不得只填空格。
3. 拒绝原因可先选预设，再自动填入文本框，管理员可编辑。
4. 提交中按钮进入 loading 状态，禁止重复提交。
5. 成功后关闭弹窗、刷新申请列表、刷新管理员总览待审数。
6. 失败时错误显示在弹窗内，同时 toast 简述失败原因。

拒绝原因预设：

| 类型 | 预设原因 |
| --- | --- |
| 项目负责人认领 | `负责人职责说明不足`、`当前课题已有负责人申请或负责人`、`用户积分或资料不满足要求`、`请补充团队协调和项目推进计划` |
| 论文第一单位认领 | `第一单位名称不完整`、`第一单位资格说明不足`、`当前课题已有第一单位申请或第一单位`、`请补充机构与课题贡献关系` |
| 资助意向 | `资源额度说明不足`、`联系方式或交付方式不清楚`、`当前课题阶段暂不接收该资助`、`请补充资助周期或可用资源规格` |

### 4.3 管理员申请列表信息结构

当前列表列头为 `申请 / 用户 UID / 类型 / 状态 / 操作`，信息偏少。建议改为：

| 列 | 内容 |
| --- | --- |
| 申请对象 | 课题编号、标题、阶段 |
| 申请人 | UID、身份 |
| 申请类型 | 项目负责人、论文第一单位、资助类型 |
| 申请内容 | 第一单位名称或资助说明摘要 |
| 状态 | 待处理、已通过、已拒绝、已撤回 |
| 更新时间 | 提交或最后更新时间 |
| 操作 | 审核、查看详情 |

默认筛选：

- 类型：全部可审批类型
- 状态：待处理
- 排序：后端按待处理优先、待处理内按 `created_at` 正序；已处理记录按 `updated_at` 倒序。不能只在前端分页后排序，避免跨页顺序失真。

### 4.3.1 审批弹窗上下文数据源

审批弹窗必须展示“当前席位和历史状态”，不能只依赖单条申请记录。

一期数据来源：

1. 打开 claim 审批弹窗时，前端调用现有 `/api/admin/interactions/?type=claim&project={topic_id}&page_size=100`，筛选同一 `project.id` 和同一 `subtype` 的记录，展示当前 pending 竞争申请数量、已通过记录 UID、最近已拒绝/已撤回记录和审核意见。
2. 打开 sponsor 审批弹窗时，前端调用现有 `/api/admin/interactions/?type=sponsor&project={topic_id}&user={uid}&page_size=100`，展示同一用户同一课题的资助类型集合。
3. 如果现有查询性能或字段不足，再在后端新增只读 `review_context` 字段；本期优先复用现有接口，不新增写接口。

验收要求：

- 审批弹窗中必须显示 `同席位当前待处理 X 条 / 已通过 Y 条` 或等价文字。
- 如果管理员打开弹窗后席位已被其他申请占用，提交通过失败时要展示后端 `claim_slot_occupied` 的中文原因，并刷新弹窗上下文。

### 4.4 资助意向聚合展示

用户在资助 popover 中可以一次选择 `资助劳务费`、`资助算力` 和更多类型。后端当前按 sponsor_type 保存多条 `SponsorIntent`，这个模型可以保留，但管理端展示需要聚合。

聚合规则：

- 管理端将同一 `project.id + user.uid` 下的 sponsor rows 聚合为一个“当前用户-课题资助集合”。这不是“一次提交批次”，因为当前数据模型没有 submission group id。
- 组标题展示：`T0002 · 用户 Uxxxx · 2 项资助意向`。
- 组内展示每个 sponsor_type 的状态、说明、审核意见。
- 允许展开后单独审批某一项资助类型。
- 组状态按子项聚合：有 pending 显示 `含待处理`，否则按 rejected、approved、withdrawn 的优先级显示 `已拒绝 / 已通过 / 已撤回` 摘要。
- 组排序按子项最高优先级排序：pending、rejected、approved、withdrawn；同优先级按最近 `updated_at` 倒序。

一期推荐实现：

- 前端聚合已有 `/api/admin/interactions/?type=sponsor` 返回，不新增数据库表。
- 后端保留单条 sponsor 审批接口。
- 弹窗打开单个 sponsor 子项时，仍使用现有 `type=sponsor&id` 审批。
- 一期不提供组级“全部通过/全部拒绝”按钮，避免前端循环调用单条接口造成部分成功、部分失败的模糊状态。若后续需要批量审批，必须新增明确的批量 API、部分失败返回结构和审计记录。

### 4.5 申请人“我的申请”中心

在个人空间新增或调整一个明确入口：`我的申请`。

推荐位置：

- 个人空间现有 `我的任务` 旁新增 tab：`我的申请`
- 如果不新增 tab，也必须在现有 `我的任务` 顶部增加“申请状态”分组，但推荐独立 tab，认知更清楚。

展示范围：

- 普通参与：显示为 `已通过`，但标注 `自动通过`
- 项目负责人认领：pending/approved/rejected/withdrawn 全部显示
- 论文第一单位认领：pending/approved/rejected/withdrawn 全部显示
- 资助意向：pending/approved/rejected/withdrawn 全部显示

卡片字段：

| 字段 | 内容 |
| --- | --- |
| 课题 | 编号、标题、阶段 |
| 申请类型 | 参与、项目负责人认领、论文第一单位认领、资助类型 |
| 状态 | 待审批、已通过、已拒绝、已撤回 |
| 申请内容 | 署名意向、第一单位名称、资助类型和备注 |
| 审核信息 | 审核意见、审核人 UID、审核时间 |
| 下一步 | 查看课题、重新提交、撤回已通过认领或撤回资助 |

标准行模型：

```js
{
  kind: "interest" | "claim" | "sponsor",
  id: "claim-123",
  project,
  typeLabel: "项目负责人认领",
  contentSummary: "申请担任项目负责人",
  status,
  statusRank,
  reviewComment,
  reviewedBy,
  reviewedAt,
  actions: ["view_project", "resubmit"]
}
```

普通参与显示 `自动通过`，不渲染空审核人和空审核时间。

状态引导：

| 状态 | 用户引导 |
| --- | --- |
| pending claim | `正在管理员审批。若第一单位或负责人信息填写错误，请等待管理员拒绝后重新提交，或联系管理员处理。` |
| approved claim | 展示 `撤回项目负责人认领` 或 `撤回论文第一单位认领` |
| rejected claim | 展示拒绝原因，并提供 `查看课题重新提交` |
| pending sponsor | 可撤回对应资助意向 |
| rejected sponsor | 展示拒绝原因，并允许重新提交对应资助类型 |

拒绝后重新提交：

1. 项目负责人认领需要从固定确认框升级为轻量申请弹窗，包含负责人职责确认说明和 `申请说明` textarea，用于填写组队、协调分工、进度管理、积分分配和学术诚信计划。重新提交时预填上一次 `message`，并在弹窗顶部展示上一次 `review_comment`。
2. 论文第一单位认领弹窗保留 `claimed_unit_name`，新增 `申请说明` textarea，用于说明机构与课题贡献关系。重新提交时预填上一次 `claimed_unit_name` 和 `message`，上一次拒绝原因必须展示在字段上方，不能只在 toast 中出现。
3. 资助意向重新提交时，popover 预选被拒绝的 sponsor_type，并展示上一次拒绝原因；用户修改说明后再次提交。
4. 旧拒绝记录保留在同一条 interaction 的 `review_comment` 中，重新提交后按当前后端逻辑清空审核字段并进入 pending；如需保留历史多次拒绝记录，另开审计/历史模型，不在本期新增。

关于待审认领撤回：

- 一期不在课题卡片和我的申请中心提供 `撤回待审认领申请`，保持当前 AGENTS 基线。
- 通过“拒绝理由必填 + 我的申请中心展示 + 重新提交路径”覆盖错误恢复。
- 如果后续产品决定允许用户撤销待审申请，必须新增独立文案 `撤回项目负责人申请`、`撤回论文第一单位申请`，不得使用 `撤回认领`。

### 4.6 申请结果通知与未读提示

一期不新增独立通知系统和数据库模型，先用轻量未读提示覆盖核心发现问题：

- 个人空间 `我的申请` tab 显示 pending 数，以及 `最近 7 天已处理` 数。
- 登录后 dashboard payload 中已有 claims/sponsors，可在前端用 `reviewed_at` 计算最近 7 天已处理申请。
- 后续如需要站内信，再新增 `Notification` 模型。

最低要求：

- 用户进入个人空间能一眼看到待审批数量。
- 被拒绝的申请在 `我的申请` 中不能被静默埋没，建议排在 pending 之后、approved 之前。

## 5. API 与数据设计

### 5.1 后端契约调整

必须调整：

1. `admin_interaction_update_status()` 对 `status=rejected` 强制 `review_note.strip()` 非空。
2. `Invalid interaction status.`、`Only pending interactions can be reviewed.` 等管理员可见错误改为中文。
3. `review_note_required` 返回 422 时，错误结构必须符合 AGENTS 双写要求：

```json
{
  "error": {
    "code": "review_note_required",
    "message": "拒绝申请时必须填写审核意见。",
    "details": {
      "review_note": ["拒绝申请时必须填写审核意见。"]
    }
  },
  "errors": {
    "review_note": ["拒绝申请时必须填写审核意见。"]
  }
}
```

4. `admin_interaction_list()` 不重复发明字段；当前 `interaction_payload()` 已包含下列字段，本期要用后端测试锁定契约：
   - claim：`detail.claimed_unit_name`
   - sponsor：`detail.sponsor_type_label`
   - 通用：`created_at / updated_at / review_comment / reviewed_by / reviewed_at`
5. 后端排序要支持申请审批列表的默认顺序：pending 优先，pending 内 `created_at` 正序，已处理 `updated_at` 倒序。

可选调整：

1. 如果前端聚合 sponsor 后仍有排序性能问题，再新增 `group=sponsor_user_project` 查询参数。
2. 如果未来要做未读通知，再新增通知模型；本期不做。

### 5.2 前端状态模型

新增状态建议：

```js
state.admin.reviewModal = {
  open: false,
  submitting: false,
  item: null,
  status: "approved",
  review_note: "",
  preset_reason: "",
  error: "",
  context: {
    loading: false,
    relatedClaims: [],
    sponsorGroup: []
  }
}
```

必须新增 `reviewModalRef`，复用现有 `openModalWithFocus()`、`trapModalFocus()` 和 `restoreLastModalTrigger()` 模式。弹窗 DOM 契约：

```html
<section
  ref="reviewModalRef"
  class="review-modal"
  data-testid="admin-review-modal"
  role="dialog"
  aria-modal="true"
  aria-labelledby="admin-review-modal-title"
  aria-describedby="admin-review-modal-description"
  tabindex="-1"
  @keydown="trapModalFocus($event, reviewModalRef)"
>
```

关键测试钩子：

- `data-testid="admin-review-modal"`
- `data-testid="review-note-input"`
- `data-testid="review-note-error"`
- `data-testid="admin-sponsor-group"`
- `data-testid="my-applications-list"`
- `data-testid="my-application-card"`

个人空间新增计算：

```js
myApplicationRows = [
  ...dashboard.interests,
  ...dashboard.claims,
  ...dashboard.sponsors
].sort(byStatusThenUpdatedAt)
```

排序建议：

1. pending
2. rejected
3. approved
4. withdrawn

同状态内按 `updated_at` 倒序。

前端 tab 迁移要求：

1. `WORKSPACE_TABS` 加入 `applications`。
2. 个人空间导航新增 `我的申请`。
3. 概览卡中与申请相关的卡片跳转到 `applications`，任务结果仍跳转到 `interactions` 或任务结果区域。
4. 翻转旧测试：当前断言“不出现我的申请”的源码测试必须改成断言存在 `我的申请`、`WORKSPACE_TABS` 包含 `applications`。

CSS 落点：

- `.review-modal-backdrop`
- `.review-modal`
- `.review-modal-grid`
- `.application-list`
- `.application-card`
- `.sponsor-intent-group`

移动端要求：

- 在 `max-width: 640px` 下，审批弹窗和我的申请卡片单列展示。
- 所有按钮 `min-height: 44px`。
- 长标题、UID、机构名和审核意见使用 `overflow-wrap: anywhere`，不能横向溢出。
- toast 不抢焦点；普通成功提示使用 `role="status" aria-live="polite"`，拒绝原因表单错误使用 `role="alert"` 或等价 aria-live，并把焦点移到审核意见输入框。

## 6. 执行方案

### Phase 0：基线确认

目标：确认当前测试和页面可运行，避免方案执行时混入既有坏状态。

执行：

```bash
git status --short
.venv/bin/python manage.py check
.venv/bin/python manage.py test api.tests.ApiTests api.tests.InteractionConcurrencyTests interactions
cd frontend && node --test src/*.test.js && npm run build
```

验收：

- 命令能完成，失败项记录在执行日志中。
- 不回退用户已有改动。

### Phase 1：后端审批契约收口

目标：让审批接口提供产品所需的稳定规则。

改动范围：

- `api/ninja_api.py`
- `api/tests.py`
- 必要时 `api/serializers.py`

执行要点：

1. 添加后端测试：拒绝 claim/sponsor 时 `review_note` 为空返回 422，错误码 `review_note_required`，并断言 `error.details.review_note` 和顶层 `errors.review_note` 双写。
2. 添加后端测试：拒绝 claim/sponsor 后，申请人在 `/api/me/dashboard/` 可看到审核意见；claim 和 sponsor 都要覆盖。
3. 添加后端测试：管理员重复审核非 pending 申请返回中文错误。
4. 添加后端测试：`admin_interaction_list()` 返回已锁定字段，包括 `detail.claimed_unit_name`、`detail.sponsor_type_label`、审核字段和时间字段。
5. 添加后端测试：同一用户同一课题提交 `labor_fee` 和 `compute` 两条 sponsor，管理员列表、dashboard 和撤回按 sponsor_type 独立工作。
6. 添加后端测试：申请审批列表默认排序满足 pending 优先，pending 内 `created_at` 正序。
7. 实现最小代码，保持 approved 审核意见可选。

验收：

- `api.tests.ApiTests` 与 `api.tests.InteractionConcurrencyTests` 中审批相关测试通过。
- 审批失败写 audit failed。
- API 不暴露英文业务错误给管理员用户。

### Phase 2：管理员申请审批 UI

目标：替换 `window.prompt`，提升审批判断质量。

改动范围：

- `frontend/src/main.js`
- `frontend/src/styles.css`
- `frontend/src/uiPlacement.test.js`
- `frontend/e2e/project-core.spec.js`

执行要点：

1. 管理端 tab 和统计卡文案从 `任务审批` 改为 `申请审批 / 待审申请`。
2. 增加审批弹窗状态、打开/关闭函数、预设原因、提交函数。
3. 列表增加申请内容摘要和更新时间。
4. 打开弹窗时加载 claim 席位上下文或 sponsor 用户-课题集合上下文。
5. sponsor 列表按同课题同用户聚合展示，但只提供子项审批按钮，不做组级批量审批。
6. 删除审批路径中的 `window.prompt`。
7. 增加空态、loading 态和提交失败可重试文案。

验收：

- 源码测试提取 `reviewInteraction()` 函数体，断言其中不存在 `window.prompt`。
- Playwright 审批流程中注册 `page.on("dialog", dialog => { throw new Error("审批流程不应打开原生 dialog"); })`。
- 管理员点击通过/拒绝打开正式弹窗。
- 拒绝不填原因时不能提交，错误显示在文本框附近。
- 弹窗具备 `data-testid="admin-review-modal"`、`role="dialog"`、`aria-modal="true"`、`aria-labelledby`、`aria-describedby` 和 `trapModalFocus`。
- Tab / Shift+Tab 后 `document.activeElement` 仍在弹窗内；Escape 关闭后焦点回到触发按钮。

### Phase 3：申请人“我的申请”中心

目标：让用户集中追踪申请状态和审核意见。

改动范围：

- `frontend/src/main.js`
- `frontend/src/styles.css`
- `frontend/src/uiPlacement.test.js`
- `frontend/e2e/project-core.spec.js`

执行要点：

1. 个人空间新增 `我的申请` tab。
2. 从 dashboard 的 interests/claims/sponsors 生成申请行。
3. 状态排序为 pending、rejected、approved、withdrawn。
4. 展示审核意见、审核人 UID、审核时间。
5. rejected claim/sponsor 提供 `查看课题重新提交`，并在重新提交弹窗预填旧内容、展示旧拒绝原因。
6. pending claim 展示“等待审核或联系管理员”的恢复说明，不提供待审撤回认领。
7. 更新 `WORKSPACE_TABS`、个人空间导航、概览卡跳转和旧测试断言。

验收：

- 普通用户提交项目负责人认领后，`我的申请` 出现 `项目负责人认领 · 待处理`。
- 管理员拒绝后，用户刷新个人空间能看到拒绝原因。
- 用户可从 rejected 申请跳回课题详情重新提交。
- 资助 pending 可撤回，撤回后 `我的申请` 更新为已撤回。

### Phase 4：真实浏览器验收与截图

目标：通过截图和自主操作证明流程可用。

执行要点：

1. 使用 Playwright 新增或扩展 `frontend/e2e/project-core.spec.js`。
2. 创建或复用测试用户：申请人、管理员、竞争申请人、资助者。
3. 覆盖桌面和现有 Playwright 移动项目 `mobile-360`、`mobile-390`、`mobile-320`；不新增 375px 口径。
4. e2e 测试中显式创建 `docs/qa/screenshots/approval-workflow-2026-06-19/`，并用 `page.screenshot({ path })` 保存关键截图，不能只依赖 Playwright `screenshot: "only-on-failure"`。

截图清单：

| 截图 | 场景 |
| --- | --- |
| `admin-approval-list.png` | 管理端申请审批列表，能看到待审申请 |
| `admin-review-modal-reject-required.png` | 拒绝原因为空时的弹窗错误 |
| `admin-review-modal-sponsor-group.png` | 同用户同课题资助意向聚合展示 |
| `applicant-my-applications-pending.png` | 用户我的申请中看到待审认领 |
| `applicant-my-applications-rejected.png` | 用户看到拒绝原因和重新提交入口 |
| `mobile-my-applications.png` | mobile-360/mobile-390/mobile-320 下我的申请列表不溢出 |

自主操作验收：

1. 用户提交项目负责人认领。
2. 用户提交论文第一单位认领并填写第一单位名称。
3. 用户同时提交劳务费和算力资助。
4. 管理员进入申请审批列表。
5. 管理员拒绝一个认领，拒绝原因为空时被拦截。
6. 管理员填写拒绝原因后提交成功，用户侧可见该原因。
7. 管理员通过一个资助子项。
8. 用户进入我的申请，看到 pending、approved、rejected 三类状态和审核意见。
9. 用户跳回课题页，按钮状态与申请状态一致。

### Phase 5：文档与版本同步

目标：让后续 agent 不再按旧“任务审批”或 prompt 审批路径工作。

改动范围：

- `AGENTS.md`
- `CHANGELOG.md`
- `VERSION`
- 本文档状态

验收：

- `AGENTS.md` 2.4/2.6/2.9 写明申请审批、拒绝理由必填、我的申请、真实浏览器验收。
- `CHANGELOG.md` 写明用户可见变化。
- `VERSION` 按用户可见功能调整为次版本或补丁版本，由发布负责人最终确认。

## 7. 验收标准

### 7.1 功能验收

1. 管理端不再出现 `任务审批` 作为认领/资助审批入口名称。
2. 管理端审批 claim/sponsor 不再使用浏览器 `window.prompt`。
3. 管理员拒绝 claim/sponsor 时必须填写审核意见。
4. 管理员通过 claim/sponsor 时审核意见可选，默认可为 `审核通过`。
5. 申请人可在 `我的申请` 中看到全部参与、认领、资助记录。
6. 申请人可看到审核意见、审核人 UID、审核时间。
7. 多个资助类型可在管理端按同一用户同一课题聚合展示。
8. 课题卡片和详情页按钮状态仍与 `claim_availability` 一致。

### 7.2 文案验收

1. 面向用户不得出现泛称 `撤回认领`。
2. 面向用户不得出现泛称 `撤回第一单位`。
3. 管理端审批入口统一称为 `申请审批`。
4. 任务结果相关入口仍称为 `任务管理` 或 `任务结果`，不得混入审批主流程。
5. API 业务错误面向管理员和用户时使用中文。

### 7.3 UI/UX 验收

1. 审批弹窗打开后焦点进入弹窗内。
2. Tab 和 Shift+Tab 不逃出当前弹窗。
3. 弹窗关闭后焦点返回原按钮。
4. 拒绝原因错误显示在文本框附近。
5. 所有按钮触达高度不小于 44px。
6. mobile-360/mobile-390/mobile-320 下，申请列表、审批弹窗、资助聚合内容不横向溢出。
7. 状态不能只靠颜色表达，必须有文字。

### 7.4 自动化验收

必须通过：

```bash
.venv/bin/python manage.py test api.tests.ApiTests api.tests.InteractionConcurrencyTests interactions
cd frontend && node --test src/*.test.js
cd frontend && npm run build
cd frontend && npm run test:e2e -- --grep "approval workflow|my applications|review modal"
```

建议通过：

```bash
.venv/bin/python manage.py test accounts api projects interactions credits
cd frontend && npm run test:e2e
```

### 7.5 截图与人工复核验收

完成实现后必须提交：

1. 桌面端管理端申请审批列表截图。
2. 桌面端审批弹窗截图。
3. 拒绝原因为空的错误态截图。
4. 用户我的申请 pending/rejected/approved 状态截图。
5. 移动端我的申请截图。
6. Playwright trace 或视频，证明自主操作流程完成。

## 8. 多 agent 审核计划

本文档写成后，使用三个并行 agent 审核：

| Agent | 审核视角 | 审核问题 |
| --- | --- | --- |
| 产品流程 agent | PM/用户旅程 | 是否覆盖申请人、管理员、被拒绝后修正、多资助类型和命名混淆 |
| 前端 UX agent | UI/可访问性/响应式 | 弹窗、列表、我的申请、移动端、键盘路径和截图验收是否足够 |
| 后端 QA agent | API/数据/测试 | 拒绝理由、审核字段、状态机、资助聚合、测试命令是否可执行 |

审核输出会写入“多 agent 审核结果”章节；若发现必须修订的问题，直接修订本文档。

## 9. 多 agent 审核结果

已完成三路只读审核，均未修改代码。

| Agent | 结论 | 已据此修订 |
| --- | --- | --- |
| 产品流程 agent | 初稿方向正确，但拒绝后重提字段、资助聚合边界、审批弹窗席位上下文不足 | 增加拒绝后重提字段和预填规则；明确 sponsor 聚合不是提交批次；补充审批上下文数据源 |
| 前端 UX agent | 初稿缺少前端状态枚举迁移、focus 契约、testid、截图产出和移动端口径 | 增加 `WORKSPACE_TABS` 迁移、弹窗 DOM 契约、测试钩子、显式截图、mobile-360/390/320 验收 |
| 后端 QA agent | 初稿测试命令错误，字段契约、错误结构和资助批量范围不清 | 改为 `api.tests.ApiTests api.tests.InteractionConcurrencyTests interactions`；明确字段双写错误结构；取消一期组级批量审批 |

## 10. 自检

- 未包含占位验收项。
- 未要求实现独立通知系统，避免超出本次审批流程补齐范围。
- 未改变“pending 认领不展示通过后撤回认领入口”的当前产品基线。
- 执行方案覆盖后端契约、管理员 UI、申请人 UI、真实浏览器验收和文档同步。
