# 课题与数据集 PDF 文档功能实施方案

日期：2026-06-14

## 1. 需求摘要

本轮需求聚焦“用 PDF 作为课题和数据集的自由说明文档”，不再要求用户按预设 Markdown/JSON 格式整理内容。

目标：

1. 每个课题可以上传一个课题详情 PDF，首页课题卡可以直接打开该 PDF 查看课题细节。
2. 一个课题仍可以有多份补充说明文档，在课题详情页集中展示。
3. 普通用户可以管理自己上传课题的 PDF/补充文档；管理员可以管理全站课题文档。
4. 每个数据集可以上传一个 PDF，介绍该数据集特点。
5. 之前偏目录浏览的“文件空间”管理可以简化，不再作为管理员维护数据集说明的主流程。
6. 先输出实施方案，经过 agent 审阅后再进入代码实现。

## 2. 已核对的现有依据

已阅读：

- `AGENTS.md`
- `docs/project-library-ux-improvement-plan.md`
- `docs/project-lifecycle-implementation-task-plan.md`
- `docs/project-task-workspace-management-plan.md`
- `docs/user-admin-workspace-execution-and-acceptance.md`
- `projects/models.py`
- `api/ninja_api.py`
- `api/serializers.py`
- `frontend/src/api.js`
- `frontend/src/main.js`
- `frontend/src/uiPlacement.test.js`
- `api/tests.py`

当前代码事实：

| 能力 | 当前状态 | 本轮结论 |
| --- | --- | --- |
| 课题文档模型 | `ProjectDocument` 已支持 `markdown/pdf/html/other`，一个课题多文档 | 直接复用，不新增课题文档模型 |
| 管理端课题文档上传 | `POST /api/admin/project-documents/upload/` 已存在，要求 `description` | 保留兼容并抽取共用保存 helper |
| 普通用户课题管理 | 普通用户可创建/编辑/删除自己上传的课题 | 补 owner-scoped 文档上传/删除能力 |
| 公开课题详情 | `GET /api/projects/{id}/` 已返回安全过滤后的 `documents` | 详情页继续展示多文档 |
| 公开课题列表 | `GET /api/projects/` 当前不返回文档信息 | 补一个轻量的主 PDF 摘要字段 |
| 主题/数据集文件模型 | `ThemeFile` 表示主题级数据资产文件，包含 `file_type=dataset/dataset_meta` | 作为“数据集”载体复用 |
| 文件空间上传 | `/api/admin/file-space/upload/` 可上传文件并自动生成 `ThemeFile` | 保留兼容，但不作为主入口 |
| 数据集说明 PDF | 当前没有“某个数据集对应一个说明 PDF”的稳定关系 | 在 `ThemeFile` 上补自关联关系 |

## 3. 方案取舍

### 3.1 课题 PDF：复用 `ProjectDocument`

推荐方案：不改 `ProjectDocument` 表结构。

理由：

- `ProjectDocument` 已能保存多份文档，且支持 PDF 类型。
- 公开详情已经通过 `public_document_payload()` 过滤危险路径，不暴露本机路径和 hash。
- 管理端已有上传、删除和审计逻辑，可以抽成 admin/user 共用 helper。
- JSON/课题导入已支持同名 PDF 绑定，继续保留即可。

实现口径：

- 课题详情 PDF 只是 `ProjectDocument.doc_type = "pdf"` 的文档。
- 一个课题可以有多份文档，详情页全部展示。
- 首页课题卡只展示一个“查看 PDF”主入口：
  - 如果存在安全 PDF 文档，取按 `created_at, id` 排序后的第一份 PDF。
  - 如果没有安全 PDF，但有其他文档，首页不展示主 PDF 按钮，详情页仍展示补充文档。
- 不新增 `publishProjectPdf`、`projectPdf` 等平行 API。

备选方案：给 `ProjectDocument` 增加 `document_role=primary/supplement`。

- 优点：能显式区分主 PDF 和补充文档。
- 缺点：需要迁移、前后端表单改动更多；当前需求只要求能打开 PDF，不要求管理员选择主文档。
- 结论：暂不采用。后续如果多个 PDF 需要排序或主次关系，再单独设计。

