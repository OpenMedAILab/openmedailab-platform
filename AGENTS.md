# AGENTS.md - OpenMedAI Lab Agent 开工导航与系统基准文档

更新时间：2026-06-14

文件位置：项目根目录 `AGENTS.md`

代码基准：以当前仓库代码为准；若本文档与当前代码冲突，必须先核对代码，再同步修正文档。

当前产品版本文件：`VERSION = 0.7.4`

本文档用途：后续任何 agent 在执行任何任务前，必须先读本文档，再按“任务定位索引”打开必要代码文件。目标是避免每次从零通读完整仓库，同时保证生命周期、API、数据库、权限和前端入口不被改乱。

本文档不是一次性 PR 说明，也不是替代代码的绝对真相。若本文档与当前代码冲突，必须先核对代码，再同步修正文档。

## 1. Agent 使用方式

每次接到新任务时，按下面顺序执行：

1. 读本文档，确认任务属于哪个模块。
2. 在“任务定位索引”中找到对应文件和函数区域。
3. 只优先阅读相关文件，不要默认通读整个仓库。
4. 修改前确认是否会影响生命周期、API、数据库、权限、版本号或对外文案。
5. 修改后按本文档给出的测试矩阵验收。
6. 如果改动改变了系统规则、接口语义、数据模型、前端入口或验收方式，必须同步更新本文档。

快速判断：

| 如果任务提到 | 先读本文哪些部分 |
| --- | --- |
| 登录、注册、密码、管理员账户 | 2.1、3、4.1、5.1、7.1 |
| 课题库、课题详情、搜索筛选、状态卡 | 2.2、3.3、4.2、5.2、6.1 |
| 用户上传课题、编辑课题、每日限制 | 2.3、3.2、3.3、4.3、5.2 |
| 收藏、参与、认领、资助、撤回 | 2.4、3.4、4.4、5.3 |
| 我的空间、我的任务、任务结果 | 2.5、3.5、4.5、6.2 |
| 管理员工作台、任务审批、任务管理 | 2.6、3.5、4.6、6.3 |
| 主题、数据集说明 PDF、课题 PDF | 2.7、3.6、4.7、5.2 |
| 审计日志、异常、请求 ID | 2.8、3.7、4.8、5.5 |
| 弹窗遮挡、响应式、顶部导航、悬浮卡 | 2.9、6、7.3 |
| 版本号、更新日志弹窗 | 2.10、8 |

## 2. 任务定位索引

本节是最重要的开工地图。后续 agent 应先在这里定位，再去读代码。

### 2.1 用户、注册、登录、管理员、密码

| 目的 | 主要文件 | 重点位置 |
| --- | --- | --- |
| 用户资料模型、UID、管理员 UID | `accounts/models.py` | `PLATFORM_ADMIN_UID`、`ROLE_UID_PREFIXES`、`UserProfile`、`uid_for_user`、邮箱规范化 |
| 注册表单和邮箱唯一性 | `accounts/forms.py` | `RegisterForm`、`UserProfileForm` |
| 默认密码恢复 | `accounts/services.py` | `get_system_default_password`、`reset_user_to_default_password` |
| 唯一管理员维护 | `accounts/management/commands/ensure_platform_admin.py` | 固定 `platform_admin`、`ADM00000001`，禁止多个管理员 |
| 传统 Django 页面 | `accounts/views.py`、`accounts/urls.py` | 目前应跳转 SPA，不作为主产品入口扩展 |
| 登录/注册/强制改密 API | `api/ninja_api.py` | `register`、`login_view`、`logout_view`、`password_change_required`、`profile_get/profile_patch/profile_put`、`admin_user_reset_password` |
| 强制改密拦截 | `api/middleware.py` | `PasswordChangeRequiredMiddleware` |
| 用户序列化 | `api/serializers.py` | `user_payload`、`uid_only_user_payload`、`profile_payload`、`admin_user_detail_payload` |
| 前端 API 包装 | `frontend/src/api.js` | `login`、`register`、`changeRequiredPassword`、`profile`、`adminResetUserPassword` |
| 前端页面逻辑 | `frontend/src/main.js` | 登录、注册、强制改密、资料页、用户管理相关函数 |
| 样式 | `frontend/src/styles.css` | 登录卡片、表单、弹窗、用户管理表格 |
| 测试 | `accounts/tests.py`、`api/tests.py`、`frontend/src/api.test.js`、`frontend/src/profileMenu.test.js` | 注册失败路径、管理员唯一、强制改密、CSRF、个人菜单 |

产品规则：

- 管理员唯一：`platform_admin` / `ADM00000001`。
- 密码恢复不走邮箱；管理员恢复为系统统一默认密码。
- 用户用默认密码登录后必须先改密并重新登录。
- 不恢复邮箱验证、邮箱重置密码、自助找回密码。

### 2.2 公开课题库、课题详情、搜索筛选、状态卡

