# 课题任务空间调整设计文档

**Goal:** 在现有课题生命周期与现有 API 基础上，重构用户侧“我的任务”和管理员侧“任务审批 / 任务管理”，让申请、获批、提交任务结果、审核结果、结题归档形成清晰闭环。

**Architecture:** 本轮不新增生命周期专用 API，不新增发布、启动、暂停、归档等重复接口。用户侧用已有 `dashboard` 数据把申请关系和任务结果按课题聚合；管理员侧复用 `adminInteractions`、`adminProjects`、`adminContributions`、`adminUpdateProject`、`reviewAdminContribution` 等现有接口完成审批、查看、审核和结题归档。唯一可接受的数据模型字段补充是给任务结果增加 `result_type`，用来区分“阶段性成果”和“最终结果”；同时在现有提交任务结果接口补强获批关系校验，不新增接口。

**Tech Stack:** Django + Django Ninja API，Vue 3 CDN 单页前端，现有 `frontend/src/main.js`、`frontend/src/api.js`、`frontend/src/styles.css`。

**Document Type:** 本文档只固定产品设计、API 复用边界、数据约束和验收标准，不直接执行代码实现。

---

## 1. 当前系统事实

### 1.1 用户侧现状

当前 `frontend/src/main.js` 中用户空间有以下入口：

- `我的申请`：展示 `state.dashboard.interests`、`state.dashboard.claims`、`state.dashboard.sponsors`。
- `我的任务结果`：左侧是手动填写 `课题 ID / 任务 ID` 的提交表单，右侧展示 `state.dashboard.contributions`。

这个结构的问题是：用户必须知道数据库课题 ID，提交任务结果与自己的申请 / 获批关系没有绑定；从产品角度看，用户并不是先找“任务结果表单”，而是先进入“我和某个课题的关系”，然后在获批且课题进行中时提交结果。

因此，把“我的任务结果”改为“我的任务”，并与“我的申请”合并，是更合理的设计。这样能让用户看到每个课题的状态、自己与课题的关系、是否允许提交任务结果，避免误填课题 ID，也减少无上下文的空表单。

### 1.2 管理员侧现状

当前管理员入口包含：

- `协作管理`：同时包含“协作审核”和“组队看板”。
- `任务结果审核`：逐条展示用户提交的任务结果，并直接通过 / 拒绝。
- 历史任务 API 仍存在：`adminTasks`、`createAdminTask`、`assignAdminTask`、`updateAdminTaskStatus` 等，但本轮课题生命周期已明确移除“拆任务、分配 UID”的主流程。

本轮应将入口收敛为：

- `任务审批`：只处理用户申请 / 认领 / 资助意向的审批。
- `任务管理`：按课题逐行展示已进入协作链路的课题，进入弹窗后查看参与人员 UID 和已提交任务结果，并在弹窗内审核结果。

### 1.3 现有 API 能力

现有接口足够支撑本轮主流程：

- `GET /api/me/dashboard/`：返回用户收藏、参与意向、认领意向、资助意向、任务结果等。
- `POST /api/me/contributions/`：提交任务结果。当前要求课题为 `active`。
- `GET /api/admin/interactions/`：管理员查询用户申请 / 认领 / 资助意向，可按状态、课题、用户筛选。
- `PATCH /api/admin/interactions/{type}/{id}/status/`：管理员审核申请，当前审核通过开放招募课题时会自动进入 `team_building`。
- `GET /api/admin/projects/` 与 `GET /api/admin/projects/{id}/`：管理员查询课题列表和详情。
- `PATCH /api/admin/projects/{id}/`：管理员修改课题阶段，可复用为进入进行中、暂停、结题归档。
- `GET /api/admin/contributions/`：管理员查询任务结果，可按课题、状态、用户筛选。
- `PATCH /api/admin/contributions/{id}/review/`：管理员审核任务结果，当前只接受 `approved / rejected`，支持 `review_comment`。

本轮禁止新增以下冗余 API：

- `publishProject`
- `startProject`
- `pauseProject`
- `archiveProject`
- `taskManagement`
- `projectParticipants`
- `projectContributionReview`

如果前端需要这些能力，必须通过现有 `adminUpdateProject`、`adminInteractions`、`adminContributions` 等包装函数组合完成。

## 2. 产品边界

