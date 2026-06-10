# 课题生命周期初期重建设计文档

生成日期：2026-06-09

适用仓库：`openmedailab-platform`

## 1. 目标

本次重建先固定课题生命周期的初期：课题只允许管理员创建、编辑、导入和归档。普通用户只能浏览公开课题、收藏、评分、申请参与、认领、资助和在用户空间跟踪自己的状态。

课题创建固定为两种方式：

1. 管理员在系统内按模板字段填写，创建或修改课题。
2. 管理员读取 Markdown 文件或文件夹下的多个 Markdown 文件，按固定模板解析后创建或更新课题。

本次设计优先复用现有模型和 API。只有现有接口无法表达必要流程时才新增接口；能用前端 File API 读取本地 Markdown 并调用现有课题创建接口完成的，不额外增加上传接口。

## 2. 当前系统事实

### 2.1 后端模型

当前课题核心数据已经存储在数据库中：

| 模型 | 文件 | 当前用途 |
| --- | --- | --- |
| `Project` | `projects/models.py` | 课题主表，保存标题、摘要、结构化字段、阶段、主题、评分、Markdown 正文和来源路径 |
| `Theme` | `projects/models.py` | 主题，含主题文件域策略 |
| `ProjectDocument` | `projects/models.py` | 单个课题的 Markdown、PDF、HTML 等原始文档索引 |
| `ThemeFile` | `projects/models.py` | 主题级数据资产、数据字典、标注规范、伦理材料和模型实验资产 |
| `ProjectTask` | `projects/models.py` | 课题后续任务拆分，不属于本次“初期创建”主改造 |
| `AuditLog` | `projects/models.py` | 管理员创建、更新、导入、归档等操作审计 |

`ProjectStage` 当前阶段值为：

| 值 | 展示 |
| --- | --- |
| `draft` | 草稿 |
| `open_recruiting` | 开放招募 |
| `team_building` | 组队中 |
| `active` | 进行中 |
| `experimenting` | 实验中 |
| `writing` | 写作中 |
| `submitted` | 投稿中 |
| `published` | 已发表 |
| `paused` | 暂停 |
| `archived` | 归档 |

### 2.2 后端 API

当前可直接复用的 API：

| 能力 | API | 设计结论 |
| --- | --- | --- |
| 字段契约 | `GET /api/project-schema/` | 继续复用，用于表单、模板和示例展示 |
| 管理员课题列表 | `GET /api/admin/projects/` | 继续复用 |
| 管理员课题详情 | `GET /api/admin/projects/{project_id}/` | 继续复用 |
| 管理员创建课题 | `POST /api/admin/projects/` | 继续复用，Markdown 解析结果也调用它 |
| 管理员更新课题 | `PATCH /api/admin/projects/{project_id}/` | 继续复用 |
| 管理员归档课题 | `DELETE /api/admin/projects/{project_id}/` | 继续复用，逻辑是归档停用，不物理删除 |
| 主题管理 | `/api/admin/themes/` | 继续复用，新增主题需管理员确认后创建 |
| 主题文件域管理 | `/api/admin/theme-files/` | 继续复用，入口并入课题管理工作区 |
| 用户课题列表 | `GET /api/projects/` | 继续复用，只展示 `is_public=True` 的课题 |
| 用户课题详情 | `GET /api/projects/{project_id}/` | 继续复用 |
| 主题文件空间 | `GET /api/themes/{slug}/space/` | 继续复用 |

当前无需新增 API 的部分：

- 读取本地 Markdown 文件或文件夹：由浏览器 File API 完成。
- Markdown 解析：前端解析为现有 `ProjectWriteRequest` 结构后，调用现有 `POST /api/admin/projects/` 或 `PATCH /api/admin/projects/{id}/`。
- 模板复制：前端复制固定 Markdown 模板，不需要后端接口。

后续如需命令行批量导入 Markdown、服务端读取服务器目录或上传附件，再新增后端 Markdown 导入服务；本轮先不做。

创建和更新语义必须收紧：

- `POST /api/admin/projects/` 只负责创建新课题。若 `topic_id` 已存在，返回 422，不再执行 upsert。
- `PATCH /api/admin/projects/{project_id}/` 只负责更新当前 `project_id` 对应课题。`topic_id` 作为课题稳定身份不允许在普通编辑流程中修改；如果 payload 中传入不同 `topic_id`，返回 422。
- Markdown 导入预览中如果发现 `topic_id` 已存在，应先通过管理员课题列表定位已有课题 `id`，再调用 `PATCH /api/admin/projects/{project_id}/` 更新当前课题。
- 内部命令行导入可以继续使用 `upsert_project()`，但网页端管理员创建/编辑不能再依赖 upsert 语义。

