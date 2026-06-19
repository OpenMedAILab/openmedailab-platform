# 招募超额显示、主题快捷排序、课题进度页、讨论区与侧边栏二维码入口实现文档

更新时间：2026-06-17

适用版本基线：`VERSION = 0.10.1`

本文档定义需求、实现方案、测试矩阵和验收标准，并已同步当前实现状态。后续执行时若改变系统规则、接口语义、数据模型、前端入口或验收方式，必须同步更新 `AGENTS.md`、`CHANGELOG.md` 和版本信息。

实现状态（2026-06-17）：

- `0.10.1` 补齐管理员课题编辑弹窗中的“项目进度文档”上传入口，进度 PDF 会按历史保留并进入课题进度时间线。
- 招募超额显示、主题快捷排序、课题进度页、课题讨论区、侧边栏二维码入口均已在 `0.9.0` 中实现。
- `0.9.1` 将左侧边栏二维码从静态占位升级为管理员可维护配置，管理员可在管理端“系统入口”上传或替换“联系管理员”“加入社区”二维码。
- `0.9.2` 优化首页主题入口，下拉只展示第一行之外的主题，展开后末尾按钮从“展示全部主题”切换为“收起全部主题”。
- `0.10.0` 优化任务结果提交：提交后无需管理员审批，用户可上传一份 PDF/Markdown 结果文档，管理员可在任务管理中打开查看。
- Linux 下 JSON 导入目录/文件选择缺陷已按第 13 节方案修复。
- 已新增后端目标测试和前端静态/API 测试，并纳入本文档第 11 节验收清单。

## 1. 目标范围

本次新增五类用户可见能力：

1. 当某类人员参与数量超过最低招募需求时，课题卡和相关详情中要与“未满足”“刚好满足”区别显示。
2. 主题管理界面允许管理员对主题做快捷排序，不必逐个打开主题表单手动输入排序数字。
3. 每个课题标题链接进入一个独立课题页面，页面展示该课题的进度流，包括不同日期上传的项目文档。
4. 每个公开课题拥有一个讨论区，所有访客可查看讨论，所有已登录用户可围绕本课题发起讨论和回复。
5. 系统左侧边栏保留两个固定入口：“联系管理员”和“加入社区”，点击后以小弹窗展示对应二维码。

非目标：

- 不恢复旧 `ProjectTask` 拆任务、分配 UID、任务奖励作为主流程。
- 不公开用户名、邮箱、真实姓名或敏感审计细节。
- 不把管理员审计日志原样暴露到公开课题详情页。
- 不改变参与、认领、资助的审批规则：参与和认领仍自动通过，资助仍由管理员审批。
- 不做实时聊天、私信、@ 提醒、富文本编辑器、附件上传或消息推送；本阶段只做项目级异步文本讨论。
- 不允许匿名写入讨论；“所有人都可以讨论”在当前权限基准下解释为所有已登录用户都可以发言，访客只读。
- 不记录二维码扫码、点击来源或访问统计；二维码只作为公开展示图片，不做外部跳转追踪或动态运营位。

## 2. 当前代码基准

### 2.1 招募状态

当前 `projects.models.Project.team_status` 返回：

- `required_roles`: 医生、学生、博士毕业及以上、项目负责人四类最低需求状态。
- 每类当前只有 `count` 和 `ready`。
- 前端 `frontend/src/main.js` 的 `requiredTeamRoles(teamStatus)` 用默认最低需求 `required = 1` 补足显示。
- 当前样式只区分 `ready`，无法区分 `count === required` 和 `count > required`。

### 2.2 主题排序

当前 `projects.models.Theme` 已有 `sort_order` 字段，后端管理列表和公开 meta 都按 `sort_order, name` 排序。

当前管理端能力：

- `GET /api/admin/themes/`
- `POST /api/admin/themes/`
- `PATCH /api/admin/themes/{id}/`
- `DELETE /api/admin/themes/{id}/`

当前前端只在主题编辑弹窗里暴露数字输入 `sort_order`，没有快捷排序入口。

### 2.3 课题文档与课题链接

当前 `ProjectDocument` 支持一个课题多文档，但当前主流程只使用：

- `document_kind = "detail"`
- `doc_type = "pdf"`
- 上传新的主 PDF 时，`save_project_detail_pdf()` 会删除旧主 PDF 记录和文件。

当前公开详情：

- `GET /api/projects/{id}/` 返回公开课题详情，但 `documents` 只返回主 PDF。
- 首页课题标题如果有主 PDF，直接打开 PDF；如果没有 PDF，则标题不可点击。

这与“点击课题链接进入项目进度页面，查看不同日期上传文档”的目标不一致。

### 2.4 课题讨论

当前代码中没有项目级讨论区模型或 API。

已有相关但不等价的能力：

- `ProjectScore.comment` 是点赞反馈备注，不适合作为公开讨论流。
- `Contribution.review_comment` 是旧兼容审核评语，不属于当前公开讨论或任务结果提交主流程。
- `AuditLog` 是内部审计，不适合作为用户讨论内容。

因此讨论区需要新增独立业务模型、公开读取 API、登录用户写入 API 和管理员 moderation 能力。

### 2.5 侧边栏系统入口

当前桌面端已经通过 `.app-shell` 和 `.topbar` 形成左侧栏式布局，小屏下 `.topbar` 会收缩为顶部区域；但现有左侧栏只有主导航、聚合统计和账号入口，尚无固定辅助系统入口。

新增“联系管理员”和“加入社区”属于全站辅助入口，不依赖登录态、不改变课题或协作业务状态。二维码图片需要定期维护，因此采用“公开读取、管理员上传”的系统配置方式：不新增数据库模型，文件存放在 `MEDIA_ROOT/system-qrcodes/`，上传成功写审计。

### 2.6 任务结果提交优化

任务结果属于用户对进行中课题的协作交付，不再走管理员审批主流程。提交资格仍由后端统一校验：课题必须处于 `active`，且当前用户已有已通过的参与或认领关系；单纯资助关系不产生提交权限。

实现方案：

- 保留 `POST /api/me/contributions/` 的 JSON 提交能力，用于只填写标题、类型和说明内容的结果。
- 新增 `POST /api/me/contributions/upload/` 表单提交能力，允许同一次提交上传一份结果文档。
- 结果文档只支持 `.pdf`、`.md`、`.markdown`，文件保存到 `MEDIA_ROOT/contribution-documents/{topic_code}/{uid}/`，公开路径写入 `Contribution.file_path`。
- PDF 上传需要校验文件头，Markdown 通过扩展名白名单校验；保存路径必须经过 `safe_child_path`，不能越过媒体目录。
- 提交成功后 `Contribution.status` 保持 `submitted`，表示已提交完成，不代表等待审批。
- 管理员“任务管理”只查看结果标题、说明、提交 UID 和文档入口；不再展示审核评语、通过、拒绝或需修改按钮。
- 旧 `/api/admin/contributions/{id}/review/` 保留兼容旧任务奖励和历史自动化，不作为当前前端主流程入口。

## 3. 方案总览

### 3.1 推荐架构

采用六条小而清晰的改造线：