| 目的 | 主要文件 | 重点位置 |
| --- | --- | --- |
| 课题和阶段模型 | `projects/models.py` | `ProjectStage`、`Project`、`ProjectTag`、`ProjectDocument` |
| 公开课题 API | `api/ninja_api.py` | `project_list`、`project_detail`、`project_status_card`、`theme_datasets` |
| 搜索和可见性辅助 | `api/ninja_api.py` | `project_search_q`、`related_project_search_q`、`viewer_state`、`status_uid_groups_for_project` |
| 课题序列化 | `api/serializers.py` | `project_summary_payload`、`project_detail_payload`、`public_project_detail_payload`、`theme_dataset_payload` |
| 前端课题库加载 | `frontend/src/main.js` | `loadProjects`、`projectListRequestParams`、`loadProject`、`openProjectPreview`、`loadProjectThemeDatasets` |
| 前端状态卡 | `frontend/src/main.js`、`frontend/src/styles.css` | 状态卡渲染、悬浮定位、小屏防遮挡 |
| 测试 | `api/tests.py`、`frontend/src/uiPlacement.test.js` | 公开过滤、状态卡 UID 分组、响应式 |

产品规则：

- 访客和普通公开列表只能看到 `is_public = true` 且阶段为开放招募、组队中、进行中、暂停的课题。
- 已登录用户读取公开课题列表时，每个课题应带 `viewer_state`，用于从数据库恢复收藏、点赞、参与、认领、资助等按钮状态；已撤回关系不能继续算作当前激活状态。
- 公开课题列表默认按课题编号 `topic_id` 正序；“最新编号”按 `topic_id` 倒序；“最近更新”才按 `updated_at` 排序，避免编辑课题打乱编号顺序。
- 草稿和归档不进入公开课题库、公开详情、公开主题空间。
- 状态卡只展示阶段、我的关系、按收藏/参与/认领/资助分组的 UID。
- 涉及他人信息时只展示 UID，不展示用户名、邮箱、真实姓名。

### 2.3 用户上传课题、管理员课题管理、Markdown/JSON 导入

| 目的 | 主要文件 | 重点位置 |
| --- | --- | --- |
| 课题字段和上传者 | `projects/models.py` | `Project.created_by`、阶段、公开状态、文档关系 |
| Markdown/导入解析 | `projects/importing.py`、`projects/contracts.py` | 课题模板字段、导入契约 |
| 用户课题 API | `api/ninja_api.py` | `me_project_list`、`user_project_create`、`user_project_update`、`user_project_delete` |
| 管理员课题 API | `api/ninja_api.py` | `admin_project_list`、`admin_project_get`、`admin_project_create`、`admin_project_update`、`admin_project_delete`、`admin_project_bulk_archive`、`admin_project_import_json` |
| 课题写入校验 | `api/ninja_api.py` | `ProjectWriteRequest`、`validate_admin_project_payload`、`validate_user_project_payload`、`require_project_owner_or_admin`、`user_project_uploads_today`、`user_can_bypass_project_upload_quota` |
| 前端用户上传 | `frontend/src/main.js` | `loadMyProjects`、新增/编辑我的课题表单、保存草稿/发布 |
| 前端管理员课题管理 | `frontend/src/main.js` | `loadAdminProjects`、课题列表、状态下拉、新增/编辑课题弹窗、上传文档 |
| 前端 API 包装 | `frontend/src/api.js` | `meProjects`、`createProject`、`updateProject`、`deleteProject`、`adminProjects`、`adminCreateProject`、`adminUpdateProject`、`adminDeleteProject` |
| 测试 | `api/tests.py`、`projects/tests.py`、`frontend/src/projectJsonImport.test.js` | ownership、每日 10 个、草稿发布、导入校验 |

产品规则：

- 管理员和普通用户都可以上传课题。
- 普通用户只能修改或删除自己上传的课题。
- 普通用户每天最多上传 10 个课题；管理员不受限制。
- 用户上传课题默认草稿；用户只允许在草稿和开放招募之间切换。
- 管理员可以管理全站课题，可推进阶段、暂停、归档。
- JSON 导入接口当前仍存在于代码中；若任务要求移除或隐藏，必须先确认前端入口、测试和历史数据影响。
- 导入/批量操作必须展示成功数、失败数和失败原因。

### 2.4 收藏、点赞、参与、认领、资助、撤回

| 目的 | 主要文件 | 重点位置 |
| --- | --- | --- |
| 关系模型 | `interactions/models.py` | `ProjectFollow`、`ProjectScore`、`ProjectInterest`、`ProjectClaimIntent`、`ClaimType` |
| 关系服务 | `interactions/services.py` | 自动通过、状态变更、约束逻辑 |
| 关系 API | `api/ninja_api.py` | `follow_project`、`unfollow_project`、`score_project`、`unscore_project`、`interest_project`、`claim_project`、`sponsor_project`、`me_interaction_withdraw`、`admin_interaction_list`、`admin_interaction_update_status` |
| 状态辅助 | `api/ninja_api.py` | `maybe_advance_project_stage_after_interaction`、`user_has_approved_project_relation`、`viewer_state` |
| 关系序列化 | `api/serializers.py` | `interest_payload`、`claim_payload`、`sponsor_payload`、`follow_payload`、`dashboard_payload` |
| 前端操作 | `frontend/src/main.js` | `submitLike`、`submitInterest`、`submitParticipationRequest`、`submitClaim`、`submitLeadClaim`、`submitSponsor`、`withdrawInteraction` |
| 测试 | `api/tests.py`、`interactions/tests.py` | 自动通过、资助审批、撤回、阶段限制、UID 展示 |