### 2.3 权限

当前 `api/rbac.py` 已经满足管理员独占管理权限：

| capability | 普通用户 | 管理员 |
| --- | --- | --- |
| `manage_projects` | false | true |
| `manage_themes` | false | true |
| `view_admin_console` | false | true |

本次不增加普通用户创建课题权限。所有创建、更新、导入和归档动作必须经过管理员 API。

说明：当前代码中仍有 `import_projects` capability 和 `/api/admin/projects/import-json/`，但它们只服务旧的网页端 JSON 导入功能。本次设计要求移除网页端 JSON 导入，不再把 `import_projects` 作为课题生命周期初期的产品能力。

## 3. 当前页面使用方式

### 3.1 管理员侧现状

当前 `#/admin` 下的内容管理相关窗口分散为：

| 当前 tab | 当前用途 | 本次处理 |
| --- | --- | --- |
| 课题管理 | 展示课题列表，右侧新增/编辑课题表单 | 保留并升级为课题生命周期入口 |
| 主题与文件域 | 管理主题、主题文件域和主题文件 | 并入课题管理内的“主题与文件域”子区 |
| JSON 导入 | 粘贴 JSON，调用 `/api/admin/projects/import-json/` | 移除产品入口，不再作为管理员工作流 |
| 字段契约 | 展示 `GET /api/project-schema/` 返回字段 | 并入课题管理内，作为“字段契约/Markdown 模板”辅助区 |

管理员其他 tab 如协作管理、任务管理、贡献审核、用户管理、积分流水、审计日志继续保留，不纳入本次初期课题创建主改造。

### 3.2 用户侧现状

当前用户侧已经从数据库读取公开课题：

| 页面 | 当前用途 | 本次适配 |
| --- | --- | --- |
| 课题库 | 展示公开课题，支持搜索、主题、阶段、排序、收藏和状态卡 | 新增/导入课题后刷新列表可见；缺失字段显示“待补充” |
| 课题详情 | 展示结构化字段、主题文件域、课题原始文档和参与操作 | 对 Markdown 模板解析出的字段进行一致展示 |
| 文件空间 | 按主题展示主题文件域和关联课题 | 新主题确认创建后自动出现在主题筛选和文件空间 |
| 我的空间 | 展示收藏、申请、任务、贡献和积分 | 不允许创建课题，仅展示用户与课题的关系状态 |

## 4. 新管理员课题管理工作区

### 4.1 顶层布局

管理员进入 `#/admin` 后，内容管理区应保留一个主入口：`课题管理`。

`课题管理` 内部使用子区或分段布局：

1. 课题列表
2. 新增/编辑课题
3. Markdown 导入
4. 主题与文件域
5. 字段契约与 Markdown 模板

`JSON 导入` 不再作为管理员顶层 tab 或子区出现。`字段契约` 不再作为顶层 tab，而是作为课题管理里的辅助信息展示，重点展示固定 Markdown 模板、字段含义和解析规则。

### 4.2 课题列表

复用 `GET /api/admin/projects/`。

列表展示字段：

- 课题标题
- `topic_id`
- 主题
- 主题内编号
- 阶段
- 是否公开
- 最近更新时间
- 操作：编辑、复制为新课题、建任务、归档

筛选字段：

- 关键词：标题、摘要、`topic_id`
- 主题
- 阶段
- 公开状态

当前 API 支持关键词和主题。阶段和公开状态如要进入筛选，需要后端在 `GET /api/admin/projects/` 增加可选参数 `stage` 和 `is_public`。这是必要增强，不是冗余 API。

为支持创建前重复识别，`GET /api/admin/projects/` 的关键词搜索还应覆盖 `source_md_path` 和 `content_hash`，或新增同一路由下的可选查询参数 `topic_id`、`source_md_path`、`content_hash`。不新增新的重复检测 API，避免把课题查询能力拆散。

重复识别查询要求：

- `topic_id`：精确匹配。
- `source_md_path`：精确匹配浏览器文件名或相对路径。
- `content_hash`：精确匹配 Markdown 正文 hash；建议为 `Project.content_hash` 增加索引。
- `q`：继续用于标题、摘要、`topic_id` 的模糊搜索，可额外覆盖 `source_md_path`。
- 响应中管理员列表 payload 需要包含 `source_md_path`、`content_hash`、`updated_at`、`is_public`、`stage`，方便导入预览展示重复风险。

### 4.3 新增/编辑课题

复用：

- 新增：`POST /api/admin/projects/`
- 编辑：`PATCH /api/admin/projects/{project_id}/`
- 详情回填：`GET /api/admin/projects/{project_id}/`