1. 课题状态仍只使用当前生命周期状态：`draft`、`open_recruiting`、`team_building`、`active`、`paused`、`archived`。
2. 收藏只属于用户与课题的关系，不改变课题状态。
3. 用户申请 / 认领 / 资助的状态为 `pending / approved / rejected / withdrawn`。
4. 用户只有在某个课题上存在已获批关系，且课题为 `active` 时，才可以提交任务结果。
5. 管理员审核任务结果只允许 `approved / rejected`，不恢复 `needs_revision` 主流程。
6. 不恢复“创建任务、拆任务、分配 UID、任务积分奖励”的产品主入口。
7. 所有涉及人员展示的地方只展示 UID，不展示用户名、邮箱或真实姓名。
8. 历史任务与积分接口可以保留为兼容能力，但前端主流程不展示、不默认调用。

## 3. 用户侧设计：我的任务

### 3.1 入口调整

用户空间标签调整为：

- `总览`
- `我的收藏`
- `我的任务`
- `个人资料`

移除独立可见的 `我的申请` 和 `我的任务结果` 标签。为了减少代码改动，可以保留内部 tab id `interactions`，但页面文案改为“我的任务”；也可以改为 `tasks`，但需要同步调整 `WORKSPACE_TABS`、`setWorkspaceTab`、默认回退逻辑和测试。推荐最小修改：保留内部 id，改可见文案和渲染内容。

### 3.2 数据组织

新增前端计算属性 `myProjectTasks`，只基于 `state.dashboard` 聚合，不新增 API。

聚合来源：

- `state.dashboard.interests`
- `state.dashboard.claims`
- `state.dashboard.sponsors`
- `state.dashboard.contributions`

聚合键：

- `project.id`

每个聚合项展示：

- 课题情况：课题标题、课题 ID、主题、摘要或关键字段摘要。
- 课题状态：`project.stage_label`。
- 我与课题的状态：
  - `申请中`：存在 `pending` 的参与 / 认领 / 资助记录。
  - `获批`：存在 `approved` 的参与 / 认领 / 资助记录。
  - `被拒绝`：只有 `rejected` 记录，且没有 `pending / approved` 记录。
  - `已撤回`：只有 `withdrawn` 记录，且没有 `pending / approved / rejected` 记录。
- 我的关系类型：参与、认领、资助，展示对应身份或类型。
- 我的任务结果：该课题下当前用户已经提交的结果，展示标题、状态、评语、提交时间。

状态优先级：

1. `approved`
2. `pending`
3. `rejected`
4. `withdrawn`

如果同一课题下同时存在多个关系，按优先级计算“我与课题的状态”，但关系明细仍全部展示。

### 3.3 提交任务结果

“提交任务结果”按钮只在以下条件同时满足时显示为可点击：

- 用户在该课题上至少有一个 `approved` 关系。
- 课题状态为 `active`。

该限制必须同时存在于前端和后端。当前 `POST /api/me/contributions/` 已校验课题公开且处于 `active`，但还需要补充“当前用户对该课题存在已获批的参与 / 认领 / 资助关系”的服务端校验，避免用户绕过页面直接调用 API 提交结果。该校验仍复用现有申请关系模型，不新增接口。

服务端通过条件：

- 当前用户存在 `ProjectInterest(status=approved)`；或
- 当前用户存在 `ProjectClaimIntent(status=approved)`；或
- 当前用户存在 `SponsorIntent(status=approved)`。

三类关系都必须同时限定 `user=当前用户`、`project=当前课题`、`status=approved`。

不满足时返回 `403` 或 `422`，错误码建议使用 `interaction_not_approved`。文案建议为：`Only approved participants can submit task results.`

按钮行为：

- 打开“提交任务结果”弹窗。
- 自动带入 `project.id`，用户不再手写数据库 ID。
- 表单字段只保留用户需要填写的内容：
  - 结果标题
  - 结果类型：阶段性成果 / 最终结果
  - 说明
  - 文件路径或链接
- `task_id` 仅作为历史兼容字段隐藏或不展示；如果将来从历史任务入口进入，可以内部携带。

禁用状态：

- `pending`：显示“申请审核中，获批后可提交”。
- `rejected`：显示“申请未通过，不能提交”。
- `team_building`：显示“组队中，进入进行中后可提交”。
- `paused`：显示“课题暂停中，暂不可提交”。
- `archived`：显示“课题已归档，不能提交”。