产品规则：

- 收藏是用户关系，不是课题阶段，不推进课题生命周期。
- 点赞是轻量反馈，不推进课题生命周期。
- 参与和认领提交后自动 `approved`，不进入管理员审批。
- 资助意向提交后为 `pending`，只由管理员审批为 `approved` 或 `rejected`。
- 用户可撤回自己的关系，撤回状态为 `withdrawn`。
- 参与/认领/资助只允许在开放招募和组队中提交。
- 任一参与或认领通过后，课题可进入组队中；当前自动推进逻辑集中在后端辅助函数中，改动前必须确认产品需求。

### 2.5 我的空间、我的任务、任务结果

| 目的 | 主要文件 | 重点位置 |
| --- | --- | --- |
| 任务结果模型 | `credits/models.py` | `Contribution`、`ContributionStatus`、`CreditLedger` |
| 用户任务结果 API | `api/ninja_api.py` | `me_task_list`、`me_contribution_list`、`me_contribution_create` |
| 提交资格校验 | `api/ninja_api.py` | `user_has_approved_project_relation`、课题阶段校验 |
| 序列化 | `api/serializers.py` | `contribution_payload`、`dashboard_payload` |
| 前端我的空间 | `frontend/src/main.js` | `loadDashboard`、`loadFavorites`、`loadMyProjects`、`openContributionModal`、`submitContribution` |
| 样式 | `frontend/src/styles.css` | 我的空间面板、任务弹窗、响应式 |
| 测试 | `api/tests.py`、`frontend/src/uiPlacement.test.js` | 提交资格、弹窗不遮挡、小屏适配 |

产品规则：

- “我的任务”不是旧 `ProjectTask` 分配任务，而是用户与课题之间的已收藏、已申请、已认领、已资助、已提交结果状态汇总。
- 用户只有在课题为进行中，且自己有已通过参与或认领关系时，才能提交任务结果。
- 单纯资助关系不赋予任务结果提交资格。
- 任务结果审核状态只使用 `pending/approved/rejected` 作为当前主流程。
- 积分和旧任务奖励接口保留兼容，但不作为主流程默认动作。

### 2.6 管理员工作台、任务审批、任务管理、用户管理

| 目的 | 主要文件 | 重点位置 |
| --- | --- | --- |
| 管理员总览 | `api/ninja_api.py` | `admin_overview` |
| 用户管理 | `api/ninja_api.py`、`api/serializers.py` | `admin_user_list`、`admin_user_detail`、`admin_user_reset_password`、`admin_user_detail_payload` |
| 资助审批 | `api/ninja_api.py` | `admin_interaction_list`、`admin_interaction_update_status` |
| 任务管理 | `api/ninja_api.py` | `admin_contribution_list`、`admin_contribution_get`、`admin_contribution_review`、项目详情辅助 |
| 历史任务接口 | `api/ninja_api.py` | `admin_task_list`、`admin_task_create`、`admin_task_update`、`admin_task_delete`、`admin_task_assign`、`admin_task_status` |
| 前端管理员页 | `frontend/src/main.js` | `loadAdmin`、`loadActiveAdminTab`、`loadAdminUsers`、`loadAdminInteractions`、`loadAdminTaskProjects`、`openTaskProjectDetail`、`fetchProjectApprovedInteractions`、`fetchProjectContributions`、`loadAdminContributions`、`loadAdminAuditLogs` |
| 前端 API 包装 | `frontend/src/api.js` | `adminUsers`、`adminResetUserPassword`、`adminInteractions`、`reviewAdminInteraction`、`adminContributions`、`reviewAdminContribution`、`adminAuditLogs` |
| 测试 | `api/tests.py`、`frontend/src/*.test.js` | 资助审批、UID 展示、管理员排序、任务结果审核 |

产品规则：

- 管理员不审核参与和认领，只审批资助意向。
- 管理员“任务管理”按课题查看已参与/已认领 UID、资助 UID 和任务结果。
- 管理员可把课题推进到进行中、暂停、归档。
- 管理员用户管理中，平台管理员固定第一行，其他用户按 UID 稳定排序。
- 历史 `ProjectTask` 接口仍存在，但不要把“拆任务、分配 UID、任务奖励”恢复成主流程。

### 2.7 主题、数据集说明 PDF、课题 PDF

| 目的 | 主要文件 | 重点位置 |
| --- | --- | --- |
| 数据模型 | `projects/models.py` | `Theme`、`ThemeFile`、`ProjectDocument` |
| 公开主题数据集说明 | `api/ninja_api.py` | `theme_datasets` |
| 管理员主题 API | `api/ninja_api.py` | `admin_theme_list/create/update/delete` |
| 主题数据集说明 API | `api/ninja_api.py` | `admin_theme_file_list/create/update/delete`、`admin_theme_file_detail_pdf_upload` |
| 课题 PDF API | `api/ninja_api.py` | `admin_project_document_list`、`admin_project_document_upload/update/delete` |
| 数据集说明 PDF API | `api/ninja_api.py` | `admin_theme_file_detail_pdf_upload` |
| 路径安全 | `api/ninja_api.py` | `safe_child_path`、`project_document_root`、`theme_file_detail_pdf_root`、`sanitize_file_name` |
| 前端页面 | `frontend/src/main.js` | `loadProjectThemeDatasets`、`loadThemeFiles`、`saveThemeFile`、`uploadThemeFileDetailPdf`、`uploadProjectDocuments` |
| 测试 | `api/tests.py`、`projects/tests.py` | PDF 上传、公开过滤、主题数据集说明展示 |