1. 招募超额显示：后端在 `team_status.required_roles` 中补充 `required`、`overfilled`、`status`，前端兼容旧字段并增加超额样式。
2. 主题快捷排序：新增管理员主题批量排序 API，前端主题管理列表提供上移、下移、置顶、置底和保存排序。
3. 课题进度页：新增前端路由 `#/project/{id}`，新增公开进度 API，保留主 PDF 规则，同时新增项目进度文档能力，按日期展示进度文本、文档和阶段变化。
4. 课题讨论区：在课题进度页内新增讨论模块，新增项目级讨论模型和 API，所有人可查看，登录用户可发言，管理员可隐藏或删除违规内容。
5. 侧边栏二维码入口：在全站左侧保留两个低干扰按钮，点击打开轻量二维码弹窗；二维码配置公开读取，管理员在管理端“系统入口”上传或替换图片，缺失时空态兜底。
6. 任务结果提交：用户提交结果无需审批，可附带一份 PDF/Markdown 文档；管理员在任务管理中只读查看。

### 3.2 为什么不用审计日志直接做公开进度流

审计日志包含操作者、来源、错误信息和内部对象变化，不适合直接公开。课题进度页应使用明确的公开/半公开业务 payload，而不是把 `AuditLog` 暴露出去。

### 3.3 数据可见性原则

公开课题页只展示：

- 公开且未归档课题的基本信息。
- 阶段、组队状态、公开项目进度文本。
- 被标记为公开的项目文档。
- 可见状态的讨论内容、回复数量和讨论作者 UID。
- UID 级别贡献者信息，若需要展示上传者，仅展示 UID，不展示用户名、邮箱或真实姓名。
- 左侧边栏只展示固定入口文案和图标，不展示管理员联系方式明文、社区邀请链接或任何用户信息。

管理员和课题 owner 可以看到更多内部文档和管理操作，但仍不展示密码、密钥或完整敏感日志。

讨论内容属于用户生成内容，不能展示用户名、邮箱、真实姓名、IP、User-Agent 或后台审计细节。若后续需要处理违规内容，应通过管理员隐藏、删除和审计完成，而不是在公开页面展示敏感 moderation 信息。

## 4. 功能一：招募超额区别显示

### 4.1 后端数据契约

修改位置：

- `projects/models.py`
- `api/serializers.py`

`Project.team_status["required_roles"]` 中每一项建议统一为：

```json
{
  "key": "doctor",
  "label": "医生（医学指导）",
  "count": 2,
  "required": 1,
  "ready": true,
  "overfilled": true,
  "status": "overfilled"
}
```

字段语义：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `count` | number | 当前 approved 参与或认领折算后的数量 |
| `required` | number | 最低招募需求，当前四类默认都是 1 |
| `ready` | boolean | `count >= required` |
| `overfilled` | boolean | `count > required` |
| `status` | string | `missing`、`ready`、`overfilled` |

兼容要求：

- 前端仍要兼容旧 payload 中没有 `required`、`overfilled`、`status` 的情况。
- `required` 当前先固定为 1；如未来允许课题自定义最低需求，再扩展模型字段。

### 4.2 前端显示规则

修改位置：

- `frontend/src/main.js`
- `frontend/src/styles.css`
- `frontend/src/uiPlacement.test.js`

当前显示：

```text
医生 0/1
医生 1/1
```

新增显示：

```text
医生 2/1 · 超额
```

视觉语义：

| 状态 | 条件 | 文案 | class |
| --- | --- | --- | --- |
| 未满足 | `count < required` | `0/1` | 默认 |
| 刚好满足 | `count === required` | `1/1` | `ready` |
| 超过最低需求 | `count > required` | `2/1 · 超额` | `overfilled` |

颜色不能替代文字，必须保留 `count/required` 和“超额”字样。

### 4.3 测试要求

后端：

- `Project.team_status` 在某角色 `count = 0` 时返回 `status = "missing"`。
- `count = required` 时返回 `ready = true`、`overfilled = false`、`status = "ready"`。
- `count > required` 时返回 `ready = true`、`overfilled = true`、`status = "overfilled"`。

前端：

- `requiredTeamRoles()` 能从后端字段读取 `required`、`overfilled`、`status`。
- 首页课题卡和任何复用课题卡组件的收藏/我的空间视图都能渲染 `overfilled` class；如果我的空间保持行式任务列表，不为行式列表额外新增拥挤的组队徽章，只保证复用的状态展示不回退。
- UI 测试断言存在 `overfilled` 样式和“超额”文案。

### 4.4 验收标准

- 当医生为 `0/1` 时，不显示“超额”。
- 当医生为 `1/1` 时，显示已满足样式，不显示“超额”。
- 当医生为 `2/1` 时，显示 `医生 2/1 · 超额`，并使用不同于 `ready` 的视觉样式。
- 学生、AI博士及以上、项目负责人四类都遵循同一规则。
- 状态卡、首页课题列表和复用课题卡组件的我的空间/收藏视图显示一致；行式列表保持现有密度，不强制新增卡片级状态徽章。

## 5. 功能二：主题管理快捷排序

### 5.1 后端 API 设计

新增接口：

| 方法 | 路径 | 权限 | 用途 |
| --- | --- | --- | --- |
| `PATCH` | `/api/admin/themes/reorder/` | `manage_themes` | 批量更新主题排序 |

请求体：

```json
{
  "theme_ids": [3, 1, 5, 2]
}
```

响应必须沿用当前后端统一 envelope，通过 `ok({"themes": themes})` 返回：

```json
{
  "ok": true,
  "data": {
    "themes": [
      { "id": 3, "name": "ROP", "sort_order": 10 },
      { "id": 1, "name": "AntiVEGF", "sort_order": 20 }
    ]
  }
}
```

所有新增 API 成功响应都必须走现有 `ok(payload)` envelope；错误响应走现有 `fail(...)` / `error_payload(...)`，不要新增另一套响应结构。

排序规则：

- 后端按传入顺序重写 `sort_order`。
- 建议使用 `10, 20, 30...` 递增，便于未来插队。
- 必须事务化。
- 必须校验所有 `theme_ids` 都存在。
- 允许 inactive 主题参与排序，因为管理端主题列表展示全站主题。
- 写入审计：`theme.reorder`，记录排序前后的 `id -> sort_order` 映射。

错误结构：

| 场景 | code | message |
| --- | --- | --- |
| 非管理员 | `permission_denied` | `Permission denied.` |
| theme id 不存在 | `validation_error` | `Theme ids contain unknown items.` |
| theme_ids 为空 | `validation_error` | `theme_ids is required.` |

### 5.2 前端交互

修改位置：

- `frontend/src/api.js`
- `frontend/src/main.js`
- `frontend/src/styles.css`
- `frontend/src/uiPlacement.test.js`

主题管理列表新增快捷排序区：

- 每行提供：
  - 上移
  - 下移
  - 置顶
  - 置底
- 列表顶部或底部提供：
  - 保存排序
  - 恢复排序

交互规则：

- 点击上移/下移/置顶/置底只改变本地 `state.admin.themes` 顺序，并标记 `themeSortDirty = true`。
- 点击保存排序才调用 `/api/admin/themes/reorder/`。
- 保存成功后刷新 `state.meta.themes` 和 `state.admin.themes`。
- 保存失败时保留本地编辑态，并显示错误 toast。
- 正在保存时按钮 disabled，避免重复提交。

### 5.3 为什么不只保留数字输入

数字输入适合精确维护，但不适合快速调整多个主题的相对位置。快捷排序保留原 `sort_order` 字段，同时降低管理员操作成本。

### 5.4 测试要求

后端：

