# 课题管理与空间界面调整执行文档

## 1. 目标

本轮只针对现有课题生命周期和用户/管理员空间的界面细节做收敛与修复，保持 API 简洁，不新增复杂或冗余接口。

需要完成的产品调整：

- 课题管理列表中提供课题状态下拉，管理员可直接修改课题状态。
- 用户管理列表中，平台管理员固定显示第一行，其他用户按 UID 顺序排列。
- 修复任务管理详情弹窗、用户提交任务结果弹窗等被遮挡或层级不稳定的问题。
- 用户空间面板视觉与管理员空间面板保持一致，提升总览卡片、列表和交互反馈质量。
- 优化课题卡片 hover 小卡片，正确展示收藏用户、组队/参与用户、认领和资助等 UID 分组状态。

## 2. 当前代码与接口依据

### 2.1 课题状态

后端状态枚举已经固定在 `projects/models.py`：

- `draft`：草稿
- `open_recruiting`：开放招募
- `team_building`：组队中
- `active`：进行中
- `paused`：暂停
- `archived`：归档

已有接口能力：

- `GET /api/meta/` 返回 `project_stages`。
- `GET /api/admin/projects/` 已支持 `stage` 查询参数。
- `PATCH /api/admin/projects/{id}/` 已支持更新 `stage` 与 `is_public`。
- `DELETE /api/admin/projects/{id}/` 语义为软归档。

因此状态下拉不需要新增 API，直接复用 `api.adminUpdateProject(id, payload)`。

### 2.2 用户管理

当前 `GET /api/admin/users/` 在 `api/ninja_api.py` 中按 `id` 排序。前端 `frontend/src/main.js` 直接渲染 `state.admin.users`。

本轮排序要求可以在后端完成，以保证所有页面和后续 API 调用顺序一致：

- 平台管理员 UID `ADM00000001` 固定第一行。
- 其他用户按 `profile.uid` 升序。
- UID 为空的异常用户排在最后。
- 如果出现异常的重复 UID 或空 UID，同组内再按 `User.id` 升序兜底，避免分页顺序抖动。

不需要新增排序参数。

### 2.3 弹窗层级

当前相关弹窗：

- 课题新增/编辑、任务结果提交、任务管理详情共用 `.project-form-modal`。
- 更新日志使用 `.release-modal-backdrop`。
- 课题详情使用 `.project-modal-backdrop`。
- 确认框使用 `.confirm-modal-backdrop`。

当前层级分散，且 `.project-form-modal` 与更新日志等同级，容易在多个弹窗或第三方浮层存在时出现遮挡。需要统一一个明确的 z-index 层级表，并避免同一时间多个业务弹窗相互叠加。

### 2.4 用户空间

当前用户空间入口已经收敛为：

- 总览
- 我的收藏
- 我的任务
- 个人资料

但总览卡片和管理员总览卡片视觉不完全一致，卡片缺少点击反馈与跳转行为，信息密度和可操作性弱于管理员空间。

### 2.5 课题状态小卡片

当前 `GET /api/projects/{id}/status-card/` 已返回：

- `viewer_state`
- `participants`
- `status_uids`
- `uid_groups`
- `status`

其中 `uid_groups` 已包含：

- 收藏：`follow`
- 参与意向：`interest`
- 认领意向：`claim`
- 资助意向：`sponsor`

前端已有 `statusUidGroupsFor(project)`、`visibleGroupUids(group)`、`hiddenGroupUidCount(group)`，因此小卡片优化优先使用现有字段，不新增接口。

## 3. API 规范化要求

### 3.1 禁止新增的 API

不得新增以下类似接口：

- `publishProject`
- `startProject`
- `pauseProject`
- `archiveProject`
- `sortUsers`
- `projectStatusUsers`
- `teamUsers`
- `followUsers`

### 3.2 必须复用的 API

- 修改课题状态：`PATCH /api/admin/projects/{id}/`
- 软归档课题：`DELETE /api/admin/projects/{id}/` 或 `PATCH stage=archived,is_public=false`
- 用户列表：`GET /api/admin/users/`
- 课题状态卡：`GET /api/projects/{id}/status-card/`
- 用户空间：`GET /api/me/dashboard/`

### 3.3 允许的小范围后端调整

允许调整已有接口的内部排序和序列化稳定性：

- `GET /api/admin/users/` 默认排序改为管理员优先 + UID 升序。
- `status_uid_groups_for_project()` 分组顺序固定，UID 排序固定。

不允许改变现有响应结构的字段含义。

## 4. 任务设计

### 任务 1：课题管理列表增加状态下拉

#### 现状

管理员课题列表当前展示：

- 课题
- 主题
- 阶段
- 状态
- 操作

阶段只展示文本，不能直接修改。

#### 设计

在“阶段”列中将纯文本改为下拉选择：