表单按固定模板分组，不再把所有字段堆成一条长表单：

| 分组 | 字段 |
| --- | --- |
| 基本信息 | `topic_id`、主题、主题内编号、阶段、是否公开 |
| 内容摘要 | 标题、摘要、科学问题、研究目标、技术路线 |
| 数据与评价 | 数据需求、评价指标、预期成果、合规说明 |
| 协作信息 | 标签、需要角色、推荐期刊 |
| 评分信息 | 初始评分、综合评分、评分维度 |
| 来源文档 | Markdown 路径、PDF 路径、公开页路径、文件列表、正文 Markdown |

表单要求：

- `topic_id` 和标题是创建课题的硬必填项。
- 主题是创建课题的硬必填项；必须选择已有主题，或在新增主题确认弹窗中确认创建。
- 管理员系统内新建课题默认保存为 `stage=draft` 且 `is_public=false`，避免未校验内容直接进入用户课题库。这个默认值必须落到后端边界：`Project` 模型默认值、`ProjectWriteRequest` 默认值、`admin_project_create()` 缺省处理都应以草稿/非公开为准。
- 编辑课题时不允许修改 `topic_id`；如确需改编号，应走后续单独的“课题编号更正”能力，不纳入本轮初期创建。
- 结构化 JSON 字段必须给出友好的错误提示，不能静默用 `{}` 或 `[]` 吞掉错误。
- 保存成功后刷新管理员课题列表、用户课题列表、`/api/meta/` 主题数据。

发布要求：

- 管理员创建页提供“保存草稿”“预览展示”“发布课题”三种明确动作。
- “保存草稿”调用现有 `POST /api/admin/projects/` 或 `PATCH /api/admin/projects/{project_id}/`，写入 `stage=draft`、`is_public=false`。
- “预览展示”优先使用前端本地表单数据渲染用户侧卡片和详情预览；已保存草稿可使用 `GET /api/admin/projects/{project_id}/` 读取完整详情。
- “发布课题”仍复用 `PATCH /api/admin/projects/{project_id}/`，将阶段改为 `open_recruiting` 或管理员选择的合法阶段，并设置 `is_public=true`。
- 发布前必须展示质量校验结果；存在硬错误时禁止发布，只有软缺失项时允许管理员确认后发布。

### 4.4 Markdown 导入

Markdown 导入不新增后端上传接口，流程如下：

1. 管理员选择单个 `.md` 文件，或选择文件夹。
2. 前端只读取 `.md` 文件，忽略其他文件。
3. 每个 Markdown 文件按固定模板解析成一个课题 payload。
4. 前端生成导入预览表。
5. 如果发现会影响前端展示的关键字段，弹窗要求管理员确认或修改。
6. 管理员确认后，前端逐条调用现有课题创建/更新 API。
7. 导入结束后展示成功、更新、失败数量，并刷新列表和主题数据。

导入预览表展示：

- 文件名
- 解析状态：可创建、可更新、缺少必填、格式错误
- `topic_id`
- 标题
- 主题
- 阶段
- 是否新增主题
- 缺失字段数量
- 解析备注

关键字段确认规则：

| 触发条件 | 管理员确认内容 |
| --- | --- |
| 主题不存在 | 确认创建主题，或修改为已有主题 |
| 阶段不在 `ProjectStage` 内 | 选择合法阶段，默认 `open_recruiting` |
| `topic_id` 已存在 | 确认更新已有课题，或取消该文件 |
| `is_public=false` | 确认课题不会出现在用户课题库 |
| 标题过长或为空 | 修改标题；为空则不可提交 |

Markdown 导入后的每个课题默认进入草稿，不直接公开。管理员必须在导入结果中逐条预览并发布，或批量确认发布。

### 4.5 JSON 导入移除影响确认

本次移除的是网页端管理员 JSON 导入功能，不再让管理员通过粘贴 JSON 创建或更新课题。

代码检索确认当前 JSON 导入相关依赖如下：