- 管理员传入 `[B, A, C]` 后，`sort_order` 按 B、A、C 更新。
- 未登录和无权限用户不能排序。
- 传入不存在的主题 id 时返回稳定错误结构。
- 审计日志记录 `theme.reorder`。

前端：

- `frontend/src/api.js` 暴露 `adminReorderThemes(themeIds)`。
- 点击上移/下移会改变本地主题数组顺序，不立刻调用保存 API。
- 点击保存排序调用 API，并刷新主题列表。
- 有未保存排序时显示明确状态，例如“排序未保存”。

### 5.5 验收标准

- 管理员可在主题管理页不打开编辑弹窗，直接调整主题相对顺序。
- 保存后刷新页面，顺序保持一致。
- 首页主题、主题下拉和公开 meta 使用保存后的排序。
- 主题数据集说明列表仍按主题排序稳定展示。
- 停用主题也能在管理端参与排序，但不进入公开主题入口。
- 每次保存排序都有审计记录。

## 6. 功能三：课题独立进度页与多日期文档

### 6.1 路由与入口

新增前端路由：

```text
#/project/{id}
```

入口变更：

- 首页课题标题链接不再直接打开 PDF。
- 点击课题标题进入 `#/project/{id}`。
- PDF 查看和下载按钮保留，仍直接打开文档。
- 我的空间、管理员任务管理中的课题标题也尽量复用同一课题页入口。

路由实现要求：

- `parseRoute()` 需要识别 `#/project/{id}`，返回 `{ name: "project", params: { id }, fullPath }`。
- `buildHash("project", { id })` 需要返回 `#/project/{id}`，不要继续只返回一级路由。
- `loadRouteData()` 增加 `state.route.name === "project"` 分支，按 `params.id` 加载课题进度和讨论区。
- `frontend/src/uiPlacement.test.js` 需要把当前“课题标题仍为 PDF 链接”的断言改为“标题进入课题页，PDF 按钮仍打开 PDF”。

### 6.2 页面内容

课题进度页应包含：

1. 课题基本信息：编号、标题、主题、阶段、标签、摘要。
2. 组队与资助状态：沿用课题卡状态规则，包括超额显示。
3. 当前项目进度：展示 `Project.project_progress`。
4. 项目进度时间线：
   - 阶段变化。
   - 管理员或 owner 上传的项目文档。
   - 用户已提交的任务结果摘要；该类时间线建议运行时从 `Contribution` 派生，不作为内容备份恢复对象。
5. 文档区：
   - 主 PDF。
   - 不同日期上传的项目进度文档。
   - 每个文档显示标题、说明、上传日期、查看、下载。

### 6.3 数据模型建议

当前 `ProjectDocument` 可以保存多文档，但主 PDF 上传逻辑会删除旧主 PDF。为支持“不同日期上传的文档”，建议做两层改造：

#### 6.3.1 扩展 `ProjectDocument.DocumentKind`

新增：

```python
PROGRESS = "progress", "项目进度文档"
```

保留：

- `DETAIL = "detail"`：课题主 PDF，仍只维护一份当前主 PDF。
- `SUPPLEMENT = "supplement"`：补充说明。

新增可选字段建议：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `uploaded_by` | FK User nullable | 上传者，仅内部或 UID 展示；内容备份不保存或恢复该用户 FK |
| `visibility` | string | `public`、`owner_admin`，默认 `public` |

如果本阶段不新增 `uploaded_by` 和 `visibility`，也必须在文档中明确所有进度文档都会公开展示，不得混入敏感文件。

#### 6.3.2 新增 `ProjectProgressEntry`

建议新增模型：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `project` | FK Project | 所属课题 |
| `entry_type` | string | `stage`、`document`、`note` |
| `title` | string | 时间线标题 |
| `description` | text | 时间线说明 |
| `occurred_at` | datetime | 发生时间 |
| `created_by` | FK User nullable | 创建者，公开时只输出 UID；内容备份不保存或恢复该用户 FK |
| `document` | FK ProjectDocument nullable | 关联文档 |
| `visibility` | string | `public`、`owner_admin` |

不推荐直接复用 `AuditLog` 做公开时间线。

不推荐在 `ProjectProgressEntry` 中持久化 `Contribution` 外键。任务结果属于用户协作数据，当前内容备份恢复明确不覆盖用户账号、协作关系和任务结果；如进度页需要展示已提交任务结果摘要，应在读取进度页时从 `Contribution` 按权限动态派生，只输出 UID 和摘要，不进入内容备份 ZIP。

#### 6.3.3 内容备份边界

内容备份恢复当前只覆盖主题、标签、课题、主题数据集说明记录、课题 PDF 和对应媒体文件，不覆盖用户、协作关系、任务结果、积分和审计日志。本需求实现时：

- `ProjectDocument(document_kind="progress")` 和对应媒体文件属于课题内容，可纳入内容备份恢复。
- `ProjectProgressEntry(entry_type="stage" | "document" | "note")` 如果只依赖课题和文档，可纳入内容备份恢复。
- 备份 manifest 不保存 `uploaded_by`、`created_by`、`deleted_by`、`hidden_by` 等用户 FK；恢复时这些字段应置空，或只保留不可恢复的 UID 摘要字段用于只读展示，不得尝试按用户名、邮箱或 UID 重建用户关系。
- 由 `Contribution` 派生的进度项不进入备份恢复，恢复后由当前数据库中的任务结果重新计算；如果目标环境没有对应任务结果，则不显示该类派生时间线。
- 备份恢复实现需要同步更新 `projects/management/commands/import_project_bundle.py` 以及 `api.ninja_api` 中的 `build_content_backup_manifest()`、`restore_content_backup()` 和恢复测试。

### 6.4 API 设计