产品规则：

- `Theme` 是主题分类；首页主题、筛选主题和管理端主题列表都来自数据库中的 `Theme`。
- 不再提供目录浏览、目录上传或服务器数据集存储；管理端不维护目录式文件管理模块。
- `ThemeFile` 表示一个主题下的数据集说明记录，只保存数据集名称、说明和一份说明 PDF，不保存原始数据集。
- 主题的数据集说明 PDF 使用 `ThemeFile.detail_pdf_path` 绑定，创建记录时后端自动生成内部 `path`。
- 单个课题只维护一份主 PDF 详情：`ProjectDocument(document_kind="detail", doc_type="pdf")`。重新上传时替换旧主 PDF。
- 首页课题卡和课题弹窗可预览课题主 PDF；课题详情不再展示 Markdown 原始文档模块。
- 公开 `/api/themes/{slug}/datasets/` 只返回启用主题、启用的数据集说明记录，以及公开且未归档的关联课题。

### 2.8 审计日志、异常、请求 ID、错误反馈

| 目的 | 主要文件 | 重点位置 |
| --- | --- | --- |
| 请求 ID 和强制改密中间件 | `api/middleware.py` | `RequestIDMiddleware`、`PasswordChangeRequiredMiddleware` |
| 异常响应 | `api/ninja_api.py` | `not_found_handler`、`http_error_handler`、`validation_error_handler`、`fail`、`error_payload` |
| 审计写入 | `api/ninja_api.py` | `audit` 以及所有数据库写路径 |
| 审计模型 | `projects/models.py` | `AuditLog` |
| 审计展示 | `api/serializers.py` | `audit_log_payload`、`audit_action_label`、`audit_log_summary` |
| 前端错误提示 | `frontend/src/api.js`、`frontend/src/main.js` | `ApiError`、`request`、`showToast`、各表单 catch |
| 测试 | `api/tests.py`、`frontend/src/api.test.js` | 错误结构、CSRF 重试、审计日志 |

产品规则：

- 所有数据库写操作必须可追溯。
- 成功和失败都应能关联到操作者、对象、时间、请求来源和 request_id。
- 不能吞异常或静默失败。
- API 错误结构要稳定，至少有 `code` 和 `message`，字段错误放在 `errors`。
- 前端要展示用户能理解的错误，不只显示“失败”。
- 不记录密码、密钥、完整敏感文件内容。

### 2.9 前端 UI、弹窗、响应式、悬浮卡

| 目的 | 主要文件 | 重点位置 |
| --- | --- | --- |
| 单页应用主逻辑 | `frontend/src/main.js` | 路由、状态、页面渲染、事件处理、弹窗状态 |
| 样式 | `frontend/src/styles.css` | 顶部导航、卡片、表格、弹窗、状态卡、小屏媒体查询 |
| API 包装 | `frontend/src/api.js` | 不要绕过统一 `request` |
| UI 测试 | `frontend/src/uiPlacement.test.js`、`frontend/src/profileMenu.test.js`、`frontend/src/release.test.js` | 弹窗层级、个人菜单、版本弹窗 |

产品规则：

- 弹窗中的确认按钮不能被下一层业务弹窗遮挡。
- 确认弹窗、警告弹窗层级应高于新增/编辑/任务结果弹窗。
- 顶部导航要在窄屏下优雅收缩或横向滚动，不能裁切关键按钮。
- 状态悬浮卡固定最大尺寸，内容超出内部滚动；小屏不要遮挡课题标题。
- 所有按钮点击后必须有明确反馈：toast、按钮状态变化、表格刷新、弹窗关闭或错误提示。

### 2.10 版本号、更新日志、发布信息

| 目的 | 主要文件 | 重点位置 |
| --- | --- | --- |
| 当前版本 | `VERSION` | 单行语义化版本号 |
| 更新日志 | `CHANGELOG.md` | 对外展示版本内容 |
| 后端版本读取 | `config/release.py`、`api/ninja_api.py` | `/api/meta/` 的 release 信息 |
| 前端展示 | `frontend/src/main.js`、`frontend/src/styles.css` | 版本按钮、更新日志弹窗 |
| 测试 | `frontend/src/release.test.js`、`api/tests.py` | 版本展示、变更日志解析 |

版本规则：

- 修复 UI 或小 bug：补丁版本。
- 新增或调整用户可感知功能：次版本。
- 改变核心生命周期、数据库兼容性或 API 语义：大版本或明确产品节点。
- 每次对外可见变化都要同步 `VERSION`、`CHANGELOG.md`、`/api/meta/` 和前端版本弹窗。

## 3. 当前系统生命周期基准

### 3.1 角色