| 位置 | 当前用途 | 移除策略 |
| --- | --- | --- |
| `frontend/src/main.js` 的 `JSON 导入` tab 和 `importJson()` | 网页端管理员粘贴 JSON 导入 | 移除 |
| `frontend/src/api.js` 的 `adminImportProjects()` | 前端调用 JSON 导入 API | 移除 |
| `api/ninja_api.py` 的 `/api/admin/projects/import-json/` | 后端 Admin JSON 导入 API | 移除或至少不再暴露到产品 API 文档；推荐移除 |
| `api/tests.py` 中 JSON 导入断言 | 覆盖旧功能 | 更新为 Markdown 导入、管理员创建和字段契约测试 |
| `README.md` 和旧设计文档中的 JSON 导入说明 | 旧交接文档 | 更新为 Markdown 模板导入说明 |
| `projects/contracts.py` 的 `PROJECT_JSON_EXAMPLE` | `/api/project-schema/` 示例 JSON 来源 | 替换为 Markdown 模板示例或字段示例，不再命名为 JSON 导入示例 |
| `/api/project-schema/` 返回的 `example` | 前端初始化 JSON 导入文本 | 改为返回 Markdown 模板、字段契约和枚举值 |
| `frontend/src/main.js` 的 `useExampleJson()`、`importText` 初始化 | 填入 JSON 示例 | 移除，替换为复制 Markdown 模板 |
| 管理员角色卡片“JSON 导入”文案 | 可见产品文案 | 改为“Markdown 模板导入”或“课题创建与文件域维护” |
| `projects/management/commands/import_topics.py` | 命令行导入历史 `topics_index.json` 种子数据 | 保留，作为内部初始化/迁移工具，不作为产品功能 |
| `projects/importing.py` 的 `import_topic_bundle()` | 命令行导入和旧 API 共用的数据规范化服务 | 保留或收缩为内部服务，供 `import_topics` 继续使用 |

影响结论：

- 移除网页端 JSON 导入不会影响用户课题库、课题详情、文件空间、收藏、协作申请、管理员系统内创建、管理员编辑、主题与文件域维护。
- 如果直接移除后端 `/api/admin/projects/import-json/`，需要同步更新 OpenAPI 断言、README 和旧测试；这是预期影响，不是业务功能破坏。
- 历史大批量课题初始化仍可通过 `manage.py import_topics --source ...` 保留，不进入网页端产品入口。
- 管理员批量新增课题的产品路径改为 Markdown 文件/文件夹导入。

### 4.6 主题与文件域

主题与文件域不再作为孤立窗口，而是放在课题管理中，原因是：

- 课题创建时必须选择主题。
- 新主题会直接影响用户课题库筛选和文件空间。
- 课题详情里的主题文件域来自 `GET /api/themes/{slug}/space/`。

主题与文件域功能继续复用：

- `GET /api/admin/themes/`
- `POST /api/admin/themes/`
- `PATCH /api/admin/themes/{theme_id}/`
- `DELETE /api/admin/themes/{theme_id}/`
- `GET /api/admin/theme-files/`
- `POST /api/admin/theme-files/`
- `PATCH /api/admin/theme-files/{file_id}/`
- `DELETE /api/admin/theme-files/{file_id}/`

页面要求：

- 可以维护主题名称、slug、说明、排序、启用状态。
- 可以维护主题级文件域策略。
- 可以维护主题文件列表。
- 停用主题或主题文件只做逻辑停用，并保留审计。

### 4.7 课题创建产品闭环补充能力

从资深产品视角看，课题创建不是单纯的表单提交，而是一个“结构化医学 AI 协作对象”的入库、校验、预览、发布和追踪过程。基于当前代码和 API，本轮还需要补齐以下能力。

#### 4.7.1 创建质量校验

当前后端硬校验只有 `topic_id` 和标题，产品上不足以保证课题可读、可协作、可展示。应增加创建质量校验，但不需要新增数据库字段。

质量校验分为两类：

| 等级 | 字段 | 处理 |
| --- | --- | --- |
| 硬错误 | `topic_id`、标题、主题 | 禁止创建或发布 |
| 发布前软缺失 | 摘要、科学问题、研究目标、数据需求、评价指标、合规说明、需要角色 | 允许保存草稿；发布时必须提示并要求管理员确认 |

实现方式：

- 前端表单和 Markdown 解析预览中计算完整度，例如“必填完整 3/3，建议字段 5/7”。
- 后端创建/更新接口继续复用现有 `/api/admin/projects/`，但应在 `admin_project_create` 和 `admin_project_update` 内明确校验主题存在、阶段合法、`topic_id` 和标题存在。
- 质量校验结果展示在管理员页面，不需要写入 `Project` 模型。

#### 4.7.2 草稿、预览和发布

当前系统已有 `Project.stage` 和 `Project.is_public`，足够承载轻量发布流，不需要新增发布模型。

推荐状态规则：

| 操作 | `stage` | `is_public` | 用户侧是否可见 |
| --- | --- | --- | --- |
| 保存草稿 | `draft` | `false` | 不可见 |
| 导入草稿 | `draft` | `false` | 不可见 |
| 发布招募 | `open_recruiting` | `true` | 可见 |
| 归档停用 | `archived` | `false` | 不可见 |