### 3.4 任务结果类型

为了支持“阶段性成果”和“最终结果”的结题差异，建议在现有 `Contribution` 资源上增加轻量字段：

- 字段名：`result_type`
- 可选值：
  - `stage`：阶段性成果，默认值。
  - `final`：最终结果。

这不是新增接口，只是现有任务结果资源的字段规范化。没有这个字段时，管理员无法可靠判断某条结果是阶段性成果还是最终结果，只能靠标题或备注猜测，不适合做结题操作。

## 4. 管理员侧设计：任务审批

### 4.1 入口调整

将管理员标签：

- `协作管理`

改为：

- `任务审批`

该面板只保留原“协作审核”内容，移除同屏“组队看板”。原因是“审核申请”和“查看已获批课题的任务状态”属于两个不同工作流，放在一个面板里会让管理员不知道下一步是在审核关系，还是管理任务结果。

### 4.2 页面内容

页面标题：

- `任务审批`

说明文案：

- `审核用户提交的参与、认领和资助申请。审核通过后，开放招募课题会自动进入组队中。`

筛选项复用现有字段：

- 类型：全部、参与意向、认领意向、资助意向。
- 状态：默认 `pending`，可查看全部、已通过、已拒绝、已撤回。
- 搜索：课题、用户 UID。

列表字段：

- 课题：标题、课题 ID。
- 用户 UID。
- 申请类型：参与 / 认领 / 资助及子类型。
- 状态。
- 操作：通过、拒绝。

操作接口：

- 通过 / 拒绝继续使用 `PATCH /api/admin/interactions/{type}/{id}/status/`。

审核通过后的阶段流转仍由后端保持：

- 当课题为 `open_recruiting` 且任一申请被批准时，课题自动进入 `team_building`。

## 5. 管理员侧设计：任务管理

### 5.1 入口调整

将管理员标签：

- `任务结果审核`

改为：

- `任务管理`

该面板不再直接逐条展示所有任务结果，而是按课题逐行展示。任务结果审核被放入课题详情弹窗中完成。

### 5.2 课题列表

数据来源：

- `GET /api/admin/projects/`

展示范围：

- 默认展示 `team_building / active / paused` 的课题。
- 可通过筛选查看 `open_recruiting / archived`，但 `draft` 不作为默认任务管理对象。

当前 `GET /api/admin/projects/` 支持单个 `stage` 查询，不支持一次传多个阶段。为了不新增 API，默认列表使用前端组合查询：

- 分别请求 `stage=team_building`、`stage=active`、`stage=paused`。
- 每个阶段按分页读取，直到返回数量少于 `page_size` 或没有下一页。
- 前端按 `project.id` 合并去重。
- 合并后按更新时间或课题编号排序。

如果管理员切换到单个阶段筛选，则直接调用现有单阶段查询。

每行字段：

- 课题名称。
- 课题 ID。
- 课题状态。
- 主题。
- 操作。

操作：

- `查看任务详情`

### 5.3 任务详情弹窗

点击 `查看任务详情` 后打开弹窗，弹窗内懒加载数据。

复用接口：

- 课题详情：`GET /api/admin/projects/{id}/`
- 已获批人员：`GET /api/admin/interactions/?status=approved&project={topic_id}&page_size=100`
- 已提交结果：`GET /api/admin/contributions/?project={topic_id}&page_size=100`

如果单次返回不足，需要按分页继续请求，直到没有下一页或结果数量不足 `page_size`。

注意：现有 `project` 查询参数是模糊匹配，可能命中相似课题 ID 或标题。弹窗拿到分页结果后，必须在前端再做一次精确过滤：

- 已获批人员：只保留 `item.project.id === 当前课题.id` 的记录。
- 已提交结果：只保留 `item.project.id === 当前课题.id` 的记录。

这样可以继续复用现有 API，同时避免相似 `topic_id` 的课题串数据。

弹窗展示：

- 课题基本信息：标题、课题 ID、主题、阶段、摘要。
- 已参与人员：只展示 UID，按参与、认领、资助分组。
- 阶段操作：
  - 进入进行中：复用 `PATCH /api/admin/projects/{id}/`，设置 `stage=active`。
  - 暂停：复用 `PATCH /api/admin/projects/{id}/`，设置 `stage=paused`。
  - 结题归档：复用 `PATCH /api/admin/projects/{id}/`，设置 `stage=archived` 且 `is_public=false`。