新增公开 API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/projects/{id}/progress/` | 获取课题进度页数据 |

公开响应结构必须沿用当前后端统一 envelope，通过 `ok(payload)` 返回：

```json
{
  "ok": true,
  "data": {
    "project": {
      "id": 12,
      "topic_code": "T0012",
      "title": "示例课题",
      "stage": "active",
      "stage_label": "进行中",
      "team_status": {}
    },
    "progress_text": "当前项目进展说明",
    "documents": [
      {
        "id": 8,
        "document_kind": "progress",
        "title": "第 1 周进度",
        "description": "完成数据清洗",
        "path": "/media/project-documents/T0012/week-1.pdf",
        "created_at": "2026-06-17T10:00:00+08:00"
      }
    ],
    "timeline": [
      {
        "id": 101,
        "entry_type": "document",
        "title": "上传第 1 周进度",
        "description": "完成数据清洗",
        "occurred_at": "2026-06-17T10:00:00+08:00",
        "document": {}
      }
    ]
  }
}
```

权限规则：

- 访客只能访问公开且未归档课题的公开进度。
- 已登录普通用户与访客相同，除非是课题 owner。
- 课题 owner 和管理员可以看到 `owner_admin` 可见内容。
- 归档课题默认不公开进度页，除非后续产品明确允许只读公开归档页。

### 6.5 上传 API 调整

当前上传 API：

- `POST /api/project-documents/upload/`
- `POST /api/admin/project-documents/upload/`

调整规则：

- `document_kind = "detail"`：仍只维护一份主 PDF，上传后替换旧主 PDF。
- `document_kind = "progress"`：新增一份进度文档，不删除旧文档。
- 进度文档上传成功后自动创建一条 `ProjectProgressEntry(entry_type="document")`。

表单字段：

| 字段 | 是否必填 | 说明 |
| --- | --- | --- |
| `project_id` | 是 | 课题 id |
| `document_kind` | 是 | `detail` 或 `progress` |
| `title` | 否 | 默认使用文件名 |
| `description` | 否 | 进度说明 |
| `occurred_at` | 否 | 默认当前时间 |
| `files` | 是 | PDF 文件，进度文档本阶段仍限制一份一传 |

### 6.6 前端页面设计

修改位置：

- `frontend/src/api.js`
- `frontend/src/main.js`
- `frontend/src/styles.css`
- `frontend/src/uiPlacement.test.js`

新增状态：

```js
state.projectProgress = {
  loading: false,
  project: null,
  documents: [],
  timeline: [],
  error: ""
}
```

新增函数：

- `loadProjectProgress(projectId)`
- `projectDetailPageHref(project)`
- `projectProgressDocuments(projectProgress)`
- `projectProgressTimelineItems(projectProgress)`

页面布局：

1. 顶部返回按钮：返回课题库。
2. 课题标题和阶段。
3. 组队状态条。
4. 当前进度正文。
5. 文档列表，按 `created_at` 倒序。
6. 时间线，按 `occurred_at` 倒序。

响应式要求：

- 小屏下文档列表和时间线单列展示。
- 文档标题、路径和说明必须能换行，不允许撑破屏幕。
- PDF 查看/下载按钮不能遮挡文档内容。

### 6.7 测试要求

后端：

- 公开课题可访问 `/api/projects/{id}/progress/`。
- 草稿和归档课题对访客不可访问。
- 上传 `document_kind="progress"` 不删除旧主 PDF，也不删除旧进度文档。
- 上传 `document_kind="detail"` 仍替换旧主 PDF。
- 进度文档按日期排序返回。
- 内容备份导出不包含 `uploaded_by`、`created_by` 等用户 FK；恢复后相关用户 FK 为空，且进度文档和内容化进度记录仍可读取。
- 公开响应不包含邮箱、用户名、真实姓名。

前端：

- 课题标题链接指向 `#/project/{id}`，不再直接指向 PDF。
- `查看PDF` 和 `下载PDF` 仍直接使用文档地址。
- 课题进度页能展示项目进度文本、多个文档和时间线。
- 缺少文档时展示空状态，不报错。
- 小屏布局不横向溢出。

### 6.8 验收标准

- 访客从首页点击课题标题进入课题进度页。
- 页面能看到课题基础信息、组队状态、当前项目进度。
- 同一课题在不同日期上传的进度 PDF 都能按日期展示。
- 主 PDF 替换不影响历史进度文档。
- 点击进度文档的查看/下载能打开正确文件。
- 访客看不到草稿或归档课题进度。
- 普通用户只能上传自己课题的进度文档；管理员可上传全站课题进度文档。
- 所有文档上传、删除和进度创建都写审计。

## 7. 功能四：课题讨论区

### 7.1 产品口径

每个公开且未归档课题拥有一个讨论区，讨论区挂在课题进度页中。

可见性规则：

- 访客可以查看公开课题的可见讨论内容。
- 已登录普通用户、课题 owner 和管理员都可以在公开且未归档课题下发起讨论和回复。
- 草稿课题不公开讨论区；只有 owner 和管理员可在未来扩展内部讨论，本阶段不实现内部讨论。
- 归档课题不公开讨论区；公开讨论列表、公开课题页和公开进度页都应像现有公开课题详情一样返回 `not_found` 或不渲染入口。若后续需要查看归档历史讨论，只能通过管理员 moderation 列表或明确的 owner/admin 管理上下文实现，不作为公开只读页。
- 管理员可以隐藏或删除任何讨论内容；普通用户只能编辑或删除自己发布且未被管理员处理的内容。

讨论内容规则：

- 讨论主题不限制为招募、数据、方法或任务结果，用户可以围绕本课题讨论任何相关事项。
- 讨论区不改变课题阶段，不触发参与、认领、资助或任务结果生命周期。
- 讨论作者只展示 UID，不展示用户名、邮箱、真实姓名或最近活跃时间。
- 本阶段只支持纯文本内容，长度建议为 1 到 2000 字符；前端保留换行，后端做空内容和最大长度校验。
- 删除采用软删除，公开页显示“该讨论已删除”或直接隐藏二者择一；推荐直接隐藏删除内容，避免无意义占位。

### 7.2 数据模型建议

新增模型：`ProjectDiscussion`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `project` | FK Project | 所属课题 |
| `author` | FK User | 讨论作者 |
| `parent` | FK self nullable | 父级讨论；为空表示主讨论，非空表示回复 |
| `content` | text | 纯文本讨论内容 |
| `status` | string | `visible`、`hidden`、`deleted` |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |
| `deleted_at` | datetime nullable | 删除时间 |
| `deleted_by` | FK User nullable | 删除操作者 |
| `hidden_at` | datetime nullable | 隐藏时间 |
| `hidden_by` | FK User nullable | 隐藏操作者 |
| `moderation_reason` | text blank | 管理员隐藏或删除原因，不进入公开 payload |

状态语义：

| 状态 | 公开页是否展示 | 作者是否可编辑 | 管理员是否可见 | 说明 |
| --- | --- | --- | --- | --- |
| `visible` | 是 | 是 | 是 | 正常讨论 |
| `hidden` | 否 | 否 | 是 | 管理员隐藏违规或不适合公开内容 |
| `deleted` | 否 | 否 | 是 | 作者或管理员删除 |

回复层级：

- 本阶段只支持一层回复：主讨论可以有回复，回复不能继续被回复。
- 后端如果收到 `parent_id` 指向回复，应返回 `validation_error`。
- 列表接口按主讨论分页，回复随主讨论返回最近若干条；如果需要更多回复，后续再扩展单独回复分页。

### 7.3 API 设计

新增公开/登录用户 API：

| 方法 | 路径 | 权限 | 用途 |
| --- | --- | --- | --- |
| `GET` | `/api/projects/{id}/discussions/` | 公开课题可访客读取 | 获取课题讨论列表 |
| `POST` | `/api/projects/{id}/discussions/` | 登录用户 | 新增主讨论或回复 |
| `PATCH` | `/api/project-discussions/{discussion_id}/` | 作者或管理员 | 编辑讨论内容 |
| `DELETE` | `/api/project-discussions/{discussion_id}/` | 作者或管理员 | 软删除讨论 |

新增管理员 moderation API：