管理员创建页必须有用户侧预览。预览至少覆盖：

- 课题列表卡片效果。
- 课题详情结构化字段效果。
- 缺失字段如何显示为“待补充”。
- 主题文件域是否能关联到所属主题。

#### 4.7.3 新主题确认和后端一致性

当前 `projects/importing.py` 的 `theme_from_item()` 会在传入未知主题时自动创建主题。这对历史导入有用，但对管理员产品流程不够安全，因为它绕过了“新增主题必须确认”。

本轮应固定：

- 网页端管理员创建和 Markdown 导入时，未知主题必须先弹窗确认。
- 确认后先调用 `POST /api/admin/themes/` 创建主题，再调用课题创建/更新接口。
- `POST /api/admin/projects/` 和 `PATCH /api/admin/projects/{project_id}/` 面向网页端时，不应静默创建未知主题；未知主题应返回 422。
- 实现上应给 `upsert_project()` / `normalize_project_item()` / `theme_from_item()` 增加类似 `allow_create_theme` 的参数：网页端 admin API 传 `False`，命令行内部导入传 `True`。
- 命令行 `manage.py import_topics --source ...` 如保留，可继续允许内部初始化时自动创建主题。

这是同一套数据服务在“产品写入”和“内部迁移”上的边界差异，不是新增冗余接口。

#### 4.7.4 重复识别

当前数据库只对 `topic_id` 做唯一约束，仍可能出现同题不同 ID、同文件重复导入、同内容重复导入的问题。

创建和导入前应做重复提示：

| 检测项 | 当前可用字段 | 处理 |
| --- | --- | --- |
| 相同 `topic_id` | `Project.topic_id` | 明确提示将更新已有课题 |
| 相同来源路径 | `Project.source_md_path` | 提示可能重复 |
| 相同正文 | `Project.content_hash` | 提示可能重复 |
| 相似标题 | `Project.title` | 提示可能重复 |

最小化实现：

- 不新增重复检测 API。
- 扩展 `GET /api/admin/projects/` 查询能力，支持按 `topic_id`、`source_md_path`、`content_hash` 或标题关键词查找。
- 前端在创建/导入预览阶段调用现有管理员课题列表 API 完成检查。

#### 4.7.5 Markdown 模板版本

固定 Markdown 模板后，必须给模板加版本，避免未来模板更新导致旧文档解析规则混乱。

模板新增字段：

```markdown
## 基本信息
- 模板版本：v1
```

解析规则：

- 未填写模板版本时按 `v1` 处理，但预览中提示“未声明模板版本”。
- 暂只支持 `v1`。
- 不识别的模板版本不可直接导入，必须提示管理员修正。

#### 4.7.6 导入失败修复路径

Markdown 文件解析失败后，管理员不能只看到失败结果，还应能在预览页直接修复。

预览页至少支持：

- 修改标题、`topic_id`、主题、阶段、是否公开。
- 补充缺失摘要、科学问题、研究目标。
- 把未知主题改为已有主题，或确认创建新主题。
- 取消单个文件导入。
- 对多个文件批量应用主题、阶段和公开状态。

修复后的提交仍调用现有课题创建/更新接口。

#### 4.7.7 结构化输入体验

当前管理员表单里有多个 JSON 文本框，例如数据需求、评价指标、预期成果、文件列表、评分维度。对管理员来说，这不是好的产品体验。

本轮应至少优化：

- `data_requirements` 用键值表单展示：数据类型、最小样本量、数据来源、隐私要求。
- `evaluation_metrics` 用可增删列表展示。
- `expected_outputs` 用可增删列表展示。
- `documents` 用文件条目列表展示：类型、标题、路径。
- 底层 payload 仍转换为现有 JSON 字段，不新增模型。

#### 4.7.8 创建来源记录

每个课题应在管理员侧能看出来源。

可复用现有字段：

| 来源 | 记录方式 |
| --- | --- |
| 系统内创建 | 审计记录 `project.create`，`source_payload.source=api-admin` |
| Markdown 导入 | `source_md_path`、`ProjectDocument(markdown)`、审计记录 |
| 内部命令导入 | `source_payload.source` 和 `ImportLog` |

管理员课题详情页应展示来源信息，但用户侧不需要突出展示。

公开 API 和管理员 API 的来源字段边界必须分开：

- 管理员详情可以返回 `source_payload`、`content_hash`、`source_md_path`、`ProjectDocument`，用于追踪导入来源和重复识别。
- 用户公开课题列表和详情不应返回 `source_payload` 或内部导入信息；`content_hash` 也不需要对用户展示。
- 用户侧可继续展示课题原始文档列表，但 Markdown 文件来源应使用浏览器相对路径或文件名，不暴露本机绝对路径、服务端内部路径或命令行导入路径。