- 已提交结果：点击后在同一弹窗内展开，或打开二级弹窗。

### 5.4 任务结果审核

任务结果列表字段：

- 结果标题。
- 提交人 UID。
- 结果类型：阶段性成果 / 最终结果。
- 文件路径或链接。
- 说明。
- 状态。
- 管理员评语。
- 提交时间。
- 操作。

审核操作：

- 通过。
- 拒绝。
- 填写评语。

接口：

- `PATCH /api/admin/contributions/{id}/review/`

请求约束：

- `status` 只能为 `approved` 或 `rejected`。
- `review_comment` 使用管理员填写内容，不能继续前端硬编码为“审核通过”或“需要继续完善”。
- `grant_reward` 固定为 `false`，不展示任务积分奖励入口。

阶段性成果：

- 管理员点通过后，任务结果状态变为已通过，课题继续保持当前阶段。

最终结果：

- 管理员点通过后，先完成任务结果审核。
- 如果管理员勾选或点击 `通过并结题归档`，再调用 `PATCH /api/admin/projects/{id}/` 将课题更新为 `archived`，并设置 `is_public=false`。
- 该操作需要二次确认，确认文案明确“结题归档后公开课题库不可见，但保留数据库和审计记录”。

## 6. 新增课题发布警告弹窗修复

### 6.1 问题

当前新增 / 编辑课题弹窗中，点击 `发布课题` 后，如果课题存在警告信息，确认弹窗会出现在课题表单弹窗背后，管理员看不到。截图中表现为：主弹窗仍在前景，右侧背景被遮罩，但警告层不可见。

### 6.2 设计要求

不要继续使用 `window.confirm` 承载课题发布警告。改为系统内统一确认弹窗。

新增前端状态：

- `state.confirmDialog.open`
- `state.confirmDialog.title`
- `state.confirmDialog.message`
- `state.confirmDialog.confirmText`
- `state.confirmDialog.cancelText`
- `state.confirmDialog.tone`

新增前端函数：

- `openConfirmDialog(options)`：返回 Promise。
- `resolveConfirmDialog(result)`：确认或取消。

层级要求：

- `.project-form-modal` 当前为表单主弹窗层。
- 新确认弹窗必须渲染在 Vue 根节点末尾，不嵌套在 `.project-form-dialog-body` 内。
- 新确认弹窗 `z-index` 必须高于课题表单、课题预览、发布预览等所有现有弹窗。
- 推荐层级：
  - 普通弹窗：`110`
  - 表单弹窗：`120`
  - 发布预览 / 二级内容弹窗：`160`
  - 全局确认弹窗：`240`
  - toast：保持不遮挡确认弹窗的独立层级。

交互要求：

- 弹窗居中显示，不能被滚动容器裁切。
- 背景遮罩覆盖当前页面和底层表单。
- `Esc` 取消。
- 点击遮罩取消。
- Tab 焦点限制在确认弹窗内。
- 确认 / 取消按钮都有清晰焦点态。
- 移动端宽度下不溢出视口。

### 6.3 替换范围

本轮至少替换 `saveProject({ publish: true })` 中的发布警告确认。其他 `window.confirm` 可以作为后续统一改造项，除非它们也会发生弹窗背后不可见的问题。

## 7. API 规范化要求

### 7.1 不新增接口

本轮不得新增专用生命周期 API。以下动作全部复用现有接口：

- 进入进行中：`PATCH /api/admin/projects/{id}/`
- 暂停：`PATCH /api/admin/projects/{id}/`
- 结题归档：`PATCH /api/admin/projects/{id}/`
- 审核申请：`PATCH /api/admin/interactions/{type}/{id}/status/`
- 查询已获批人员：`GET /api/admin/interactions/`
- 查询任务结果：`GET /api/admin/contributions/`
- 审核任务结果：`PATCH /api/admin/contributions/{id}/review/`
- 用户提交任务结果：`POST /api/me/contributions/`

### 7.2 允许的字段补充

允许在现有 `Contribution` 模型与 API payload 上补充：

- `result_type`

原因：

- 用户明确需要区分阶段性成果和最终结果。
- 管理员需要根据结果类型决定“课题继续”还是“结题归档”。
- 该字段附属于现有任务结果资源，不构成新业务接口。

后端约束：