- 下拉选项来自 `state.meta.project_stages`。
- 当前值为 `project.stage`。
- 修改后立即调用 `api.adminUpdateProject(project.id, payload)`。
- payload 只传必要字段，优先传 `{ stage }`，当选择 `archived` 时同步传 `{ stage: "archived", is_public: false }`。
- 当从 `draft` 改为公开阶段时，不自动公开，除非管理员明确选择“发布课题”或系统已有发布逻辑触发。列表状态下拉只改变阶段，不绕过发布质量校验。
- 当草稿改为 `open_recruiting/team_building/active/paused` 但 `is_public=false` 时，状态列必须明确显示“未公开”，避免管理员误以为课题已经出现在公开课题库。
- 当从公开阶段改为 `draft` 或 `archived` 时，应同步 `is_public: false`，避免草稿/归档仍出现在公开课题库。
- 成功后刷新当前课题列表和公开课题列表。

#### 交互反馈

- 下拉修改期间禁用该行下拉，避免重复提交。
- 成功 toast：`课题状态已更新`。
- 失败 toast：展示后端错误信息，并回滚到原状态。
- 对 `archived` 应弹确认框：`归档后公开课题库不可见，但会保留审计记录。`

#### 实现范围

- `frontend/src/main.js`
  - 增加 `state.admin.updatingProjectStageId` 或等价行级 loading。
  - 新增 `updateAdminProjectStage(project, stage)`。
  - 在课题管理表格阶段列渲染 `<select>`。
- `frontend/src/styles.css`
  - 增加紧凑型表格下拉样式。
- 不新增 `frontend/src/api.js` 方法。

#### 验收标准

- 课题管理列表每行阶段列为下拉。
- 下拉选项与 `GET /api/meta/` 的 `project_stages` 一致。
- 修改为 `open_recruiting/team_building/active/paused` 后，列表阶段立即更新。
- 草稿改为开放招募但仍未公开时，列表必须明确显示“未公开”，公开课题库不可见。
- 修改为 `archived` 前有确认框；确认后课题不再出现在公开课题库。
- 修改为 `draft` 后状态显示为草稿/未公开，不出现在公开课题库。
- 修改失败时 UI 回滚，不能停留在错误状态。
- `frontend/src/api.js` 不新增发布/暂停/归档包装函数。

### 任务 2：用户管理排序固定

#### 现状

管理员用户列表当前按 `id` 排序，可能出现普通用户在平台管理员之前。

#### 设计

后端默认排序改为：

1. 平台管理员固定第一行。
2. 其他用户按 UID 升序。
3. UID 为空的用户排最后。
4. 搜索场景仍保持同样排序规则。

#### 实现范围

- `api/ninja_api.py`
  - `admin_user_list()` 查询排序从 `order_by("id")` 调整为稳定的管理员优先 + UID 顺序。
  - 可用 `Case/When` 标注管理员优先级与 UID 空值优先级。
- `api/tests.py`
  - 增加用户管理排序测试。

#### 验收标准

- 无搜索时，`platform_admin / ADM00000001` 永远为第一行。
- 普通用户按 UID 升序，例如 `S00000001` 在 `S00000032` 前。
- UID 为空排最后；重复 UID 或异常 UID 同组内按 `id` 稳定排序。
- 搜索结果里如果包含管理员，管理员仍第一。
- 前端不需要本地排序补丁，避免分页排序不一致。

### 任务 3：统一弹窗层级，修复遮挡问题

#### 现状

任务管理详情弹窗、任务结果提交弹窗和课题表单共用 `.project-form-modal`，与其他弹窗层级接近。截图中任务管理详情和提交任务结果弹窗有被背景或其他浮层遮挡的体感问题。

#### 设计

定义统一层级：

| 层级 | 用途 | 建议 z-index |
| --- | --- | --- |
| 页面普通内容 | 主页面、卡片 | 0-50 |
| 顶部导航/粘性 tabs | topbar、admin tabs | 60-90 |
| toast | 非阻断反馈 | 120 |
| 课题详情 preview | `.project-modal-backdrop` | 200 |
| 表单和任务弹窗 | `.project-form-modal` | 300 |
| 确认框 | `.confirm-modal-backdrop` | 400 |

同时确保：

- 打开任务管理详情时关闭课题详情 preview。
- 打开用户提交任务结果时关闭课题详情 preview。
- 打开课题表单时关闭任务管理详情。
- 路由切换时关闭所有业务弹窗。
- 弹窗内部滚动，不让页面背景滚动抢焦点。
- 课题发布质量警告确认框必须显示在新增/编辑课题弹窗之上，不能被表单弹窗遮挡。

#### 实现范围