| 角色 | 可做什么 | 不可做什么 |
| --- | --- | --- |
| 访客 | 浏览公开课题、公开详情、主题数据集说明 PDF、登录注册 | 收藏、点赞、参与、认领、资助、提交结果、进入管理页 |
| 普通用户 | 上传课题、管理自己上传的课题、收藏、点赞、参与、认领、资助、撤回、提交任务结果、维护资料 | 管理他人课题、超过每日上传上限、审批资助、审核任务结果、查看敏感个人信息 |
| 平台管理员 | 管理全站用户、主题、数据集说明 PDF、课题、资助审批、任务结果审核、审计日志、密码恢复 | 通过前端创建第二个管理员、审批参与/认领、恢复邮箱找回密码主流程 |

### 3.2 普通用户生命周期

```mermaid
stateDiagram-v2
  [*] --> Registered: 注册成功
  Registered --> MustChangePassword: 管理员恢复默认密码
  MustChangePassword --> Registered: 修改密码并重新登录
  Registered --> Browsing: 浏览课题库
  Registered --> OwnDraft: 上传课题为草稿
  OwnDraft --> OwnOpen: 用户发布到开放招募
  Browsing --> Following: 收藏课题
  Browsing --> AutoApproved: 参与/认领自动通过
  Browsing --> SponsorPending: 提交资助意向
  SponsorPending --> SponsorApproved: 管理员通过资助
  SponsorPending --> SponsorRejected: 管理员拒绝资助
  AutoApproved --> Withdrawn: 用户撤回
  SponsorPending --> Withdrawn: 用户撤回
  AutoApproved --> SubmitResult: 课题进行中后提交任务结果
  SubmitResult --> ResultReviewed: 管理员审核
```

关键规则：

- 注册后生成唯一 UID，UID 前缀由身份决定。
- 邮箱唯一性由业务表单和 `UserProfile.email_normalized` 约束维护。
- 普通用户每天最多上传 10 个课题。
- 用户只能编辑/删除自己上传的课题。
- 用户参与和认领自动通过。
- 用户资助意向需要管理员审批。
- 用户提交任务结果需要课题进行中，且自己已有参与或认领 approved 关系。

### 3.3 课题生命周期

课题阶段只允许这 6 个：

| 阶段 | 代码值 | 公开可见 | 主要含义 |
| --- | --- | --- | --- |
| 草稿 | `draft` | 否 | 未发布，只允许创建者和管理员管理 |
| 开放招募 | `open_recruiting` | 是 | 可以收藏、参与、认领、资助 |
| 组队中 | `team_building` | 是 | 已有人参与或认领，仍可继续招募 |
| 进行中 | `active` | 是 | 已进入执行期，可提交任务结果 |
| 暂停 | `paused` | 是 | 暂停推进，是否允许操作由后端校验决定 |
| 归档 | `archived` | 否 | 结束或隐藏，不再公开展示 |

阶段流转基准：

```mermaid
flowchart LR
  D["draft"] --> O["open_recruiting"]
  O --> T["team_building"]
  T --> A["active"]
  A --> P["paused"]
  P --> A
  A --> R["archived"]
  T --> R
  O --> R
  D --> R
```

阶段裁决：

- 收藏、点赞不改变课题阶段。
- 用户参与或认领自动 approved；是否自动推进到组队中由后端统一逻辑控制，不能前端私自改阶段。
- 进入进行中由管理员显式操作。
- 归档是软归档，不物理删除业务历史。
- 草稿和归档不能出现在公开课题库、公开详情和公开主题空间。

### 3.4 用户与课题关系生命周期

| 关系 | 发起者 | 初始状态 | 管理员是否审批 | 是否推进课题 | 展示方式 |
| --- | --- | --- | --- | --- | --- |
| 收藏 | 用户 | 已收藏 | 否 | 否 | 状态卡收藏 UID 分组 |
| 点赞 | 用户 | 已点赞 | 否 | 否 | 轻量反馈，不进入协作主流程 |
| 参与 | 用户 | `approved` | 否 | 可触发组队中 | 状态卡参与 UID 分组 |
| 认领 | 用户 | `approved` | 否 | 可触发组队中 | 状态卡认领 UID 分组 |
| 资助 | 用户 | `pending` | 是 | 不自动进入进行中 | 管理员资助审批、状态卡资助 UID 分组 |
| 撤回 | 用户 | `withdrawn` | 否 | 不自动回退阶段 | 我的空间和状态卡反映 |

### 3.5 任务结果生命周期

```mermaid
stateDiagram-v2
  [*] --> Pending: 用户提交任务结果
  Pending --> Approved: 管理员通过
  Pending --> Rejected: 管理员拒绝
```

任务结果规则：

- 当前主流程称为“任务结果”，不是旧的任务拆分。
- 用户提交结果不需要填写旧 `task_id`。
- 管理员审核任务结果时不默认触发积分奖励。
- 若将来重新启用积分或细任务，必须先更新本文档和验收标准。

### 3.6 主题、数据集说明 PDF、课题 PDF

- `Theme` 是课题所属主题。
- `ThemeFile` 是主题级数据集说明记录，面向数据集说明 PDF，不存原始数据集目录。
- `ProjectDocument` 当前主流程只使用 `document_kind="detail"`、`doc_type="pdf"`，表示单个课题主 PDF。
- 课题详情可展示课题主 PDF 和所属主题的数据集说明 PDF，二者不要混淆。