## 5. Markdown 固定模板

### 5.1 模板正文

管理员页面必须提供“一键复制模板”。

```markdown
# 课题标题

## 基本信息
- 模板版本：v1
- 课题ID：
- 主题：
- 主题内编号：
- 阶段：开放招募
- 是否公开：是
- 标签：
- 需要角色：
- 推荐期刊：
- 初始评分：
- 综合评分：

## 摘要

## 科学问题

## 研究目标

## 技术路线

## 数据需求
- 数据类型：
- 最小样本量：
- 数据来源：
- 隐私要求：

## 评价指标
- 

## 预期成果
- 

## 合规说明

## 前沿依据

## 分析单位和任务定义

## 金标准或终点设计

## 方法和系统框架

## 基线方法

## 实验设计

## MVP

## Go/No-Go

## 可防守主张和不可主张

## 预期图表

## 质量评分和风险
```

### 5.2 解析规则

解析必须保守，不做智能猜测。

| 模板内容 | 写入字段 |
| --- | --- |
| H1 | `title` |
| `基本信息.模板版本` | 解析规则版本，当前仅支持 `v1` |
| `基本信息.课题ID` | `topic_id` |
| `基本信息.主题` | `theme` |
| `基本信息.主题内编号` | `project_no` |
| `基本信息.阶段` | `stage` |
| `基本信息.是否公开` | `is_public` |
| `基本信息.标签` | `tags` |
| `基本信息.需要角色` | `needed_roles` |
| `基本信息.推荐期刊` | `recommended_journal` |
| `基本信息.初始评分` | `llm_score` |
| `基本信息.综合评分` | `composite_score` |
| `摘要` | `summary` |
| `科学问题` | `problem_statement` |
| `研究目标` | `research_goal` |
| `技术路线` | `technical_route` |
| `数据需求` | `data_requirements` |
| `评价指标` | `evaluation_metrics` |
| `预期成果` | `expected_outputs` |
| `合规说明` | `compliance_notes` |
| Markdown 全文 | `body_markdown` |
| 文件名或浏览器相对路径 | `source_md_path` 和 `ProjectDocument(markdown)` |

可选扩展章节如“前沿依据”“实验设计”“MVP”等暂不单独入库，保留在 `body_markdown` 中，用户详情页可继续展示 Markdown 原文。后续如果这些章节成为产品固定字段，再新增模型字段或 `source_payload.sections`，本轮不提前扩张数据库结构。

### 5.3 缺失规则

| 情况 | 处理 |
| --- | --- |
| 缺少 H1 标题 | 文件不可创建，预览标记为“缺少标题” |
| 缺少 `课题ID` | 文件不可创建，预览标记为“缺少课题ID” |
| 缺少主题 | 文件不可创建，要求管理员选择已有主题或确认创建新主题 |
| 缺少可选章节 | 对应字段为空字符串、空数组或空对象 |
| 章节存在但格式不符合固定规则 | 对应字段为空，原文保留在 `body_markdown` |
| 阶段无法识别 | 预览标记为需确认，默认建议 `open_recruiting` |
| 数字无法解析 | 对应数字字段为空 |

数据需求必须按模板中的键值项目解析；评价指标和预期成果必须按列表解析。没有解析到列表项时写入空数组。

## 6. 页面适配要求

### 6.1 管理员侧

管理员侧必须完成：

- 顶层移除独立 `JSON 导入` 和 `字段契约` tab。
- `课题管理` 成为课题生命周期初期的统一入口。
- `课题管理` 内可完成课题浏览、新增、编辑、Markdown 导入、主题与文件域维护。
- 管理员页面不再提供粘贴 JSON 导入课题的入口。
- Markdown 导入必须有预览和确认，不允许选择文件后直接写库。
- 新增主题必须弹窗确认，并允许管理员修改主题名称、slug 和说明。
- 所有写入动作必须显示清楚的成功、失败和错误原因。

### 6.2 用户侧

用户侧必须完成：

- 用户课题库只显示公开课题。
- 新增或修改课题后，用户课题库、主题筛选、文件空间能刷新到最新状态。
- 缺失字段在课题卡片和详情页显示“待补充”，不能显示空白、`undefined`、`null` 或原始 JSON 噪声。
- 课题详情继续展示主题文件域和课题原始文档。
- 用户侧不得出现任何创建、导入或编辑课题入口。

## 7. 审计和数据一致性

每个管理员写入动作必须产生审计记录：