- `frontend/src/styles.css`
  - 提升 `.project-form-modal`、`.project-modal-backdrop`、`.confirm-modal-backdrop` 层级。
  - 增加 `.task-detail-modal`、`.task-result-modal` 明确层级别名。
  - 弹窗尺寸使用 `max-height: calc(100dvh - 32px)`，小屏使用 `100dvh` 安全高度。
- `frontend/src/main.js`
  - 复用已有 `closeRouteScopedOverlays()`。
  - 在 `openTaskProjectDetail()`、`openContributionModal()`、`newProject()`、`editProject()` 中先关闭互斥弹窗。

#### 验收标准

- 任务管理详情弹窗始终显示在背景遮罩上方，无遮挡。
- 用户提交任务结果弹窗始终显示在背景遮罩上方，无遮挡。
- 在已打开课题详情时点击提交任务结果，不出现两个业务弹窗互相叠加。
- 在已打开任务管理详情时切换页面，弹窗自动关闭。
- 新增/编辑课题中点击“发布课题”触发质量警告时，确认框显示在课题表单之上。
- 桌面、1366px、小屏 390px 下弹窗内容可滚动，底部按钮不被挡住。

### 任务 4：用户空间面板与管理员空间面板统一

#### 现状

用户空间总览卡片视觉和管理员总览卡片不一致，管理员卡片已有 hover 和点击进入子页面的体验，而用户空间总览卡片偏静态。

#### 设计

用户空间总览改为与管理员总览一致的“可点击统计卡片”：

- 收藏课题 → 点击进入 `我的收藏`
- 我的任务 → 点击进入 `我的任务`
- 任务结果 → 点击进入 `我的任务`，并滚动或高亮结果区
- 已通过协作 → 点击进入 `我的任务`

视觉上：

- 复用管理员总览卡片的尺寸、hover scale、阴影和内边距。
- 用户空间 tab 与管理员 tab 使用同一套圆角、间距、active 状态。
- 用户空间列表行与管理员列表行使用一致的边框、表头/移动端折叠风格。
- 不增加装饰性说明文本，避免页面变空或松散。

#### 实现范围

- `frontend/src/main.js`
  - 增加 `workspaceOverviewCards` computed。
- 卡片点击调用 `setWorkspaceTab(card.tab)`。
- 可以增加 `state.workspaceTaskFocus` 之类的轻量状态，用于任务结果卡点击后高亮结果区；非必须。
- `frontend/src/styles.css`
  - 抽象或复用 `.admin-overview-card` 样式，新增 `.workspace-overview-card`。
  - 保证移动端一列显示，无水平溢出。

#### 验收标准

- 用户空间总览卡片 hover 有轻微放大反馈。
- 点击收藏课题卡片进入我的收藏。
- 点击我的任务、任务结果、已通过协作进入我的任务。
- 用户空间总览卡片与管理员总览卡片必须共用同类 hover/click 行为，不能一边可点一边静态。
- 视觉密度、边框、圆角、hover 与管理员总览一致。
- 390px 宽度下不横向溢出。

### 任务 5：优化课题状态小卡片 UID 分组

#### 现状

状态卡已经能展示 `uid_groups`，但展示结构仍可能让“关注用户”和“组队/参与用户”信息不够清楚。小卡片需要更明确表达当前课题状态和不同用户关系。

#### 设计

小卡片结构固定为：

1. 第一行：只展示课题阶段，例如 `开放招募`、`组队中`、`进行中`。
2. 我的状态：展示当前用户相对该课题的状态，例如 `已收藏`、`参与：学生（待处理）`、`参与：学生（已通过）`。
3. 课题状态 UID 分组：
   - 收藏：展示所有收藏用户 UID。
   - 参与：按角色 + 审核状态展示，例如 `参与：学生（已通过）`。
   - 认领：按认领类型 + 审核状态展示。
   - 资助：按资助类型 + 审核状态展示。
4. 当前用户 UID 如果在某个分组内，使用加粗或描边高亮，但不单独新增“我的 UID”一行。
5. 超过固定高度时，小卡片内部滚动。

#### 分组顺序

建议后端固定顺序，避免刷新后跳动：

1. 收藏
2. 参与：已通过
3. 参与：待处理
4. 参与：已拒绝
5. 认领：已通过
6. 认领：待处理
7. 认领：已拒绝
8. 资助：已通过
9. 资助：待处理
10. 资助：已拒绝

同组 UID 按字符串升序。

#### 实现范围

- `api/ninja_api.py`
  - `status_uid_groups_for_project()` 固定分组顺序。
  - 不改变 `uid_groups` 响应结构，只保证顺序和 label 稳定。
- `frontend/src/main.js`
  - `statusUidGroupsFor(project)` 不再过滤掉已有关系。
  - 小卡片 label 去掉“相关 UID”等冗余字样。
  - 当前用户 UID 高亮继续复用 `statusHighlightUidFor(project)`。