### 3.7 审计、异常、日志

系统所有改变数据库或业务状态的操作都应可追溯：

- 登录、退出、注册、强制改密、密码恢复。
- 用户资料、课题、主题、数据集说明 PDF、课题 PDF。
- 收藏、点赞、参与、认领、资助、撤回。
- 任务结果提交和审核。
- 批量导入、归档、删除、后台管理操作。

错误规则：

- API 必须返回稳定错误结构。
- 前端必须展示明确错误。
- 数据库写操作必须事务化，失败时回滚。
- 失败日志也要可定位到 request_id。

## 4. API 基准

所有前端请求必须优先经过 `frontend/src/api.js` 的统一 `request` 或 `requestForm`，不要在页面逻辑里直接 `fetch`。

### 4.1 Auth / Me

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/csrf/` | 获取 CSRF |
| `GET` | `/api/me/` | 当前登录用户 |
| `POST` | `/api/auth/register/` | 注册 |
| `POST` | `/api/auth/login/` | 登录 |
| `POST` | `/api/auth/logout/` | 退出 |
| `POST` | `/api/auth/password/change-required/` | 默认密码登录后的强制改密 |
| `GET/PATCH/PUT` | `/api/me/profile/` | 用户资料 |
| `GET` | `/api/me/dashboard/` | 我的空间汇总 |
| `GET` | `/api/me/projects/` | 我的上传课题 |

### 4.2 Public Projects

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/meta/` | 元数据、阶段、版本 |
| `GET` | `/api/project-schema/` | 课题字段契约 |
| `GET` | `/api/projects/` | 公开课题列表；登录态返回每个课题的 `viewer_state` |
| `GET` | `/api/projects/{id}/` | 公开课题详情 |
| `GET` | `/api/projects/{id}/status-card/` | 课题状态卡 |
| `GET` | `/api/themes/{slug}/datasets/` | 公开主题数据集说明 PDF |

### 4.3 User Project Write APIs

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/projects/` | 普通用户创建课题 |
| `PATCH` | `/api/projects/{id}/` | 普通用户编辑自己的课题 |
| `DELETE` | `/api/projects/{id}/` | 普通用户删除/归档自己的课题 |

不要新增 `publishProject`、`pauseProject`、`archiveProject` 等同义 API；阶段变化通过已有 `PATCH` 表达。

### 4.4 Interaction APIs

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/projects/{id}/follow/` | 收藏 |
| `POST` | `/api/projects/{id}/unfollow/` | 取消收藏 |
| `POST` | `/api/projects/{id}/score/` | 点赞 |
| `POST` | `/api/projects/{id}/unscore/` | 取消点赞 |
| `POST` | `/api/projects/{id}/interest/` | 参与，自动通过 |
| `POST` | `/api/projects/{id}/claim/` | 认领，自动通过 |
| `POST` | `/api/projects/{id}/sponsor/` | 资助意向，待审批 |
| `PATCH` | `/api/me/interactions/{type}/{id}/withdraw/` | 撤回 |

### 4.5 Contribution APIs

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/me/contributions/` | 我的任务结果 |
| `POST` | `/api/me/contributions/` | 提交任务结果 |
| `GET` | `/api/admin/contributions/` | 管理员查看任务结果 |
| `GET` | `/api/admin/contributions/{id}/` | 管理员查看结果详情 |
| `PATCH` | `/api/admin/contributions/{id}/review/` | 管理员审核任务结果 |

### 4.6 Admin APIs

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/admin/overview/` | 管理员总览 |
| `GET` | `/api/admin/users/` | 用户管理 |
| `POST` | `/api/admin/users/{uid}/reset-password/` | 恢复默认密码 |
| `GET/PATCH` | `/api/admin/interactions/`、`/api/admin/interactions/{type}/{id}/status/` | 资助审批 |
| `GET/POST/PATCH/DELETE` | `/api/admin/projects/`、`/api/admin/projects/{id}/` | 全站课题管理 |
| `POST` | `/api/admin/projects/bulk-archive/` | 批量归档 |
| `GET/POST/PATCH/DELETE` | `/api/admin/themes/` | 主题管理 |
| `GET/POST/PATCH/DELETE` | `/api/admin/theme-files/` | 主题数据集说明记录管理 |
| `POST` | `/api/admin/theme-files/{file_id}/detail-pdf/` | 上传数据集说明 PDF |
| `GET/POST/PATCH/DELETE` | `/api/admin/project-documents/` 相关路径 | 课题主 PDF 管理 |
| `GET` | `/api/admin/audit-logs/` | 审计日志 |

### 4.7 Legacy / Compatibility APIs

下面接口仍在代码中，但不是当前产品主流程：

- `/api/admin/tasks/`
- `/api/me/tasks/`
- `/api/admin/credits/`
- 任务分配、旧任务状态、默认任务奖励。

修改原则：

- 可以修 bug、保证兼容和测试通过。
- 不要把它们重新放回主导航或主协作流程。
- 如需求明确要重启这些能力，必须先写新的生命周期设计文档。