| 动作 | 审计 action |
| --- | --- |
| 系统内创建课题 | `project.create` |
| 系统内编辑课题 | `project.update` |
| Markdown 导入创建 | `project.create`，并在 `source_md_path` 和导入结果中保留文件来源 |
| Markdown 导入更新 | `project.update`，并在 `source_md_path` 和导入结果中保留文件来源 |
| 课题归档 | `project.archive` |
| 主题创建 | `theme.create` |
| 主题更新 | `theme.update` |
| 主题停用 | `theme.deactivate` |
| 主题文件创建 | `theme_file.create` |
| 主题文件更新 | `theme_file.update` |
| 主题文件停用 | `theme_file.deactivate` |

注意：Markdown 导入为了避免新增冗余 API，应先用现有创建/更新接口完成写库。前端在导入预览中判断 `topic_id` 是否已存在；新增时调用 `POST /api/admin/projects/`，更新时调用 `PATCH /api/admin/projects/{project_id}/`，从而复用现有审计动作。导入结果页面必须记录每个文件的来源、创建/更新结果和失败原因。

## 8. 严格验收标准

### 8.1 权限验收

- 普通用户访问 `#/admin` 看不到课题创建、编辑、导入、主题文件域管理入口。
- 普通用户直接请求 `/api/admin/projects/`、`/api/admin/themes/`、`/api/admin/theme-files/` 返回 403。
- `/api/admin/projects/import-json/` 不再作为产品 API 出现在 `/api/docs` 中；如果后端路由移除，直接请求应返回 404。
- 管理员 `platform_admin` 可以进入课题管理并看到统一工作区。

### 8.2 管理员系统内创建验收

- 管理员可以在课题管理内填写模板字段并创建课题。
- 缺少 `topic_id` 或标题时不能提交，并展示明确错误。
- 缺少主题时不能保存或发布，并展示明确错误。
- 新建课题默认是草稿和非公开，不会立即出现在用户课题库。
- 管理员可以从草稿进入预览，再发布为公开课题。
- 发布前展示质量校验结果，软缺失项必须经管理员确认。
- 选择已有主题时，课题保存后出现在该主题下。
- 输入未知主题时，系统必须先要求确认创建主题；未确认不得静默创建主题。
- 创建时传入重复 `topic_id` 必须返回错误，不能通过 `POST` 覆盖已有课题。
- 编辑时修改 `topic_id` 必须返回错误，不能通过 `PATCH` 创建第二条课题。
- 新增或编辑后，管理员课题列表刷新，用户课题库刷新。
- 编辑课题后再次打开详情，所有修改字段保持一致。
- 归档课题后，管理员列表显示已归档或停用，用户课题库不再显示。
- 管理员课题详情可看到创建来源：系统内创建、Markdown 导入或内部命令导入。

### 8.3 Markdown 导入验收

- 管理员可以选择单个 `.md` 文件导入。
- 管理员可以选择文件夹，系统只解析其中 `.md` 文件。
- Markdown 模板版本 `v1` 能被识别；未知模板版本不可直接导入。
- 不符合模板的文件不会直接写库，而是在预览中标记失败原因。
- 缺少可选章节时，对应字段为空，详情页显示“待补充”。
- 缺少 `topic_id`、标题或主题时，该文件不可提交。
- 新主题出现时必须弹窗确认，管理员可修改主题名称、slug 和说明。
- 取消确认后不会创建主题，也不会创建对应课题。
- 确认后新主题出现在主题筛选和文件空间中。
- 同一 `topic_id` 再次导入时走更新逻辑，不生成重复课题。
- 相同 `source_md_path`、相同 `content_hash` 或相似标题会在导入预览中提示潜在重复。
- 导入失败项可在预览页修复关键字段后再次提交。
- Markdown 导入后的课题默认进入草稿，除非管理员明确确认发布。

### 8.4 JSON 导入移除验收

- 管理员顶层 tab 中不再出现 `JSON 导入`。
- 课题管理内部不再出现粘贴 JSON 的编辑器、示例 JSON、导入按钮。
- `frontend/src/api.js` 不再暴露 `adminImportProjects()`。
- `/api/docs` 不再展示 `/api/admin/projects/import-json/`。
- `/api/project-schema/` 不再返回用于 JSON 导入的 `example`；如保留示例，应改为 Markdown 模板或字段示例。
- `README.md` 和本轮新增文档不再把网页端 JSON 导入作为管理员功能。
- `manage.py import_topics --source ...` 如保留，必须在文档中明确为内部初始化/迁移工具，不是网页端产品功能。

### 8.5 主题与文件域验收