- `frontend/src/styles.css`
  - 小卡片宽高固定但内部滚动。
  - 各关系类型使用不同但克制的颜色 token。
  - 小屏时小卡片放在卡片内容下方，不遮挡课题标题。

#### 验收标准

- 收藏用户 UID 出现在“收藏”分组。
- 已通过参与用户 UID 出现在对应“参与：角色（已通过）”分组。
- 待处理参与用户 UID 出现在对应“参与：角色（待处理）”分组。
- 当前登录用户 UID 在所在分组里高亮。
- 未登录用户不展示 UID，只提示登录后查看。
- 10 个以上 UID 时，小卡片内部滚动，卡片本身不撑破课题卡。
- 手机端小卡片不遮挡课题标题。
- 收藏、申请参与、管理员审核通过后，重新 hover 课题卡必须立即看到对应 UID 分组变化；如果接口返回失败，必须保留旧状态并提示错误。

## 5. 测试计划

### 5.1 后端测试

新增或更新 `api/tests.py`：

- 管理员用户列表排序：
  - 平台管理员第一。
  - 普通用户按 UID 升序。
  - 搜索结果仍保持管理员优先。
- 课题状态更新：
  - `PATCH /api/admin/projects/{id}/` 更新 `stage` 成功。
  - 更新为 `archived` 后 `is_public=false` 时公开课题库不可见。
- 状态小卡片：
  - `uid_groups` 包含收藏、参与、认领、资助。
  - 分组顺序稳定。
  - UID 升序。

### 5.2 前端测试

新增或更新 `frontend/src/uiPlacement.test.js`：

- 课题管理阶段列存在 `<select>`，并调用 `api.adminUpdateProject`，不新增 stage wrapper。
- 用户管理不做前端本地排序补丁，排序依赖后端。
- `.project-form-modal` 层级高于 `.project-modal-backdrop` 和 toast。
- `.confirm-modal-backdrop` 层级高于 `.project-form-modal`。
- 用户空间总览卡片可点击，并复用管理员卡片 hover affordance。
- 用户空间总览卡片点击后进入对应 tab，且静态测试应覆盖 `setWorkspaceTab(card.tab)` 或等价逻辑。
- 小卡片存在收藏/参与/认领/资助分组样式，移除冗余“相关 UID”文案。

### 5.3 浏览器手动验收

管理员：

1. 登录 `platform_admin`。
2. 进入 `#/admin` → `课题管理`。
3. 修改某课题阶段为 `暂停`，确认列表更新。
4. 修改某课题阶段为 `进行中`，确认任务管理可看到。
5. 修改某课题阶段为 `归档`，确认有确认框，确认后公开课题库不可见。
6. 进入 `用户管理`，确认管理员第一行，其他用户按 UID 排列。
7. 打开任务管理详情弹窗，确认无遮挡。

普通用户：

1. 登录普通用户。
2. 进入 `我的空间`，确认总览卡片风格与管理员空间一致。
3. 点击总览卡片进入对应 tab。
4. 进入课题库，hover 课题卡小卡片。
5. 收藏课题后，小卡片收藏分组出现当前 UID。
6. 申请参与后，小卡片参与待处理分组出现当前 UID。
7. 管理员批准后，小卡片参与已通过分组出现当前 UID。
8. 课题进入进行中后，用户提交任务结果弹窗无遮挡。

响应式：

- 390px、768px、1366px、1440px 宽度下分别检查：
  - 顶部导航不溢出。
  - 管理员课题表格可读。
  - 用户管理表格不横向溢出。
  - 小卡片不遮挡标题。
  - 任务结果弹窗底部按钮可见。

## 6. 必跑验收命令

```bash
conda run -n openmedailab python manage.py test
/Users/wang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test frontend/src/*.test.js
/Users/wang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check frontend/src/main.js
conda run -n openmedailab python manage.py check
conda run -n openmedailab python manage.py makemigrations --check --dry-run
git diff --check
```

## 7. 禁止事项

- 不新增课题状态专用 API。
- 不恢复 JSON 导入。
- 不恢复任务分配 UID、任务积分、通过并奖励等旧主流程。
- 不在用户空间展示用户名、邮箱等人员身份信息；涉及协作人员的地方只展示 UID。
- 不通过前端硬编码状态枚举，必须使用 `state.meta.project_stages`。
- 不用 `window.confirm` 新增关键确认流程，应复用已有统一确认弹窗。

## 8. 交付定义

本任务完成后，应满足：

- 管理员能在课题管理列表中直接调整课题状态。
- 管理员用户列表顺序稳定、符合平台管理员优先规则。
- 任务详情、任务结果、课题表单、确认框弹窗层级稳定。
- 用户空间与管理员空间的面板体验一致。
- 课题状态小卡片准确表达收藏、参与、认领、资助等 UID 分组。
- 所有实现均复用现有 API，无冗余接口。