## 5. 数据库模型基准

### 5.1 用户与资料

主要模型：`accounts.models.UserProfile`

关键字段：

- `user`: Django `auth.User`
- `uid`: 平台唯一 UID
- `role_type`: 用户身份
- `contact_email` / `email_normalized`: 联系邮箱和唯一性约束
- `must_change_password`: 默认密码登录后的强制改密标记
- `credit_balance` / `reputation_score`: 保留字段，当前不是主流程核心

管理员固定：

- 用户名：`platform_admin`
- UID：`ADM00000001`
- 通过 `ensure_platform_admin` 命令维护。

### 5.2 课题、主题和文件

主要模型在 `projects/models.py`：

- `Theme`: 主题。
- `Project`: 课题主体，包含阶段、公开状态、上传者、结构化字段、评分维度。
- `ProjectTag`: 标签。
- `ProjectDocument`: 单课题文档。
- `ThemeFile`: 主题文件域文件。
- `ProjectTask`: 历史任务模型，当前非主流程。
- `AuditLog`: 审计日志。

课题必须记录 `created_by`，用于普通用户 ownership 和每日上传限制。

### 5.3 用户关系

主要模型在 `interactions/models.py`：

- `ProjectFollow`: 收藏。
- `ProjectScore`: 点赞。
- `ProjectInterest`: 参与。
- `ProjectClaimIntent`: 认领和资助意向。

当前产品口径：

- 参与和认领自动通过。
- 资助意向待管理员审批。
- 关系展示只暴露 UID。

### 5.4 任务结果和积分

主要模型在 `credits/models.py`：

- `Contribution`: 用户任务结果。
- `CreditLedger`: 积分流水，当前非主流程。

当前产品口径：

- 用户提交的是课题级任务结果。
- 管理员审核结果，但不默认发积分。
- 旧任务奖励保留接口兼容，不作为新需求默认扩展点。

### 5.5 审计日志

主要模型：`projects.models.AuditLog`

需要记录：

- 操作者 UID。
- action。
- target_type / target_id。
- before / after。
- source。
- status。
- error_code / error_message。
- request_id。

新增任何数据库写路径时，都要确认是否调用统一审计逻辑。

## 6. 前端结构基准

当前前端是单文件 SPA，主要逻辑集中在 `frontend/src/main.js`，样式集中在 `frontend/src/styles.css`。

### 6.1 路由

哈希路由由 `parseRoute`、`navigate` 和 `loadRouteData` 驱动。常用路由：

| 路由 | 页面 |
| --- | --- |
| `#/` | 课题库首页 |
| `#/project/{id}` | 课题详情 |
| `#/dashboard` | 我的空间 |
| `#/admin` | 管理员工作台 |
| `#/login` | 登录 |
| `#/register` | 注册 |
| `#/password-change` | 强制改密 |

### 6.2 用户空间

用户空间应展示：

- 总览。
- 我的收藏。
- 我的任务：我与课题的关系、课题状态、可提交任务结果入口。
- 我上传：自己上传的课题、剩余配额、新增/编辑入口。
- 个人资料。

不要恢复旧“我的任务分配”作为主入口。

### 6.3 管理员空间

管理员空间应展示：

- 总览。
- 任务审批：只处理资助意向。
- 任务管理：按课题查看人员 UID 和任务结果。
- 课题管理。
- 主题与文件域。
- 用户管理。
- 审计日志。

历史入口原则：

- 旧任务、积分流水、JSON 导入等如果仍存在，必须明确是兼容或辅助能力。
- 不要在主流程中默认引导用户走旧任务拆分和积分奖励。

### 6.4 UI 反馈基准

所有用户操作必须有反馈：

- 成功：toast、按钮文本变化、状态刷新、弹窗关闭或列表更新。
- 失败：展示后端 `message` 或字段错误。
- 加载：按钮禁用或页面 loading，不能重复提交造成状态错乱。
- 空态：明确说明没有数据，而不是空白。
- 弹窗：确认弹窗必须在业务弹窗之上。

## 7. 修改决策规则

### 7.1 能复用 API 就不新增 API

优先复用：

- 课题状态变化：`PATCH /api/admin/projects/{id}/` 或用户自己的 `PATCH /api/projects/{id}/`。
- 归档：`PATCH` 设置阶段/公开状态或现有软删除接口。
- 用户关系：现有 follow/interest/claim/sponsor/withdraw。
- 任务结果：现有 contribution API。

禁止新增同义接口：

- `publishProject`
- `startProject`
- `pauseProject`
- `archiveProject`
- `approveParticipation`
- `approveClaim`

除非产品生命周期明确改变，且文档、测试、前后端都同步更新。

### 7.2 不要恢复已经裁掉的主流程

不要在主产品流程恢复：

- 管理员审批参与。
- 管理员审批认领。
- 课题拆成 `ProjectTask` 后分配 UID。
- 任务审核默认发积分。
- 邮箱验证闭环。
- 邮箱重置密码。
- 公开页面展示用户名、邮箱、真实姓名。

### 7.3 UI 改动必须同时查三处

任何前端 UI 改动至少检查：