- 默认值为 `stage`。
- 仅允许 `stage / final`。
- `ContributionWriteRequest` 接收该字段。
- `contribution_payload` 返回该字段和中文标签。
- 迁移文件为新增字段迁移，不改动历史数据语义。

### 7.3 不恢复的内容

以下内容不进入本轮产品主流程：

- 创建任务。
- 分配 UID。
- 从历史 `ProjectTask` 派生“我的任务”主列表。
- 任务积分奖励。
- `needs_revision` 审核状态。
- JSON 导入。

## 8. 设计落地范围

本设计涉及四个产品面：

1. 用户空间：将申请关系和任务结果聚合为“我的任务”，让用户围绕课题查看状态并提交结果。
2. 管理员任务审批：只处理参与 / 认领 / 资助申请，不再混放组队看板。
3. 管理员任务管理：按课题管理已获批人员与任务结果，结果审核在课题详情弹窗中完成。
4. 发布确认体验：新增课题发布警告必须显示在所有弹窗之上，不能被表单遮挡。

本设计涉及两个数据约束：

1. 用户提交任务结果必须同时满足课题 `active` 和用户关系 `approved`。
2. 任务结果需要能区分 `stage` 和 `final`，否则无法可靠支持“阶段性成果继续推进、最终结果可结题归档”的产品规则。

本设计涉及一个接口边界：

1. 不新增生命周期专用 API，不新增冗余前端 wrapper。
2. 通过现有接口组合完成任务审批、任务管理、结果审核和结题归档。
3. 仅允许在现有任务结果资源上补充 `result_type` 字段。

## 9. 严格验收标准

### 9.1 用户侧验收

- [ ] 用户空间不再出现独立的 `我的任务结果` 标签。
- [ ] 用户空间不再出现独立的 `我的申请` 标签。
- [ ] 用户空间有 `我的任务` 标签。
- [ ] `我的任务` 中按课题聚合展示，不按申请流水散列展示。
- [ ] 每个课题都展示课题标题、课题 ID、课题阶段、我与课题的状态。
- [ ] `pending` 申请显示申请中，不能提交任务结果。
- [ ] `rejected` 申请显示被拒绝，不能提交任务结果。
- [ ] `approved` 且课题 `active` 时，可以打开提交任务结果弹窗。
- [ ] 提交任务结果弹窗不展示手写课题数据库 ID 输入框。
- [ ] 提交阶段性成果后，结果出现在该课题下，状态为已提交。
- [ ] 提交最终结果后，结果出现在该课题下，状态为已提交，结果类型显示为最终结果。

### 9.2 管理员任务审批验收

- [ ] 管理员导航不再出现 `协作管理` 文案。
- [ ] 管理员导航出现 `任务审批`。
- [ ] `任务审批` 面板只展示申请审批，不展示组队看板。
- [ ] 默认筛选为待处理申请。
- [ ] 申请列表只展示用户 UID，不展示用户名、邮箱、真实姓名。
- [ ] 审核通过开放招募课题后，该课题自动进入组队中。
- [ ] 审核拒绝不改变课题阶段。

### 9.3 管理员任务管理验收

- [ ] 管理员导航不再出现 `任务结果审核` 文案。
- [ ] 管理员导航出现 `任务管理`。
- [ ] `任务管理` 页面按课题逐行展示，而不是直接按任务结果逐行展示。
- [ ] 默认任务管理列表展示 `team_building / active / paused` 课题，且通过多阶段分页查询合并，不漏掉第二页以后的课题。
- [ ] 每行展示课题名称、课题 ID、课题状态、操作。
- [ ] 点击操作后弹窗展示课题详情。
- [ ] 弹窗中已参与人员只展示 UID。
- [ ] 弹窗中的已参与人员必须按 `project.id` 精确过滤，不混入相似课题 ID 或标题的记录。
- [ ] 弹窗中可以查看该课题已提交的任务结果。
- [ ] 弹窗中的任务结果必须按 `project.id` 精确过滤，不混入相似课题 ID 或标题的记录。
- [ ] 审核任务结果时可以填写评语。
- [ ] 审核请求只发送 `approved / rejected`，不发送 `needs_revision`。
- [ ] 不展示 `通过并奖励` 或任何任务积分奖励入口。
- [ ] 阶段性成果通过后，课题阶段不自动变化。
- [ ] 最终结果通过后，管理员可以二次确认并结题归档。
- [ ] 结题归档后，课题阶段为 `archived` 且公开课题库不可见。