### 3.2 数据集说明 PDF：复用 `ThemeFile`，补自关联关系

推荐方案：把“数据集”定义为 `ThemeFile.file_type = "dataset"` 的主题文件记录。数据集说明 PDF 仍然是一条 `ThemeFile` 记录，但通过自关联字段挂到对应数据集上。

新增字段建议：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `detail_of` | `ForeignKey("self", null=True, blank=True, related_name="detail_documents", on_delete=models.CASCADE)` | 当前文件是哪个数据集的说明文档 |
| `content_hash` | `CharField(max_length=64, blank=True)` | 受管上传文件 hash，仅管理端和审计使用 |

约束：

- 一个数据集最多一个 active 主说明 PDF。
- `detail_of` 不为空的记录必须使用 `file_type="dataset_meta"`。
- 公开主题空间默认不把 `detail_of` 不为空的说明 PDF 当作独立数据集文件重复展示，而是嵌套到对应数据集的 `detail_pdf` 字段里。

理由：

- 当前系统没有独立 `Dataset` 模型，新增 Dataset 会扩大发散面。
- `ThemeFile` 已经是主题文件域资产记录，前端和公开主题空间都围绕它展示。
- 说明 PDF 本质仍是主题文件，复用 `ThemeFile.title/description/path/file_type/is_active` 比复制 `detail_pdf_*` 字段更自然。
- 新增自关联后，公开页能稳定知道“哪个 PDF 说明属于哪个数据集”。
- 保留 `ThemeFile.FileType.DATASET_META` 作为说明文档类型，但新的主流程不要求管理员手工登记和匹配。

备选方案 A：为说明 PDF 新建一条 `ThemeFile(file_type=dataset_meta)`，通过标题或栏目匹配数据集。

- 优点：不需要迁移。
- 缺点：没有可靠关联，公开页无法知道某个 PDF 说明属于哪个数据集。
- 结论：不采用。

备选方案 B：在 `ThemeFile` 上增加 `detail_pdf_title/detail_pdf_path/detail_pdf_content_hash/detail_pdf_uploaded_at` 四个字段。

- 优点：读取简单。
- 缺点：复制了一套小文档模型，未来如果数据集说明从一个 PDF 变成多份材料会很快失控。
- 结论：不采用。

备选方案 C：新增 `Dataset` 和 `DatasetDocument` 模型。

- 优点：长期最清晰。
- 缺点：当前系统所有主题文件空间、管理 UI、公开展示都基于 `ThemeFile`，改动过大。
- 结论：本轮不采用。

## 4. 后端设计

### 4.1 公开课题列表增加主 PDF 摘要

修改文件：

- `api/serializers.py`
- `api/ninja_api.py`
- `api/tests.py`

设计：

1. 新增 helper，例如 `public_project_primary_pdf_payload(project)`。
2. 不直接把文档逻辑无条件塞进通用 `project_summary_payload()`，因为该函数被 dashboard、interaction、contribution、theme space 等多处复用，容易引入 N+1。
3. 新增公开列表专用 serializer，例如 `public_project_summary_payload(project, include_primary_pdf=True)`，在 `project_list()` 中使用。
4. `GET /api/projects/` 的结果增加：

```json
{
  "primary_pdf_document": {
    "id": 12,
    "doc_type": "pdf",
    "title": "项目详细说明",
    "description": "完整课题方案 PDF",
    "path": "/media/project-documents/T0001/detail.pdf"
  },
  "public_document_count": 3
}
```

5. `project_list()` 查询增加 `.prefetch_related("tags", "documents")`，避免序列化时 N+1。
6. 只返回 `public_document_path()` 认为安全的文档路径。
7. 如果没有安全 PDF，`primary_pdf_document` 返回 `null`。
8. `public_document_count` 只统计公开安全文档，不统计被过滤的绝对路径、穿越路径或空路径文档。
9. 主 PDF 选择规则固定为：安全 PDF 文档按 `created_at, id` 排序后的第一份。