- 主题与文件域维护入口在课题管理内可用。
- 可以创建、编辑、停用主题。
- 可以创建、编辑、停用主题文件。
- 主题文件域内容能在用户侧文件空间展示。
- 课题详情页能展示所属主题的文件域文件。
- 网页端课题创建接口不会绕过主题确认静默创建未知主题。
- 命令行内部导入仍可按需要自动创建主题，不影响历史课题初始化。

### 8.6 用户侧展示验收

- 用户课题库只显示公开课题。
- 新建课题包含完整模板字段时，课题卡片展示关键字段，详情页展示结构化字段。
- 新建课题缺失可选字段时，卡片和详情页没有空白错位、`undefined`、`null` 或 JSON 噪声。
- 主题筛选、阶段筛选、排序仍可使用。
- 收藏、状态卡、详情页参与操作不因新建课题字段缺失而报错。

### 8.7 API 和代码边界验收

- 未新增普通用户创建课题 API。
- 未新增与现有 `/api/admin/projects/` 重复的单课题创建接口。
- 如果没有服务端上传必要，不新增 Markdown 上传 API。
- 现有 `/api/project-schema/`、`/api/admin/projects/`、`/api/admin/themes/`、`/api/admin/theme-files/` 均保持可用。
- 草稿、预览、发布流程复用 `stage` 和 `is_public`，不新增发布状态模型。
- 重复识别优先扩展管理员课题列表查询能力，不新增独立重复检测 API。
- 管理员详情与用户公开详情使用不同 payload 边界，用户侧不暴露 `source_payload`、`content_hash` 或内部导入路径。
- 网页端 JSON 导入相关 API、前端调用、UI 入口和测试断言均被移除或改写为 Markdown 导入验收。
- API 文档 `/api/docs` 中现有接口说明不被破坏。

### 8.8 自动化测试验收

后端至少覆盖：

- 管理员创建课题成功。
- 管理员更新课题成功。
- 普通用户不能访问管理课题 API。
- 归档后用户课题库不可见。
- 新主题创建后可被课题关联。
- 未确认新主题时，管理员课题创建/发布不会静默创建主题。
- 草稿课题不会出现在用户课题库；发布后才可见。
- `POST /api/admin/projects/` 遇到重复 `topic_id` 返回 422。
- `PATCH /api/admin/projects/{project_id}/` 不允许把 `topic_id` 改成其他值。
- Markdown 导入预览识别到重复 `topic_id` 后，必须定位已有课题并走 `PATCH` 更新，不能再次 `POST` 创建。
- 管理员课题列表可用于重复识别需要的查询字段。
- `/api/admin/projects/import-json/` 不再出现在 OpenAPI schema 中，或直接请求返回 404。
- 内部 `import_topics` 命令如保留，应至少不被本次删除破坏。

前端至少覆盖：

- Markdown 模板解析：完整模板、缺失可选章节、缺失必填、非法阶段。
- Markdown 模板解析：识别 `模板版本：v1`，拒绝未知模板版本。
- 新主题检测和确认逻辑。
- 创建质量校验、草稿保存、预览发布、重复提示。
- 数据需求、评价指标、预期成果、文件列表使用结构化输入，并能转换为现有 payload。
- 课题管理内不再显示 JSON 导入入口。
- 用户详情页缺失字段显示“待补充”。

浏览器验收至少覆盖：

- 管理员登录后进入 `#/admin` 的课题管理。
- 系统内创建一个测试课题。
- 先保存为草稿并确认用户课题库不可见。
- 预览后发布并确认用户课题库可见。
- Markdown 文件导入一个测试课题。
- Markdown 导入预览能修复缺失字段和确认新主题。
- 新主题确认创建。
- 用户侧课题库能看到公开测试课题。
- 用户侧详情页能看到结构化字段、主题文件域和原始文档。
- 普通用户登录后没有管理入口。

### 8.9 响应式验收

- 管理员课题管理在 390px、768px、1280px、1440px 宽度下无横向溢出。
- 导入预览表在小屏下可滚动或转为卡片，不遮挡操作按钮。
- 课题新增/编辑表单在小屏下按分组纵向排列。
- 用户课题卡片和详情页在小屏下不出现文字溢出或按钮遮挡。

## 9. 实施优先级

1. 先重构管理员课题管理页面，把旧的课题管理、主题与文件域、字段契约合并到一个工作区，并移除 JSON 导入入口。
2. 再加入 Markdown 模板复制、文件读取、解析、预览和确认。
3. 再适配用户侧缺失字段展示和刷新逻辑。
4. 再移除或隐藏后端网页端 JSON 导入 API，并同步更新 API 文档、README 和测试。
5. 最后补自动化测试、浏览器验收、版本号和更新日志。

本设计确认后，再进入执行计划和代码实现。