1. `frontend/src/main.js` 的状态、事件和渲染逻辑。
2. `frontend/src/styles.css` 的布局、层级和响应式。
3. 对应测试文件，尤其是 `frontend/src/uiPlacement.test.js`、`frontend/src/profileMenu.test.js`、`frontend/src/release.test.js` 或 `frontend/src/api.test.js`。

弹窗、下拉、悬浮卡、顶部导航、表格都要检查桌面和小屏。

### 7.4 数据库改动必须有迁移和测试

修改模型时必须：

- 修改对应 `models.py`。
- 生成并检查 migration。
- 更新 serializer / API payload。
- 更新前端字段展示或表单。
- 更新测试。
- 更新本文档的数据模型基准。

### 7.5 审计和错误不能后补

新增写接口时，当场补齐：

- 事务。
- 权限校验。
- 审计日志。
- 明确错误结构。
- 前端错误展示。
- 成功反馈。

不要先实现功能，再把日志和错误留到以后。

## 8. 版本号和更新日志

当前版本从 `VERSION` 读取，并通过 `/api/meta/` 给前端展示。

修改以下内容时必须考虑版本号：

- 用户可感知的新功能。
- 生命周期规则变化。
- API 语义变化。
- 数据库迁移。
- 主要 UI/导航调整。
- 修复会影响用户操作结果的 bug。

必须同步：

1. `VERSION`
2. `CHANGELOG.md`
3. `/api/meta/` 展示
4. 前端版本弹窗
5. 本文档当前版本信息

## 9. 验收矩阵

### 9.1 必跑命令

常规代码改动：

```bash
conda run -n openmedailab python manage.py check
conda run -n openmedailab python manage.py test
node --test frontend/src/*.test.js
node --check frontend/src/main.js
git diff --check
```

只改 Markdown 文档：

```bash
git diff --check
rg -n 'TO[D]O|TB[D]|FIX[M]E|待[定]|不确[定]' AGENTS.md
```

如果本机没有 `npm`，不要声称 `npm run build` 已通过；明确说明环境缺少 npm。

### 9.2 浏览器验收路径

涉及前端时，至少用浏览器覆盖：

1. 访客打开课题库，搜索和筛选有反馈。
2. 访客打开课题详情，预览课题主 PDF，查看主题数据集说明 PDF。
3. 用户登录、收藏、取消收藏。
4. 用户参与、认领、资助，观察状态反馈。
5. 用户进入我的空间，查看我的任务、我上传、个人资料。
6. 用户提交任务结果。
7. 管理员登录，进入任务审批、任务管理、课题管理、用户管理、审计日志。
8. 管理员审批资助、审核任务结果、修改课题阶段。
9. 管理员恢复用户默认密码，用户强制改密后重新登录。
10. 小屏检查顶部导航、弹窗、状态卡、表格。

### 9.3 关键断言

- 草稿和归档不公开。
- 参与和认领自动通过。
- 资助由管理员审批。
- 非进行中课题不能提交任务结果。
- 未参与/未认领用户不能提交任务结果。
- 普通用户不能修改他人课题。
- 普通用户每日上传课题不能超过 10 个。
- 所有写操作有审计。
- 所有失败有明确反馈。
- 涉及人员展示时只展示 UID。

## 10. 当前已知风险

| 风险 | 级别 | 说明 | 处理原则 |
| --- | --- | --- | --- |
| `api/ninja_api.py` 过大 | 中 | API、校验、辅助函数集中在单文件 | 新任务先按本文定位函数；未来拆分必须先补测试 |
| `frontend/src/main.js` 过大 | 中 | 页面、状态、渲染、事件集中 | UI 改动要配套测试；拆分时不改变行为 |
| 旧 `ProjectTask` 和积分接口仍存在 | 中 | 容易被误用回主流程 | 保留兼容，不新增主入口 |
| JSON 导入接口仍存在 | 中 | 当前产品更偏课题模板和文档导入，但代码仍有 JSON 导入 | 移除前必须查前端入口、测试和历史数据 |
| 传统 Django 账号页面仍存在 | 低到中 | 与 SPA 可能分叉 | 当前应保持跳转 SPA |
| 登录安全仍是 MVP | 中 | 暂无登录限流、MFA、异常登录风控 | 面向公网前补安全治理 |
| 静态图片资源可能缺失 | 低 | 本地服务日志曾出现 logo/topic logo 404 | 视觉验收时检查资源路径 |

## 11. Agent 修改清单

开工前：

- 当前分支是否正确？
- 是否需要拉取目标分支最新代码？
- 是否已读本文档？
- 任务属于本文哪一个定位索引？
- 是否有现有 API 可复用？
- 是否会影响生命周期、权限、数据库或版本？

修改时：

- 是否避免新增冗余 API？
- 是否避免恢复旧任务拆分和积分主流程？
- 是否只展示 UID 而非敏感个人信息？
- 是否补齐权限校验、事务和审计？
- 是否补齐明确错误和前端反馈？
- 是否处理小屏和弹窗层级？

完成前：

- 是否跑了对应测试？
- 是否做了浏览器验收？
- 是否需要更新 `VERSION`、`CHANGELOG.md`？
- 是否需要更新本文档？
- 是否说明了未能执行的命令或环境限制？