验收：

- 公开课题列表中有 PDF 的课题返回 `primary_pdf_document`。
- 本机绝对路径、穿越路径、空路径不会出现在公开列表。
- `public_document_count` 不泄漏危险文档数量。
- 公开详情仍返回完整安全文档列表。

### 4.2 课题文档上传能力收敛

修改文件：

- `api/ninja_api.py`
- `api/tests.py`
- `frontend/src/main.js`
- `frontend/src/api.js`
- `frontend/src/uiPlacement.test.js`

后端接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/admin/project-documents/upload/` | 管理员上传课题文档，保留兼容 |
| `DELETE` | `/api/admin/project-documents/{document_id}/` | 管理员删除课题文档，保留兼容 |
| `POST` | `/api/projects/{project_id}/documents/upload/` | 课题 owner 或管理员上传课题文档 |
| `DELETE` | `/api/projects/{project_id}/documents/{document_id}/` | 课题 owner 或管理员删除课题文档 |

权限规则：

- 管理员可管理任意课题文档。
- 普通用户只能管理自己上传课题的文档。
- 普通用户只能在 `draft`、`open_recruiting` 阶段上传/删除文档；课题进入 `team_building/active/paused/archived` 后由管理员维护。
- 权限校验复用 `require_project_owner_or_admin()`，并补普通用户阶段锁定错误。

共用 helper：

- 抽取上传保存 helper，供 admin/user 两条入口复用。
- 抽取删除 helper，确保数据库记录和受管文件清理一致。
- 上传/删除都写审计。
- 失败审计记录 `error_code`、`error_message` 和 request_id。

前端设计：

- 管理员课题表单中的“课题详细文档”改名为“课题 PDF 与补充文档”。
- 用户“我上传”编辑弹窗也显示“课题 PDF 与补充文档”。
- 默认文档类型设为 `pdf`。
- 文件选择框增加 `accept=".pdf,.md,.markdown,.html,.htm"`。
- PDF 上传文案改为“上传课题 PDF / 补充文档”。
- 保留现有 `description` 必填规则，避免用户上传一堆无法理解的文件。
- 上传成功后刷新当前表单文档列表，并刷新公开课题列表中的主 PDF 状态。

不改动：

- 不把文档字段加入 `/api/project-schema/`，避免破坏当前 JSON 课题模板边界。

### 4.3 数据集 PDF 关系、上传和删除

修改文件：

- `projects/models.py`
- `projects/migrations/`
- `api/serializers.py`
- `api/ninja_api.py`
- `api/tests.py`
- `frontend/src/api.js`
- `frontend/src/main.js`
- `frontend/src/uiPlacement.test.js`

新增后端接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/admin/theme-files/{file_id}/detail-pdf/` | 上传或替换某个数据集说明 PDF |
| `DELETE` | `/api/admin/theme-files/{file_id}/detail-pdf/` | 删除某个数据集说明 PDF |

权限：

- 复用 `manage_themes`。
- 只允许给 `is_active=True` 且 `file_type="dataset"` 的 `ThemeFile` 上传说明 PDF。
- 如果未来要给其他类型文件上传说明文档，需要另开需求，不在本轮混用。

保存位置：

- `MEDIA_ROOT/theme-file-documents/<theme.slug>/<theme_file_id>/<sanitized-name>.pdf`

校验：

- 只接受单个文件。
- 文件名必须以 `.pdf` 结尾。
- `content_type` 优先接受 `application/pdf`，但不只依赖浏览器上报。
- 文件头必须符合 PDF 基本特征，例如前几个字节以 `%PDF` 开始。
- 增加大小上限，建议默认 30MB，可用常量 `MAX_DOCUMENT_UPLOAD_BYTES = 30 * 1024 * 1024`。
- 写入时沿用 hash 计算。
- 路径必须限制在 `MEDIA_ROOT/theme-file-documents/` 下。
- 替换 PDF 时删除旧受管文件，前提是旧文件确实位于受管目录下。
- DB 保存失败时清理刚写入的文件。
- 上传、替换、删除使用 `transaction.atomic()` 或明确补偿清理，不能留下孤儿记录或孤儿文件。