| 方法 | 路径 | 权限 | 用途 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/project-discussions/` | 管理员 | 按课题、作者 UID、状态筛选讨论 |
| `PATCH` | `/api/admin/project-discussions/{discussion_id}/moderation/` | 管理员 | 设置 `visible`、`hidden` 或 `deleted` |

讨论列表请求参数：

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `page` | number | 1 | 主讨论分页 |
| `page_size` | number | 20 | 最大 50 |
| `sort` | string | `newest` | `newest` 或 `oldest` |

创建请求体：

```json
{
  "content": "我建议这个课题先明确数据纳入标准。",
  "parent_id": null
}
```

公开响应结构必须沿用当前后端统一 envelope，通过 `ok(payload)` 返回：

```json
{
  "ok": true,
  "data": {
    "results": [
      {
        "id": 101,
        "project_id": 12,
        "parent_id": null,
        "content": "我建议这个课题先明确数据纳入标准。",
        "author": { "uid": "USR00000008" },
        "status": "visible",
        "created_at": "2026-06-17T10:00:00+08:00",
        "updated_at": "2026-06-17T10:00:00+08:00",
        "reply_count": 2,
        "replies": [
          {
            "id": 102,
            "project_id": 12,
            "parent_id": 101,
            "content": "可以把纳入排除标准放在第一版进度文档里。",
            "author": { "uid": "USR00000009" },
            "status": "visible",
            "created_at": "2026-06-17T10:05:00+08:00",
            "updated_at": "2026-06-17T10:05:00+08:00"
          }
        ]
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 1,
      "total_pages": 1
    }
  }
}
```

错误结构：

| 场景 | code | message |
| --- | --- | --- |
| 未登录发言 | `auth_required` | `Authentication required.` |
| 草稿、归档或不存在课题 | `not_found` | `Project not found.` |
| 内容为空 | `validation_error` | `Discussion content is required.` |
| 内容过长 | `validation_error` | `Discussion content is too long.` |
| 编辑他人讨论 | `permission_denied` | `Permission denied.` |

### 7.4 前端交互

修改位置：

- `frontend/src/api.js`
- `frontend/src/main.js`
- `frontend/src/styles.css`
- `frontend/src/uiPlacement.test.js`

课题进度页新增讨论区模块，位置建议放在“文档列表”和“时间线”之后，避免讨论内容淹没核心进度信息。

新增状态：

```js
state.projectDiscussions = {
  loading: false,
  submitting: false,
  editingId: null,
  deletingId: null,
  results: [],
  pagination: null,
  draft: "",
  replyDrafts: {},
  editDrafts: {},
  error: ""
}
```

新增函数：

- `loadProjectDiscussions(projectId, options = {})`
- `submitProjectDiscussion(projectId, parentId = null)`
- `editProjectDiscussion(discussion)`
- `saveProjectDiscussion(discussion)`
- `deleteProjectDiscussion(discussion)`
- `canEditProjectDiscussion(discussion)`
- `canDeleteProjectDiscussion(discussion)`
- `discussionAuthorLabel(discussion)`

显示规则：

- 访客能看到讨论列表和“登录后参与讨论”入口。
- 登录用户看到主讨论输入框和每条主讨论下的回复入口。
- 作者和管理员看到编辑、删除按钮；其他用户不显示这些操作。
- 正在提交、编辑或删除时按钮 disabled，并给出 toast 或行内状态。
- 空讨论时显示明确空态，例如“还没有讨论，成为第一个提出想法的人。”
- 后端返回错误时展示具体 `message`，不要只显示“提交失败”。

样式要求：

- 讨论区是课题页的普通内容区，不使用嵌套卡片套卡片。
- 每条讨论固定显示 UID、时间、内容和操作按钮。
- 内容保留换行并自动换行，长英文或路径不能撑破屏幕。
- 小屏下回复输入框、编辑按钮和删除按钮不互相遮挡。

### 7.5 权限、审计和隐私

后端写入规则：

- 创建、编辑、删除、管理员隐藏或恢复讨论都必须写审计。
- 审计 action 建议：
  - `project_discussion.create`
  - `project_discussion.update`
  - `project_discussion.delete`
  - `project_discussion.moderate`
- 审计 `after` 可以记录讨论 id、project id、parent id、状态和内容摘要，但不记录完整长文本。
- 失败写入也应记录 request_id、actor 和错误码。

隐私规则：

- 公开 payload 的作者只包含 UID。
- 不返回 `author.username`、邮箱、真实姓名、IP、User-Agent、`moderation_reason`。
- 管理员列表可按 UID 查询，但仍不展示邮箱或真实姓名，除非复用现有管理员用户详情入口。

### 7.6 测试要求

后端：

- 访客可读取公开且未归档课题的讨论列表。
- 访客不能新增讨论。
- 登录用户可在公开且未归档课题下新增主讨论。
- 登录用户可回复主讨论，但不能回复一条回复。
- 作者可编辑和删除自己的 `visible` 讨论。
- 普通用户不能编辑或删除他人讨论。
- 管理员可隐藏、恢复或删除任意讨论。
- 草稿课题对访客返回 `not_found`。
- 归档课题对公开讨论列表和公开写入都返回 `not_found`，不展示公开只读讨论区。
- 公开讨论 payload 只包含 UID，不包含用户名、邮箱、真实姓名。
- 创建、编辑、删除和 moderation 都写审计。

前端：

- `frontend/src/api.js` 暴露讨论区 API 包装，且全部经过统一 `request`。
- 课题进度页会加载并渲染讨论列表。
- 未登录用户看到登录提示，不显示可提交输入框。
- 登录用户提交讨论后刷新列表或把新讨论插入列表，并清空输入框。
- 回复、编辑、删除都有 loading 状态和错误反馈。
- 小屏讨论内容和操作按钮不横向溢出。

### 7.7 验收标准

- 访客进入公开课题进度页，可以看到讨论区和已有讨论。
- 访客不能发言，点击参与入口会进入登录流程或显示登录提示。
- 任意登录用户都可以在公开且未归档课题下发布主讨论和回复。
- 用户发布后，讨论区立即展示新内容，作者显示为 UID。
- 用户可以编辑或删除自己的讨论，不能操作他人的讨论。
- 管理员可以隐藏或删除任意讨论，公开页不再展示被隐藏或删除内容。
- 草稿课题不公开讨论区。
- 归档课题不公开讨论区；公开入口和公开 API 都按不可见处理。
- 讨论区不会改变课题阶段、组队状态、资助状态或任务结果状态。
- 所有讨论写操作都有审计记录和稳定错误反馈。

## 8. 功能五：左侧边栏联系管理员与加入社区入口

### 8.1 产品口径

系统在全站左侧边栏保留两个固定辅助入口：

1. `联系管理员`
2. `加入社区`

点击任一入口后，打开一个小弹窗展示对应二维码。二维码需要支持后续定期维护，因此正式口径为：所有人公开查看，只有管理员可以上传和更新二维码图片。

可见性规则：

- 访客、普通用户和管理员都能看到这两个入口。
- 入口不依赖登录态，不触发登录弹窗。
- 点击查看入口不改变课题、用户关系、任务结果、主题或审计状态，也不写审计。
- 管理员上传或替换二维码属于后台管理写操作，必须写入 `platform_qr.upload` 审计。
- 二维码弹窗只展示图片、标题和极短提示，不展示管理员手机号、微信号、邮箱、社区邀请链接等明文敏感信息。
- 二维码文件缺失时展示 `二维码待更新`，不能显示破损图片，也不能阻断页面使用。

非目标：

- 不记录扫码、点击来源或访问统计。
- 不把二维码做成可编辑富文本运营位、跳转链接或多入口活动位。
- 不新增二维码数据库模型；当前只维护两个固定槽位和对应媒体文件。

### 8.2 API 与存储设计

新增公开读取：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/sidebar-qrs/` | 返回两个固定二维码入口的 label、icon、图片 URL、是否已有图片和更新时间 |

`/api/meta/` 同步返回 `sidebar_qr_entries`，用于首屏初始化；前端也可在管理端刷新时调用 `/api/sidebar-qrs/`。

新增管理员上传：

| 方法 | 路径 | 权限 | 用途 |
| --- | --- | --- | --- |
| `POST` | `/api/admin/sidebar-qrs/{key}/image/` | `view_admin_console` | 上传或替换指定二维码图片 |

固定 `key`：

| key | label | 说明 |
| --- | --- | --- |
| `admin-contact` | 联系管理员 | 管理员联系二维码 |
| `community` | 加入社区 | 社区二维码 |

后端规则：

- 仅接受 `admin-contact` 和 `community` 两个固定 key，其他 key 返回 404。
- 仅接受单个图片文件，扩展名限定 `.png`、`.jpg`、`.jpeg`、`.webp`，非图片返回 422。
- 上传文件不能超过 2MB，并会校验 PNG/JPG/WebP 文件头，避免把伪装成图片的文本文件写入媒体目录。
- 普通用户和访客调用上传接口返回 403 或 401。
- 文件存放在 `MEDIA_ROOT/system-qrcodes/`，命名为 `{key}.{ext}`；重新上传会删除同 key 的其他旧扩展名文件。
- 公开响应中的图片 URL 使用 `MEDIA_URL/system-qrcodes/...` 并附加 mtime query，避免浏览器缓存旧二维码。
- 上传成功写入 `AuditLog(action="platform_qr.upload", target_type="PlatformQRCode", target_id=key)`。

### 8.3 前端设计

修改位置：

- `frontend/src/main.js`
- `frontend/src/styles.css`
- `frontend/src/api.js`
- `frontend/src/uiPlacement.test.js`
- `frontend/src/api.test.js`

前端保留固定槽位定义，用于缺失后端图片时兜底：

```js
const SIDEBAR_QR_ENTRIES = [
  {
    key: "admin-contact",
    label: "联系管理员",
    icon: "support_agent",
    image: ""
  },
  {
    key: "community",
    label: "加入社区",
    icon: "group_add",
    image: ""
  }
];
```

新增或维护状态：

```js
state.meta.sidebar_qr_entries = [];
state.sidebarQrModal = {
  open: false,
  entry: null,
  imageOk: true
};
state.admin.sidebarQrs = [];
state.admin.sidebarQrUploads = {
  "admin-contact": { file: null, inputKey: 0, uploading: false },
  community: { file: null, inputKey: 0, uploading: false }
};
```

关键函数：

- `sidebarQrEntries`
- `sidebarQrImageSrc(entry)`
- `openSidebarQrModal(entry)`
- `closeSidebarQrModal()`
- `markSidebarQrImageMissing()`
- `loadSidebarQrs()`
- `setSidebarQrUploadFile(entry, event)`
- `uploadSidebarQr(entry)`
- `syncSidebarQrEntry(entry)`

交互规则：

- 在现有 `.topbar` 左侧栏中新增一个低优先级辅助区域，按钮固定显示在主导航以下、账号入口以上或同等不抢焦点的位置；不要新建第二套会和 `.topbar` 竞争空间的侧栏。
- 点击按钮打开小弹窗，弹窗标题与入口一致。
- 点击遮罩、关闭按钮或按 `Escape` 可关闭弹窗。
- 二维码加载成功时展示图片。
- 二维码资源暂未提供或加载失败时，展示占位框和文案：`二维码待更新`。
- 弹窗打开时不刷新页面、不改变路由；公开二维码数据来自首屏 `/api/meta/` 或 `/api/sidebar-qrs/`。
- `state.sidebarQrModal.open` 必须纳入 `modalOpen`，确保 body 滚动锁定和全局弹窗状态一致。
- `Escape` 优先关闭确认弹窗；没有确认弹窗时再关闭二维码弹窗，避免误关关键确认。
- 管理端新增“系统入口” tab，展示两个二维码卡片、当前预览、文件选择器和上传/更新按钮。
- 上传成功后同步更新 `state.admin.sidebarQrs` 与 `state.meta.sidebar_qr_entries`，左侧弹窗无需刷新页面即可显示新图片。

响应式规则：

- 桌面端：沿用现有左侧 `.topbar`，不遮挡课题卡和弹窗。
- 窄屏端：随现有 `.topbar` 收缩，在主导航下方以内联双按钮行展示；不要使用底部 fixed 悬浮按钮，以免遮挡主要提交按钮、确认弹窗和课题标题。
- 小弹窗最大宽度建议不超过 `320px`，二维码区域保持正方形比例。
- 二维码图片使用 `alt` 文案，例如 `联系管理员二维码`、`加入社区二维码`。
- 管理端二维码卡片在桌面端两列展示，小屏切成单列，文件名过长时不撑破按钮或卡片。

层级要求：

- `.sidebar-qr-modal-backdrop` 建议使用 `z-index: 260`。
- `.sidebar-qr-modal` 建议使用 `z-index: 261`。
- 二维码弹窗应高于普通页面内容和更新日志弹窗，低于 `.project-form-modal` 的 `z-index: 300` 和 `.confirm-modal-backdrop` 的 `z-index: 900`。
- 如果打开新增/编辑、任务结果、JSON 导入预览等业务弹窗，应先关闭二维码弹窗，避免同级业务上下文堆叠。

### 8.4 测试要求

后端：

- `GET /api/sidebar-qrs/` 未登录可读取，返回两个固定 entry。
- 未上传图片时 `image=""`、`has_image=false`。
- 普通用户不能调用 `/api/admin/sidebar-qrs/{key}/image/` 上传。
- 管理员上传 PNG/JPG/WebP 成功，返回最新图片 URL，并在 `MEDIA_ROOT/system-qrcodes/` 写入文件。
- 重新上传同 key 不同扩展名图片会删除旧扩展名文件，只保留最新二维码。
- 上传成功后 `/api/meta/` 的 `sidebar_qr_entries` 同步展示 `has_image=true`。
- 非图片文件、伪装图片或超过大小限制的文件返回 422，未知 key 返回 404。
- 上传成功写入 `platform_qr.upload` 审计。

前端：

- `frontend/src/main.js` 存在两个固定入口：`联系管理员` 和 `加入社区`。
- `frontend/src/api.js` 暴露 `sidebarQrs` 和 `adminUploadSidebarQr`。
- 管理端存在“系统入口” tab，文案说明“管理员可上传或更新左侧边栏二维码”。
- 点击 `联系管理员` 会打开二维码弹窗，弹窗标题为 `联系管理员`。
- 点击 `加入社区` 会打开二维码弹窗，弹窗标题为 `加入社区`。
- 二维码图片加载失败时展示 `二维码待更新`。
- 管理端选择图片后可上传，上传中按钮禁用，成功后 toast 提示并刷新预览。
- 关闭按钮、遮罩或 `Escape` 能关闭弹窗。
- 点击两个公开入口不改变当前路由。
- 小屏布局中左侧入口或折叠入口不遮挡确认弹窗和主操作按钮。
- UI 测试需要断言二维码弹窗 `z-index` 低于确认弹窗、高于普通页面内容，并断言 `modalOpen` 包含 `state.sidebarQrModal.open`。
- UI 测试需要断言 `.sidebar-qr-admin-grid` 存在并在小屏单列展示。

回归：

- 登录、注册、强制改密页面仍可正常使用。
- 课题卡、状态卡、主题下拉、任务结果弹窗和管理员弹窗层级不被二维码弹窗破坏。
- 二维码弹窗层级低于确认/警告弹窗，避免挡住关键确认操作；若二维码弹窗打开后触发确认弹窗，确认弹窗必须在最上层。

### 8.5 验收标准

- 任意页面左侧都能看到 `联系管理员` 和 `加入社区` 两个入口。
- 点击 `联系管理员` 后出现小弹窗，展示管理员二维码或 `二维码待更新` 占位。
- 点击 `加入社区` 后出现小弹窗，展示社区二维码或 `二维码待更新` 占位。
- 弹窗可关闭，关闭后页面状态不丢失。
- 未提供二维码图片时，页面不报错、不显示破损图片。
- 普通用户和访客没有上传入口，也不能通过 API 上传二维码。
- 管理员进入“系统入口”，分别上传“联系管理员”和“加入社区”二维码后，公开侧边栏弹窗显示最新图片。
- 重新上传同 key 图片会替换旧图，页面刷新后仍显示最新图。
- 上传非图片文件或未知 key 时有明确错误反馈。
- 管理员上传成功后审计日志可查到 `platform_qr.upload`。

## 9. 文件修改清单

当前实现已修改：

| 文件 | 目的 |
| --- | --- |
| `projects/models.py` | 扩展 `team_status`，新增 `ProjectDocument.DocumentKind.PROGRESS`，新增 `ProjectProgressEntry`，新增 `ProjectDiscussion` |
| `projects/admin.py` | 管理后台注册或只读查看新增进度/讨论模型，便于排查数据 |
| `projects/migrations/*.py` | 数据库迁移 |
| `projects/management/commands/import_project_bundle.py` | 保持兼容导入；如后续要求 bundle 直接生成进度记录，再同步扩展 |
| `api/serializers.py` | 新增进度页 payload、讨论区 payload、二维码上传审计动作标签，扩展文档 payload、扩展 team_status |
| `api/ninja_api.py` | 新增主题排序 API、课题进度 API、进度文档上传规则、讨论区读写和 moderation API、二维码公开读取和管理员上传 API，并同步 `/api/meta/`、`/api/project-schema/`、内容备份导出恢复 |
| `frontend/src/api.js` | 新增 `adminReorderThemes`、`projectProgress`、`projectDiscussions`、`sidebarQrs`、`adminUploadSidebarQr` API 包装 |
| `frontend/src/main.js` | 新增主题快捷排序交互、课题进度页路由和页面、讨论区交互、侧边栏二维码入口、管理员二维码维护入口、超额显示，并修复 JSON 导入文件/目录选择入口 |
| `frontend/src/projectJsonImport.js` | 扩展 JSON/PDF 导入文件归一化，兼容 `webkitRelativePath`、自定义 `relativePath` 和 File System Access API 返回文件 |
| `frontend/src/styles.css` | 新增超额状态、主题排序控件、进度页、时间线、讨论区、侧边栏二维码弹窗和管理员二维码维护样式，并修复 JSON 导入隐藏 file input 的 Linux 兼容样式 |
| `MEDIA_ROOT/system-qrcodes/admin-contact.*` | 管理员上传后生成的联系管理员二维码媒体文件，不纳入 git |
| `MEDIA_ROOT/system-qrcodes/community.*` | 管理员上传后生成的加入社区二维码媒体文件，不纳入 git |
| `api/tests.py` | 后端 API 与权限测试 |
| `projects/tests.py` | team_status、文档、进度和讨论模型测试 |
| `frontend/src/api.test.js` | API 包装、统一 request、错误结构和新增方法导出测试 |
| `frontend/src/uiPlacement.test.js` | UI 结构和响应式静态测试 |
| `frontend/src/projectJsonImport.test.js` | JSON/PDF 导入文件选择、目录兜底、同名 PDF 匹配和 Linux 兼容回归测试 |
| `frontend/src/profileMenu.test.js` | 左侧栏新增入口后回归账号菜单与个人入口不被破坏 |
| `frontend/src/release.test.js` | 弹窗层级和版本更新入口回归，确保二维码弹窗不破坏发布信息弹窗 |
| `CHANGELOG.md` | 记录用户可见变化 |
| `AGENTS.md` | 同步新系统规则和入口 |

## 10. 版本与兼容性

当前版本：

- 本需求包含用户可见新功能、新 API 和新增数据模型，已将版本提升到 `0.9.0`。
- 二维码管理员维护能力在 `0.9.1` 中补充发布，作为已有侧边栏入口的可维护性增强。

兼容性：

- 旧 `team_status.required_roles[].ready` 保留。
- 旧主 PDF 字段 `detail_document` 保留。
- 旧 `GET /api/projects/{id}/` 保留。
- 新进度页使用新增 API，不破坏现有公开课题列表。
- 讨论区使用新增 API，不复用 `ProjectScore.comment`、`Contribution.review_comment` 或 `AuditLog`。
- 新增讨论模型不改变收藏、点赞、参与、认领、资助、任务结果等既有关系模型语义。
- 侧边栏二维码新增公开读取和管理员上传接口，不破坏原有入口；二维码图片缺失时以前端占位兜底。

## 11. 验收总清单

### 11.1 招募超额

- `0/1`、`1/1`、`2/1` 三种状态视觉不同。
- `2/1` 明确显示“超额”。
- 四类角色均支持超额显示。
- 首页课题卡和复用课题卡组件的视图显示一致；我的空间行式列表不强制新增组队徽章。

### 11.2 主题排序

- 管理员可不打开表单直接调整主题顺序。
- 未保存状态有提示。
- 保存后刷新页面顺序不丢失。
- 公开首页主题顺序同步变化。
- 排序写入审计。

### 11.3 课题进度页

- 课题标题进入独立进度页。
- 页面展示进度正文、文档列表和时间线。
- 多日期文档都能保留并按日期展示。
- 主 PDF 替换不会删除进度文档。
- 权限和隐私符合公开课题规则。

### 11.4 回归检查

- 登录、注册、强制改密不受影响。
- 收藏、点赞、参与、认领、资助不受影响。
- 任务结果提交后无需审批，不恢复旧 `ProjectTask` 审核主流程。
- 用户可在提交结果时上传一份 PDF/Markdown 文档，管理员任务管理详情可打开查看。
- 内容备份恢复只覆盖内容化的进度文档和 `stage/document/note` 进度记录；由任务结果派生的时间线不进入备份，且不覆盖用户账号、协作关系、任务结果和审计日志。
- 讨论区写入不改变课题阶段和用户关系状态。
- 讨论区只展示 UID，不展示用户名、邮箱、真实姓名。
- 侧边栏二维码入口公开查看不触发后端写操作，不影响任何业务状态；管理员上传二维码写入审计。
- 首页主题下拉只展示第一行之外的主题，不重复“不限主题”和首行快捷主题；展开后按钮文案为“收起全部主题”。

### 11.5 课题讨论区

- 公开课题进度页展示讨论区。
- 访客可读但不能写。
- 所有已登录用户都能在公开且未归档课题下发起主讨论和回复。
- 作者可编辑或删除自己的讨论。
- 管理员可隐藏、恢复或删除讨论。
- 归档课题不公开讨论区；公开入口和公开 API 都按不可见处理。
- 删除和隐藏内容不进入公开列表。
- 讨论写操作写入审计，失败返回稳定错误结构。

### 11.6 侧边栏二维码入口

- 左侧边栏展示 `联系管理员` 和 `加入社区`。
- 两个入口对访客、普通用户和管理员都可见。
- 点击入口打开对应小弹窗。
- 二维码缺失时展示 `二维码待更新`，页面不报错。
- 弹窗可通过关闭按钮、遮罩或 `Escape` 关闭。
- 小屏不遮挡顶部导航、主操作按钮和确认弹窗。
- 管理员可在“系统入口”上传或替换两个二维码。
- 普通用户和访客不能上传二维码。
- 二维码上传成功写入审计日志。

## 12. 建议执行顺序

1. 先实现招募超额显示，因为它只扩展现有 payload 和样式，风险最低。
2. 再实现主题快捷排序，因为已有 `sort_order` 字段，可小步交付。
3. 然后实现课题进度页，因为它涉及路由、API、文档保留策略和可能的新模型。
4. 最后实现课题讨论区，因为它引入用户生成内容、权限、moderation 和更多审计场景，适合在课题页稳定后接入。
5. 侧边栏二维码入口可以独立提前实现；它不依赖数据库迁移，但依赖公开读取和管理员上传 API，适合作为小范围 UI + 媒体文件能力交付。

每一步都应采用 TDD：先写失败测试，再实现最小代码，最后跑完整回归。

## 13. 已知缺陷：Linux 下 JSON 导入目录/文件选择失效

### 13.1 现象

管理员在“课题管理 > JSON 导入”中点击第二个入口 `导入课题目录` 或第三个入口 `选择 JSON/PDF 文件` 时，在部分 Linux 浏览器/桌面环境下无法按预期选择课题文件夹。截图中还出现了原生文件输入控件 `未选择任何文件` 漂浮到页面左上角的情况。

当前代码基准：

- 第二个入口使用 `<input type="file" webkitdirectory directory multiple>` 选择目录。
- 第三个入口使用普通 `<input type="file" multiple>` 选择文件，文案是 `Linux 文件夹选择不可用时，直接框选目录内文件`。
- `.json-import-picker input` 通过 `position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0;` 覆盖整张导入卡片。
- `summarizeProjectImportFiles()` 和 `projectImportFileKey()` 已经支持根据文件名或 `webkitRelativePath` 匹配同名 `.json` 与 `.pdf`，所以后端和解析逻辑不要求真正传入文件夹对象。

### 13.2 根因判断

根因不是后端导入 API，而是前端文件选择入口的浏览器兼容性和交互语义：

1. `webkitdirectory` 是非标准目录上传属性，不同 Linux 浏览器、文件管理器和打包方式支持不一致；`directory` 属性也不能作为跨浏览器保证。
2. 第三个入口本质是多文件选择，不具备“选择文件夹”的能力。如果用户期待它继续选文件夹，会表现为“无法选择文件夹”。
3. 透明铺满卡片的原生 file input 在 Linux/GTK 文件控件下可能泄漏原生控件文本或产生错位点击区域，截图里的 `未选择任何文件` 漂浮就是这个风险的表现。

### 13.3 修复方案

把 JSON 导入入口改为“目录选择渐进增强 + 多文件兜底”的明确模型：

1. 不再把 `<input type="file">` 透明铺满整个导入卡片。改为按钮触发隐藏 input，隐藏 input 使用统一的视觉隐藏样式，例如 `.visually-hidden-file-input`，避免原生控件文本在 Linux 下露出。
2. 第二个入口 `导入课题目录` 优先使用 `window.showDirectoryPicker`（如果浏览器支持），递归读取目录内 `.json` 和 `.pdf`；不支持时再检测并降级触发 `webkitdirectory` input；两者都不可用时给出明确 toast，并自动切到多文件兜底入口。
3. 第三个入口文案改为 `选择目录内 JSON/PDF 文件`，说明改为 `Linux 文件夹选择不可用时，打开目录后框选 .json 与同名 .pdf 文件`，明确它是多文件兜底而不是文件夹选择。
4. 增加文件归一化层，例如 `normalizeProjectImportFiles(files)`，统一输出 `{ file, name, relativePath, text }`：
   - 普通 file input 使用 `file.webkitRelativePath || file.name`。
   - `showDirectoryPicker` 返回的文件使用递归路径写入 `relativePath`。
   - 上传 PDF 时通过统一解包函数取回原始 `File`/`Blob` 放入 `FormData`。
5. `projectImportFileKey()` 和 `fileName()` 优先读取 `relativePath`，其次读取 `webkitRelativePath`，最后读取 `name`，确保目录选择和多文件选择都能匹配同名 PDF。
6. 如果目录选择弹窗没有返回文件，不清空已有可导入结果；只提示“未选择文件或当前浏览器不支持目录选择，请使用选择目录内 JSON/PDF 文件”。

建议前端结构：

```html
<button type="button" class="file-picker json-import-picker" @click="chooseJsonImportJsonFiles">
  <span>导入单个课题 JSON</span>
  <small>可选择一个或多个 .json 文件</small>
</button>
<button type="button" class="file-picker json-import-picker" @click="chooseJsonImportDirectory">
  <span>导入课题目录</span>
  <small>自动匹配同名 .json 与 .pdf</small>
</button>
<button type="button" class="file-picker json-import-picker" @click="chooseJsonImportMixedFiles">
  <span>选择目录内 JSON/PDF 文件</span>
  <small>Linux 文件夹选择不可用时，打开目录后框选 .json 与同名 .pdf 文件</small>
</button>
<input ref="jsonImportJsonFilesInput" class="visually-hidden-file-input" type="file" accept=".json,application/json" multiple @change="handleJsonFiles" />
<input ref="jsonImportMixedFilesInput" class="visually-hidden-file-input" type="file" accept=".json,application/json,.pdf,application/pdf" multiple @change="handleJsonFiles" />
<input ref="jsonImportDirectoryInput" class="visually-hidden-file-input" type="file" accept=".json,application/json,.pdf,application/pdf" webkitdirectory multiple @change="handleJsonFiles" />
```

### 13.4 测试要求

前端静态测试：

- `frontend/src/uiPlacement.test.js` 不再断言 `webkitdirectory directory multiple` 是唯一目录入口；改为断言存在 `chooseJsonImportDirectory`、`chooseJsonImportMixedFiles`、`showDirectoryPicker`、目录 input 能力检测、兜底提示和 `visually-hidden-file-input`。
- 断言 JSON 导入区域不再使用 `.json-import-picker input { inset: 0; opacity: 0; }` 这种透明铺满卡片的隐藏策略。
- 断言第三个入口文案为 `选择目录内 JSON/PDF 文件`，不再暗示它可以直接选择文件夹。

导入逻辑测试：

- `frontend/src/projectJsonImport.test.js` 增加 `relativePath` 文件对象测试，确认 JSON 与同名 PDF 能在没有 `webkitRelativePath` 时通过归一化路径或文件名匹配。
- 增加 `showDirectoryPicker` 风格文件对象测试，确认递归目录读取后的 `{ file, relativePath }` 能解析 JSON，并能在上传时取回原始 PDF `File`。
- 保留现有真实目录模拟测试，确认 `webkitRelativePath` 路径仍兼容。

浏览器验收：

- Linux Chrome/Chromium：点击 `导入课题目录` 能选择目录；若环境禁止目录选择，应出现明确 toast，并可用 `选择目录内 JSON/PDF 文件` 继续导入。
- Linux Firefox 或不支持目录 API 的浏览器：目录按钮会给出清晰降级提示，并可切到多文件入口通过框选 `.json` 和同名 `.pdf` 完成导入。
- macOS/Windows：原有目录导入不回退；多文件兜底仍可用。
- JSON 导入卡片左上角不再出现原生 `未选择任何文件` 控件文本。