### 9.4 API 验收

- [ ] `frontend/src/api.js` 不新增发布、启动、暂停、归档、任务管理专用 wrapper。
- [ ] 用户提交任务结果仍调用 `POST /api/me/contributions/`。
- [ ] 未获批用户直接调用 `POST /api/me/contributions/` 提交 `active` 课题结果时失败，返回 `interaction_not_approved` 或等价错误码。
- [ ] 已获批用户直接调用 `POST /api/me/contributions/` 提交 `active` 课题结果时成功。
- [ ] 管理员审批申请仍调用 `PATCH /api/admin/interactions/{type}/{id}/status/`。
- [ ] 管理员查询任务管理课题仍调用 `GET /api/admin/projects/`。
- [ ] 管理员查询已获批人员仍调用 `GET /api/admin/interactions/`。
- [ ] 管理员查询任务结果仍调用 `GET /api/admin/contributions/`。
- [ ] 管理员审核任务结果仍调用 `PATCH /api/admin/contributions/{id}/review/`。
- [ ] 管理员结题归档仍调用 `PATCH /api/admin/projects/{id}/`。
- [ ] `result_type` 非法值返回 `422 validation_error`。

### 9.5 发布警告弹窗验收

- [ ] 新增课题弹窗中点击 `发布课题`，若存在警告，确认弹窗显示在最上层。
- [ ] 确认弹窗不会被课题表单遮挡。
- [ ] 确认弹窗不会被弹窗内部滚动区域裁切。
- [ ] 桌面、小屏、移动端均可看到完整确认内容和按钮。
- [ ] `Esc` 可以取消。
- [ ] 点击遮罩可以取消。
- [ ] 确认后继续发布；取消后保留表单内容不提交。

### 9.6 必跑自动化验收

```bash
conda run -n openmedailab python manage.py test
node --test frontend/src/*.test.js
node --check frontend/src/main.js
conda run -n openmedailab python manage.py check
git diff --check
```

### 9.7 浏览器手动验收

- [ ] 以普通用户登录，进入 `我的任务`，确认申请和任务结果已合并展示。
- [ ] 普通用户在待审核申请上看不到可用的提交任务结果按钮。
- [ ] 普通用户未获批时，即使尝试绕过页面提交任务结果，也不能提交成功。
- [ ] 管理员审核该用户申请通过。
- [ ] 普通用户刷新后看到关系变为获批。
- [ ] 管理员将课题进入进行中。
- [ ] 普通用户在该课题上提交阶段性成果。
- [ ] 管理员在 `任务管理` 的课题弹窗中看到该结果，填写评语并通过。
- [ ] 普通用户看到该结果评语和已通过状态。
- [ ] 普通用户提交最终结果。
- [ ] 管理员通过最终结果并结题归档。
- [ ] 访客课题库不再展示该归档课题。
- [ ] 新增课题弹窗中发布带警告课题，确认弹窗出现在最上层。

## 10. 风险与处理

1. `result_type` 是本轮唯一建议增加的字段。如果拒绝增加该字段，系统无法可靠区分阶段性成果和最终结果，结题操作只能依赖标题或备注，验收标准会变得不可控。
2. 当前后端仍保留历史 `ProjectTask` 与积分接口。不要删除它们，避免破坏兼容；只从前端主流程中隐藏。
3. 管理员任务管理需要按课题拉取已获批人员和任务结果。为了避免一次性加载过多数据，应在打开详情弹窗时懒加载。
4. 发布警告确认必须作为全局弹窗实现。只调整 CSS 层级但继续使用原确认方式，容易在嵌套滚动和浏览器差异下复发。
5. 所有人员展示必须只使用 UID。任务管理弹窗、任务审批列表、任务结果列表都不能展示用户名、邮箱或真实姓名。

## 11. 独立审核要求

实现前后都需要独立 agent 审核。本轮文档审核重点：

- 是否严格复用现有 API。
- 是否引入了冗余接口或复杂代码。
- 是否满足用户侧“我的任务”合并设计。
- 是否满足管理员侧“任务审批 / 任务管理”分工。
- 是否修复新增课题发布警告弹窗被遮挡问题。
- 是否保留了课题生命周期边界。
- 是否有可执行、可验证的验收标准。