审计：

- 上传或替换：`theme_file.detail_pdf.upload`
- 删除：`theme_file.detail_pdf.delete`
- 成功审计记录 `theme_file_id`、`detail_file_id`、`path`、`content_hash`。
- 失败审计记录 `error_code`、`error_message` 和 request_id，不记录 PDF 内容。
- `api/serializers.py` 的 `audit_action_label()` 需要增加这两个 action 的中文展示。

序列化：

新增公开/管理两套主题文件 payload：

- `admin_theme_file_payload(file)`：可包含 `content_hash`。
- `public_theme_file_payload(file)`：不返回 hash，只返回公开安全路径。

公开 `detail_pdf` 示例：

```json
{
  "detail_pdf": {
    "id": 34,
    "title": "随访样例数据说明",
    "path": "/media/theme-file-documents/antivegf/12/detail.pdf",
    "uploaded_at": "2026-06-14T12:00:00+08:00"
  }
}
```

公开返回：

- `GET /api/themes/{slug}/space/` 继续返回 `sections[].files[]`，每个数据集文件中带 `detail_pdf`。
- 如果没有 PDF，`detail_pdf` 为 `null`。
- `detail_of` 不为空的说明 PDF 不单独出现在主题空间文件列表中，避免重复展示。

公开路径过滤：

- 新增 `public_theme_file_path(path)`，过滤绝对本机路径、`..`、Windows 盘符和空路径。
- 公开主题空间不能直接使用 raw `ThemeFile.path`。
- 安全路径允许：
  - `/media/...`
  - `media/...`
  - `https://...`
  - `http://...`
- 不安全路径在公开 payload 中返回空字符串；前端不渲染打开链接。

### 4.4 文件空间简化策略

现有文件空间 API 和后台能力先保留兼容，不物理删除。

前端主流程调整：

- 管理员“主题与文件域”页主区域改为“数据集与说明文档”。
- 直接展示当前主题的 `ThemeFile(file_type=dataset, detail_of__isnull=True)` 列表。
- 对每个数据集条目提供：
  - 编辑基础信息。
  - 上传/替换说明 PDF。
  - 打开说明 PDF。
  - 删除说明 PDF。
  - 停用文件记录。
- 原“文件空间管理”目录浏览器降级为 `<details>` 中的“高级文件空间（兼容）”，默认折叠。
- 前端打开主题文件时使用 `fileHref(file)`，只读取后端 public payload 中的安全 `path`，不直接拼 raw path。

理由：

- 满足“之前的文件夹那块可以简化”。
- 不破坏已有路径安全逻辑、导入兼容逻辑和测试基础。
- 后续如果完全移除目录浏览器，可以在新版本里单独处理并删除 API/测试。

## 5. 前端公开展示设计

### 5.1 首页课题卡

修改文件：

- `frontend/src/main.js`
- `frontend/src/styles.css`
- `frontend/src/uiPlacement.test.js`

展示规则：

- 如果 `project.primary_pdf_document` 存在，在课题卡操作区增加“查看 PDF”链接。
- 链接使用 PDF 图标或现有 `material-symbols-rounded` 的 `picture_as_pdf`。
- 用 `<a>` 样式化为按钮，`@click.stop`，`target="_blank"` 打开 PDF，不触发课题卡展开或详情跳转。
- 无 PDF 时不显示按钮，避免空按钮噪音。

### 5.2 课题详情页

当前已有“课题详细文档”区，保留并调整文案：

- 标题改为“课题 PDF 与补充文档”。
- PDF 文档优先显示在前。
- 排序规则为：PDF 在前；同类型内按 `created_at, id`。
- 每个文档显示类型、标题、说明，点击新窗口打开。
- 保持空状态文案清楚。

### 5.3 主题/数据集文件空间公开页

调整文案：

- `文件空间` 可以改成 `数据集与说明文档`。
- 数据集文件卡片优先展示：
  - 数据集标题。
  - 文件类型。
  - 说明。
  - 原文件链接。
  - 说明 PDF 链接。
- 如果 `detail_pdf` 存在，显示“查看数据集说明 PDF”。
- 如果没有 `detail_pdf`，不显示 PDF 按钮。

## 6. 实施任务拆分

### 任务 1：后端课题列表暴露主 PDF

1. 在 `api/tests.py` 写测试：公开列表返回安全 `primary_pdf_document`，不返回危险路径。
2. 修改 `api/serializers.py`，增加公开列表专用 summary helper、主 PDF helper 和 `public_document_count`。
3. 修改 `api/ninja_api.py` 的 `project_list()`，预取 `documents`。
4. 跑 `conda run -n openmedailab python manage.py test api`。

### 任务 2：前端首页 PDF 入口

1. 在 `frontend/src/uiPlacement.test.js` 增加断言：课题卡有 PDF 文档链接，点击不影响卡片其他操作。
2. 修改 `frontend/src/main.js`，新增 `primaryProjectPdf(project)` helper 并渲染链接。
3. 修改 `frontend/src/styles.css`，补按钮尺寸和移动端换行。
4. 跑 `node --test frontend/src/uiPlacement.test.js` 和 `node --check frontend/src/main.js`。

### 任务 3：课题文档 owner-scoped 上传

1. 在 `api/tests.py` 写测试：
   - 课题 owner 可以给自己的草稿/开放招募课题上传 PDF。
   - 普通用户不能给他人课题上传 PDF。
   - 普通用户不能给已进入管理员维护阶段的课题上传 PDF。
   - 管理员仍可上传和删除任意课题文档。
   - 上传和删除都写审计。
2. 抽取 `save_project_documents_for_upload()`、`delete_project_document()` 等 helper，避免 admin/user 两套保存逻辑分叉。
3. 新增 owner-scoped 上传/删除 API。
4. 跑 `conda run -n openmedailab python manage.py test api`。

### 任务 4：数据集说明 PDF 数据模型与 API

1. 在 `api/tests.py` 写测试：
   - 管理员可给 `ThemeFile(file_type=dataset)` 上传 PDF。
   - 非 PDF 被拒绝。
   - 伪 PDF 被拒绝。
   - 超大 PDF 被拒绝。
   - 非 dataset 文件被拒绝。
   - 已停用 dataset 文件被拒绝。
   - 公共主题空间返回 `detail_pdf`。
   - 删除说明 PDF 后文件和说明记录都清空。
   - 普通用户不能调用管理接口。
   - 公开主题空间不泄露 `content_hash`、本机绝对路径、穿越路径或 Windows 盘符。
   - 上传/删除成功和失败路径都有审计。
2. 修改 `projects/models.py` 增加 `detail_of`、`content_hash` 和条件唯一约束。
3. 生成并检查 migration。
4. 修改 `api/serializers.py` 输出 admin/public 两套主题文件 payload 和 `detail_pdf`。
5. 修改 `api/ninja_api.py` 增加上传/删除接口和受管文件 helper。
6. 跑 `conda run -n openmedailab python manage.py test api`。

### 任务 5：管理端数据集 PDF UI

1. 在 `frontend/src/api.js` 增加：
   - `adminUploadThemeFileDetailPdf(id, formData)`
   - `adminDeleteThemeFileDetailPdf(id)`
2. 在 `frontend/src/main.js` 为数据集说明 PDF 增加上传状态。
3. 管理员主题页显示数据集列表和说明 PDF 操作。
4. 把目录浏览器移动到默认折叠的“高级文件空间（兼容）”区域。
5. 更新 `frontend/src/uiPlacement.test.js`，不再把目录浏览器作为唯一主入口，新增“数据集说明 PDF”断言。

### 任务 6：公开主题空间展示数据集说明 PDF

1. 修改 `frontend/src/main.js` 的主题文件展示区。
2. 文件卡片有 `detail_pdf` 时展示 PDF 链接。
3. 详情页中的主题文件区同步展示数据集说明 PDF。
4. 补 UI 测试断言。

### 任务 7：管理端和用户侧课题文档上传文案收敛

1. 修改 `frontend/src/main.js` 中课题文档管理文案。
2. 默认 `emptyProjectDocumentUpload().doc_type = "pdf"`。
3. 文件选择增加 `accept`。
4. 管理端和用户“我上传”编辑弹窗都显示“课题 PDF 与补充文档”区域。
5. 上传成功后刷新当前课题详情和课题列表中的 PDF 状态。

### 任务 8：版本、文档和验收

本轮是用户可见功能，实施时需要：

1. `VERSION` 升到 `0.8.0`。
2. `CHANGELOG.md` 增加 Added/Changed。
3. `frontend/package.json` 的 `version` 同步到 `0.8.0`。
4. `AGENTS.md` 同步更新顶部当前版本行，以及 2.2、2.3、2.7、4.2、4.3、4.6、5.2、6.2、6.3、9.3 中与课题文档/数据集 PDF 相关的规则。
5. 跑完整验收：
   - `conda run -n openmedailab python manage.py check`
   - `conda run -n openmedailab python manage.py test`
   - `node --test frontend/src/*.test.js`
   - `node --check frontend/src/main.js`
   - `git diff --check`

## 7. 风险与处理

| 风险 | 处理 |
| --- | --- |
| 首页列表为每个课题序列化文档导致 N+1 | `project_list()` 预取 `documents`，只输出一个主 PDF 摘要 |
| 通用 `project_summary_payload()` 被多处复用 | 新增公开列表专用 summary，不让 dashboard 等路径隐式查 documents |
| 多个 PDF 时主按钮打开哪一个不明确 | 本轮按 `created_at, id` 取第一份安全 PDF；详情页展示全部文档 |
| 普通用户上传 PDF 的权限边界不清 | owner 只能管理自己仍处于草稿/开放招募阶段的课题文档，管理员不受该限制 |
| 数据集不是独立模型 | 明确把当前 `ThemeFile(file_type=dataset)` 作为数据集记录载体，不新增 Dataset 模型 |
| 目录文件空间仍有历史 UI 和测试 | 先折叠为兼容高级入口，不删除后端 API |
| PDF 上传可能包含敏感内容 | 上传者负责内容审核；系统做路径安全、类型校验、大小限制和不记录文件内容 |
| 公开路径泄漏本机路径 | 课题文档继续沿用 `public_document_path()`；主题文件新增 `public_theme_file_path()` |
| 公开 payload 泄露 hash | 公开 payload 不返回 `content_hash`，hash 只保留在管理端 payload 和审计 |

## 8. Agent 审阅处理记录

已由独立 agent 审阅初稿，并按审阅意见修订：

- 公开 `detail_pdf` 不返回 `content_hash`。
- 增加 `public_theme_file_path()`，修复公开主题空间直接暴露 raw `ThemeFile.path` 的既有风险。
- 避免无条件修改通用 `project_summary_payload()`，改为公开列表专用 summary。
- 明确普通用户可管理自己课题的文档，但受 ownership 和阶段锁定限制。
- 数据集说明 PDF 从 `detail_pdf_*` 字段方案改为 `ThemeFile.detail_of` 自关联方案。
- 补充事务、失败审计、PDF magic bytes、大小限制、非 dataset/停用记录拒绝等测试要求。
- 补充 `frontend/package.json` 版本同步要求。
- 明确 PDF 入口使用 `<a>` 样式化为按钮，避免按钮内打开新窗口语义不清。

## 9. 设计结论

推荐按“最小模型扩展 + 复用现有文档链路”的方式实现：

- 课题文档继续使用 `ProjectDocument`，公开列表只新增安全主 PDF 摘要，普通用户可管理自己课题的文档。
- 数据集继续使用 `ThemeFile(file_type=dataset)`，说明 PDF 使用 `ThemeFile(detail_of=dataset)` 自关联表达。
- 文件空间目录浏览保留兼容但折叠，新的主流程是表格化的数据集与说明 PDF 管理。
- 不引入预设 PDF 格式、不要求 Markdown 模板、不新增独立 Dataset 模型。
