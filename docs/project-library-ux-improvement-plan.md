# 课题库与收藏体验优化执行文档

执行分支：`codex/project-library-ux-implementation`

生成日期：2026-06-08

术语修正（2026-06-11）：当前产品口径以 `docs/project-lifecycle-product-design.md` 为准。课题卡片只保留“点赞”和“关注”，不再单独设置“收藏”。本文历史内容中的“收藏”均指现有 `ProjectFollow` / follow API 所承载的关注关系；前端面向用户时应统一展示为“关注/取消关注”。

## 目标

围绕课题库首页、课题列表、课题详情文件展示、收藏交互、个人信息入口、我的收藏页面、系统版本号和更新日志做一轮产品化优化。实现时必须优先复用现有 API 和数据模型，避免为了前端页面方便而新增冗余接口。

本轮文档作为课题库与收藏体验优化的执行依据、API 约束和验收标准。实现必须优先复用现有接口；如果执行中发现必须新增接口，需要先补充接口必要性说明，再进入开发。

## 当前架构核对

### 前端入口

- 主应用集中在 `frontend/src/main.js`。
- 样式集中在 `frontend/src/styles.css`。
- API 包装集中在 `frontend/src/api.js`。
- 当前 hash 路由已支持：
  - `#/` 与 `#/projects`：课题库首页/列表。
  - `#/project/:id`：课题详情页。
  - `#/space/:slug`：主题文件空间。
  - `#/dashboard`：我的协作。
  - `#/admin`：管理后台。
  - 登录、注册、强制改密等账号页面。
- 当前列表卡片点击默认打开课题预览弹窗，详情路由仍存在但不是列表主入口。

### 后端 API 与数据能力

当前已有能力可以覆盖绝大部分需求：

| 需求 | 现有接口/模型 | 结论 |
| --- | --- | --- |
| 主题筛选 | `GET /api/projects/?theme=<slug>` | 已支持，不需要新增后端筛选接口。 |
| 主题列表 | `GET /api/meta/` 返回 `themes` | 已支持，可用于筛选下拉。 |
| 课题列表关键字段 | `project_summary_payload` | 已包含主题、阶段、评分、关注数、参与数、标签、所需角色、期刊、结构化字段等。 |
| 课题详情 | `GET /api/projects/{id}/` | 已包含详情字段和登录用户 `viewer_state`。 |
| 收藏/取消收藏 | `ProjectFollow`，`POST /api/projects/{id}/follow/`，`POST/DELETE /api/projects/{id}/unfollow/` | 已支持，收藏语义直接复用关注模型。 |
| 我的收藏数据 | `GET /api/me/dashboard/` 返回 `follows` | 已支持当前用户关注课题列表，第一阶段不新增 API。 |
| 主题文件域 | `ThemeFile`，`GET /api/themes/{slug}/space/` | 已支持展示主题文件域文件。 |
| 个人信息 | `GET /api/me/`，`GET/PATCH /api/me/profile/` | 已支持展示当前用户 profile。 |
| 系统版本号 | `api/ninja_api.py` 当前硬编码 `version="0.1.0"`，`frontend/package.json` 当前为 `0.1.0` | 有零散版本号，但没有统一版本源。 |
| 更新日志 | 当前没有根目录 `CHANGELOG.md` | 需要新增标准化更新日志，并纳入每次交付验收。 |

### 当前问题定位

1. 首页 hero 文案 `探索前沿医学人工智能` 使用了过大的内联字号和 `100px` 上下 padding，视觉权重过高，导致课题列表起始位置被推得过低。
2. 课题列表 `.project-grid` 当前是三列卡片，不适合展示结构化关键字段，也不利于快速比较。
3. 课题库筛选工具条没有显式主题下拉，虽然下方已有主题 chip，但筛选区本身不完整。
4. 课题详情和预览弹窗的“课题文件”当前只展示 `ProjectDocument`，没有展示该课题所属主题的 `ThemeFile` 文件域。
5. 列表卡片没有收藏按钮。详情/预览里有关注按钮，但按钮文案不随状态变化，反馈偏弱。
6. 顶部个人入口只是一个按钮，不能 hover 查看用户概要。
7. 当前 `dashboard` 只展示关注/参与/评分数量，没有用户可浏览的收藏课题列表页。
8. 当前系统没有统一版本号和更新日志。后端 API 文档、前端 package 版本和实际交付状态可能漂移，后续交接时无法清楚说明“当前本地运行的是哪一版、这一版更新了什么”。

## 产品方案

### 1. 首页 hero 降低视觉权重

将首页顶部从强营销 hero 改成紧凑的课题库说明区。

执行方向：

- 移除 `library-hero` 上当前的巨大内联样式。
- 标题保留但不突出，建议改为 `课题库` 或将 `探索前沿医学人工智能` 放为普通副标题。
- 控制桌面端标题字号在 `28px` 到 `34px`，移动端不超过 `28px`。
- 控制 hero 上下 padding 在 `24px` 到 `36px`。
- 筛选区不再用负 margin 覆盖 hero。
- 课题列表在首屏内应能露出至少第一条课题内容。

### 2. 课题列表改为一行一个

将 `.project-grid` 改为单列列表，每个课题用横向信息密度更高的 list item 展示。

每条课题建议展示字段：

- 标题：`title`。
- 课题编号：`topic_id`，如果有 `project_no` 也展示。
- 主题：`theme.name`。
- 阶段：`stage_label`。
- 摘要或科学问题：优先 `summary`，兜底 `problem_statement`。
- 关键结构化字段：
  - `research_goal`：研究目标，截断展示。
  - `data_requirements`：数据需求摘要。
  - `evaluation_metrics`：评价指标摘要。
  - `needed_roles`：所需角色。
- 指标：
  - `composite_score`。
  - `follow_count`。
  - `interest_count`。
- 标签：`tags` 前 3 到 5 个。
- 操作：
  - 收藏/取消收藏按钮。
  - 查看详情或打开预览按钮。

交互要求：

- 点击卡片主体仍可打开预览或进入详情，但收藏按钮必须 `@click.stop`，不能触发卡片打开。
- 单列布局在桌面、平板、手机都保持一行一个课题，只允许内部字段重排。
- 长标题、长摘要、长标签不能撑破卡片。

### 3. 筛选区增加主题筛选

后端已经支持 `GET /api/projects/?theme=<slug>`，前端只需要在 toolbar 增加主题 `select`。

执行方向：

- 在当前搜索、阶段、排序旁增加“主题”下拉。
- 下拉数据来自 `state.meta.themes`。
- 选择主题后调用现有 `applyFilters()`。
- 保留主题 chip 作为快捷筛选，但必须与下拉状态同步。
- `全部主题` 对应空字符串 `""`。
- 不新增后端 API。

### 4. 课题详情展示主题文件域

详情页和预览弹窗中的“课题文件”应改为“主题文件域”优先展示。

执行方向：

- 课题详情加载完成后，如果 `state.currentProject.theme?.slug` 存在，调用现有 `api.themeSpace(slug)`。
- 在详情页和预览弹窗展示该主题下的 `sections` 和 `files`。
- 文件展示字段：
  - `section.name`。
  - `file.file_type_label`。
  - `file.title`。
  - `file.description`。
  - `file.path`。
- 如果文件数量较多，可以默认展示前 8 个，并提供“展开全部”或“查看主题文件空间”。
- 保留 `ProjectDocument` 但降级为“课题原始文档”，放在主题文件域后方或折叠区，避免和主题文件域混淆。
- 如果课题没有主题，显示明确空状态：“该课题暂无所属主题，无法关联主题文件域。”
- 如果主题没有文件，显示明确空状态，并引导管理员到“管理 / 主题与文件域”维护。

本项不需要新增 API。只有当后续出现性能问题或权限过滤需求时，才考虑增加 `GET /api/projects/{id}/theme-files/`，当前阶段不建议新增。

### 5. 收藏交互完善

收藏语义沿用当前 `ProjectFollow` 模型和 follow/unfollow API。

执行方向：

- 课题列表每条课题增加收藏按钮。
- 课题详情页收藏按钮显示真实状态：
  - 未收藏：`收藏课题`。
  - 已收藏：`已收藏` 或 `取消收藏`。
- 预览弹窗使用同一套收藏按钮逻辑。
- 收藏成功后：
  - 按钮状态立即改变。
  - 显示 toast，例如“已收藏课题”。
  - 当前课题 `viewer_state.is_following` 或列表本地状态同步更新。
  - `follow_count` 做本地加减或重新拉取列表/详情，避免用户看到状态错位。
- 取消收藏成功后：
  - 按钮状态立即改变。
  - 显示 toast，例如“已取消收藏”。
- 未登录用户点击收藏：
  - 调用现有 `ensureLogin()`。
  - 跳转登录页或提示登录。

重要实现约束：

- 当前 `GET /api/projects/` 返回的课题摘要没有 `viewer_state`，列表页要么在本地维护已收藏集合，要么在已登录时从 `GET /api/me/dashboard/` 取 `follows` 后合并状态。
- 优先复用 `GET /api/me/dashboard/` 的 `follows`，不新增列表 viewer_state API。
- 如果后续要求服务端直接在列表返回 `viewer_state`，需要评估 N+1 查询风险，再通过批量查询实现。

### 6. 顶部个人入口 hover 小窗

在右上角用户入口增加 hover/focus popover。

展示内容建议：

- 昵称或用户名。
- UID：`profile.uid`。
- 身份：`profile.role_type_label` 或 `roleInfo.role_label`。
- 机构：`profile.organization`，未填写则展示“未填写机构”。
- 邮箱：`email` 或 `profile.contact_email`。
- 积分：`profile.credit_balance`。
- 声誉：`profile.reputation_score`。
- 快捷入口：
  - 我的协作：`#/dashboard`。
  - 我的收藏：新增 `#/favorites`。
  - 退出。

交互要求：

- 鼠标 hover 打开。
- 键盘 focus 可打开。
- 点击用户名区域进入当前用户管理页面，当前阶段建议进入 `#/dashboard`。
- 小窗不遮挡导航按钮，不挤压顶部栏。
- 移动端不依赖 hover，点击用户按钮打开/关闭。

### 7. 新增我的收藏页面

新增前端 route：`#/favorites`。

数据来源：

- 第一阶段直接复用 `GET /api/me/dashboard/` 的 `follows`。
- 每条收藏记录中已有 `project_summary_payload`，可以展示课题列表需要的关键字段。
- 不新增后端 API。

页面能力：

- 展示当前用户收藏的全部课题。
- 每条收藏课题可打开预览或进入详情。
- 可在页面内取消收藏。
- 取消收藏后列表立即移除或显示状态变化。
- 空状态文案：“还没有收藏课题。”
- 未登录访问时跳转 `#/login`。

后续扩展条件：

- 如果收藏数量很大，`dashboard` 一次性返回全部关注会不适合分页。届时再新增 `GET /api/me/follows/?page=&page_size=`，返回结构复用 `follow_payload`。当前阶段不新增，以避免冗余。

### 8. 系统版本号与更新日志

系统需要建立可交付、可追踪的版本治理规则：每次功能更新、缺陷修复或交付文档更新，都必须同步更新系统版本号和更新日志。

执行方向：

- 新增根目录 `VERSION` 文件，作为系统版本号唯一来源。
- 新增根目录 `CHANGELOG.md` 文件，作为更新日志唯一来源。
- 版本号采用语义化版本格式：`MAJOR.MINOR.PATCH`。
- 当前这轮课题库与收藏体验功能属于功能增强，正式实现时建议从现有 `0.1.0` 升到 `0.2.0`。
- `api/ninja_api.py` 不再硬编码 `version="0.1.0"`，而是读取统一版本常量。
- `frontend/package.json` 的 `version` 必须与根目录 `VERSION` 保持一致。
- `GET /api/meta/` 返回系统版本信息和更新日志摘要，避免新增冗余 API。
- 前端在页面右上角个人小窗或页面底部显示当前版本，例如 `v0.2.0`。
- 点击版本号后只打开一个小弹窗，不新增独立更新日志页面或 `#/changelog` 路由。
- 小弹窗默认展示最新一个版本的更新情况。
- 过往版本只展示版本号列表；点击某个历史版本号后，在同一个弹窗内用折叠菜单展开该版本更新内容。
- 管理员后台可以展示当前版本号和最近更新日志，但更新日志本身仍由代码仓库维护，不在后台页面直接编辑。

建议文件职责：

| 文件 | 职责 |
| --- | --- |
| `VERSION` | 系统版本号唯一来源，只包含一个版本字符串。 |
| `CHANGELOG.md` | 更新日志唯一来源，按版本倒序记录日期、功能、修复、验收说明。 |
| `config/release.py` | 读取 `VERSION` 和 `CHANGELOG.md`，向后端提供 `APP_VERSION` 和最近更新日志摘要。 |
| `api/ninja_api.py` | 使用 `APP_VERSION` 设置 API 文档版本，并在 `/api/meta/` 中返回版本信息。 |
| `frontend/package.json` | 与 `VERSION` 同步，保证前端包版本不漂移。 |
| `frontend/src/main.js` | 从 `state.meta.release` 读取版本和日志，展示版本号按钮和更新日志小弹窗。 |
| `frontend/src/styles.css` | 定义版本号按钮、更新日志小弹窗和历史版本折叠菜单样式。 |
| `scripts/check_release_version.py` | 校验 `VERSION`、`CHANGELOG.md`、`frontend/package.json` 和 API 版本来源一致。 |

`/api/meta/` 中的 `release` 建议结构：

```json
{
  "version": "0.2.0",
  "latest": {
    "version": "0.2.0",
    "date": "2026-06-08",
    "sections": {
      "Added": ["课题库列表改为一行一个，并展示关键字段。"],
      "Changed": ["首页 hero 降低视觉权重。"],
      "Fixed": ["收藏后按钮无明确反馈的问题。"]
    }
  },
  "history": [
    {
      "version": "0.1.0",
      "date": "2026-06-08",
      "sections": {
        "Added": ["完成用户注册、登录、默认密码恢复和管理员用户管理基础能力。"]
      }
    }
  ]
}
```

更新日志格式建议：

```markdown
# CHANGELOG

## 0.2.0 - 2026-06-08

### Added

- 课题库列表改为一行一个，并展示关键字段。
- 增加我的收藏页面。
- 增加系统版本号与更新日志展示。

### Changed

- 首页 hero 降低视觉权重。
- 课题详情文件展示改为优先展示主题文件域。

### Fixed

- 收藏后按钮无明确反馈的问题。
```

版本更新规则：

- `MAJOR`：不兼容 API、数据结构、权限规则或部署方式变化。
- `MINOR`：新增功能、页面、API 字段或用户可感知的重要体验优化。
- `PATCH`：缺陷修复、文案修正、样式微调、测试补充。

版本号递增逻辑必须固定：

- 只以合并到 `dev` 的交付 PR 为版本更新单位。
- 同一个 PR 无论有多少次 commit，只能递增一次版本号。
- 先读取当前 `VERSION`，再按本次 PR 中影响最大的变更类型选择递增级别。
- 如果同一个 PR 同时包含新功能和缺陷修复，按 `MINOR` 递增，不再额外递增 `PATCH`。
- 如果同一个 PR 包含破坏性变更，按 `MAJOR` 递增，并将 `MINOR` 和 `PATCH` 归零。
- `MINOR` 递增时，`PATCH` 必须归零。
- `PATCH` 递增时，只允许最后一位加 1。
- 禁止跳号，例如 `0.2.0` 后不能直接跳到 `0.4.0`，除非文档中明确说明中间版本已经在其他 PR 发布。
- 已合并发布的版本号和对应 changelog 不允许回改；如果需要修正文案或补充说明，必须进入下一个 `PATCH` 版本。
- 纯本地开发过程、未合并草稿和中间调试提交不单独递增版本号。
- 文档型交付如果会合并到 `dev`，按 `PATCH` 递增；如果只是实现计划的一部分且与功能 PR 同时合并，则并入该功能版本，不单独跳号。

每次 PR 合并前必须满足：

- `VERSION` 已更新。
- `CHANGELOG.md` 顶部版本号与 `VERSION` 一致。
- `frontend/package.json` 的 `version` 与 `VERSION` 一致。
- `/api/openapi.json` 的 `info.version` 与 `VERSION` 一致。
- `/api/meta/` 返回的版本号与 `VERSION` 一致。
- 如果本次更新包含用户可见变化，更新日志必须写明 Added、Changed 或 Fixed 中至少一类内容。

## 实施顺序

1. 前端路由与状态准备
   - 增加 `favorites` 路由识别和 `buildHash` 支持。
   - 增加收藏状态集合，例如 `state.followedProjectIds`。
   - 登录后通过 `api.dashboard()` 或进入收藏页时加载收藏数据。

2. 首页和筛选区调整
   - 压缩 `library-hero`。
   - toolbar 增加主题 select。
   - 清理当前 hero 和 toolbar 的内联样式，迁移到 CSS。

3. 课题列表重构
   - `.project-grid` 改为单列。
   - 课题卡片改为结构化 list item。
   - 加收藏按钮和状态反馈。

4. 详情和预览的文件域修复
   - `loadProject()` 后按主题加载 `themeSpace`。
   - 详情页与预览弹窗复用一个主题文件域展示结构。
   - 保留 ProjectDocument 作为辅助区。

5. 我的收藏页
   - 新增 `favorites` view。
   - 使用 dashboard follows 渲染。
   - 支持取消收藏和空状态。

6. 顶部个人入口
   - 增加 popover 状态与样式。
   - 支持 hover、focus、移动端点击。
   - 个人按钮点击进入 `#/dashboard`。

7. 系统版本与更新日志
   - 新增 `VERSION` 和 `CHANGELOG.md`。
   - 后端 API 文档版本和 `/api/meta/` 读取统一版本号。
   - 前端展示版本号按钮，点击后打开更新日志小弹窗。
   - 更新日志小弹窗默认展示最新版本，历史版本通过版本号折叠菜单展开。
   - 增加版本一致性测试或检查脚本。

8. 测试与验收
   - 补前端 API wrapper 测试。
   - 补后端测试，仅在新增后端 API 时需要。
   - 使用浏览器进行端到端手动验收。

## 严格验收标准

### A. 首页视觉

- 桌面端 `127.0.0.1:5173/#/` 首屏可以看到筛选区和至少第一条课题的顶部内容。
- `探索前沿医学人工智能` 不再使用超大 hero 字号；桌面端不超过 `34px`，移动端不超过 `28px`。
- hero 上下间距明显收敛，不再出现 `100px` 级别 padding。
- 页面没有内联大段视觉样式，主要样式落在 `frontend/src/styles.css`。

### B. 课题列表

- 桌面、平板、手机视口下均为一行一个课题。
- 每条课题至少展示：标题、课题编号、主题、阶段、摘要、评分、收藏数、参与数、标签、所需角色。
- 至少展示一项结构化关键字段，如研究目标、数据需求或评价指标。
- 长标题和长摘要不会撑破布局。
- 点击卡片主体可以打开预览或详情。
- 点击收藏按钮不会触发卡片打开。

### C. 主题筛选

- 筛选区有“主题”下拉。
- 主题选项来自 `/api/meta/` 的 `themes`。
- 选择主题后请求 `/api/projects/` 时包含 `theme=<slug>`。
- 清空主题后请求不带 `theme` 或 `theme` 为空。
- 主题下拉与主题 chip 状态一致。
- 主题筛选可以和关键词、阶段、排序同时生效。

### D. 课题详情文件域

- 打开有主题的课题详情时，会展示该课题所属主题的文件域文件。
- 文件域内容来自 `/api/themes/{slug}/space/`。
- 至少展示文件分组、文件类型、标题、描述或路径。
- 详情页和预览弹窗展示逻辑一致。
- 课题原始 `documents` 不再被误当作主题文件域。
- 无主题或无文件时有明确空状态。
- “查看主题文件空间”可以跳转到 `#/space/:slug`。

### E. 收藏交互

- 列表页可收藏和取消收藏。
- 详情页可收藏和取消收藏。
- 预览弹窗可收藏和取消收藏。
- 收藏后按钮状态立即改变，并出现明确反馈。
- 取消收藏后按钮状态立即改变，并出现明确反馈。
- 刷新页面后收藏状态仍正确。
- 未登录点击收藏会提示登录或跳转登录。
- 收藏接口仍使用：
  - `POST /api/projects/{id}/follow/`
  - `POST /api/projects/{id}/unfollow/` 或 `DELETE /api/projects/{id}/unfollow/`

### F. 我的收藏页

- 存在 `#/favorites` 页面。
- 已登录用户可以看到自己收藏的课题列表。
- 页面数据优先来自 `/api/me/dashboard/` 的 `follows`。
- 每条收藏课题可打开预览或详情。
- 可在收藏页取消收藏。
- 取消收藏后页面列表同步更新。
- 没有收藏时有空状态。
- 未登录访问会进入登录流程。

### G. 顶部个人入口

- 鼠标悬停右上角用户入口时出现个人信息小窗。
- 键盘 focus 用户入口时也能出现小窗。
- 移动端点击用户入口可打开小窗。
- 小窗展示 UID、身份、机构、邮箱、积分或声誉中的主要信息。
- 点击用户入口进入 `#/dashboard`。
- 小窗内提供“我的收藏”入口。
- 小窗不遮挡退出按钮，不造成顶部导航拥挤。

### H. API 约束

- 本轮默认不新增后端 API；系统版本和更新日志也优先通过现有 `/api/meta/` 暴露。
- 必须复用现有：
  - `/api/meta/`
  - `/api/projects/`
  - `/api/projects/{id}/`
  - `/api/projects/{id}/follow/`
  - `/api/projects/{id}/unfollow/`
  - `/api/themes/{slug}/space/`
  - `/api/me/dashboard/`
  - `/api/me/`
- 如果执行中发现必须新增 API，需要先在文档中说明原因、请求/响应结构、为什么现有接口无法满足，并重新确认。

### I. 版本与更新日志

- 根目录存在 `VERSION`。
- 根目录存在 `CHANGELOG.md`。
- `VERSION` 内容符合 `MAJOR.MINOR.PATCH` 格式。
- `CHANGELOG.md` 顶部最新版本与 `VERSION` 完全一致。
- `frontend/package.json` 的 `version` 与 `VERSION` 完全一致。
- `/api/openapi.json` 的 `info.version` 与 `VERSION` 完全一致。
- `/api/meta/` 返回 `release.version`，且与 `VERSION` 完全一致。
- `/api/meta/` 返回 `release.latest`，至少包含最新版本号、日期和更新条目。
- `/api/meta/` 返回 `release.history`，用于展示历史版本号和展开后的历史更新内容。
- 前端页面可见当前版本号按钮。
- 点击版本号按钮打开小弹窗，不跳转页面。
- 小弹窗默认展示最新一个版本的更新情况。
- 小弹窗展示历史版本号列表。
- 点击历史版本号后，在同一个小弹窗内展开该版本的更新内容。
- 再次点击已展开的历史版本号，可以收起该版本内容。
- 不新增 `#/changelog` 路由，不把更新日志做成独立页面。
- 每次功能更新、缺陷修复或交付文档更新都必须同步更新 `VERSION` 和 `CHANGELOG.md`。
- 每个合并到 `dev` 的交付 PR 只能递增一次版本号。
- 版本递增必须遵守 `MAJOR.MINOR.PATCH` 规则：破坏性变更升 `MAJOR`，新功能升 `MINOR`，修复和文档型交付升 `PATCH`。
- `MINOR` 或 `MAJOR` 递增时，低位版本号必须归零。
- 禁止无说明跳号；版本检查脚本必须能发现 `VERSION`、`CHANGELOG.md`、`frontend/package.json` 或 API 版本不一致。

### J. 自动化与手动测试

执行完成后必须通过：

- `conda run -n openmedailab python manage.py test`
- `cd frontend && npm run build`
- `node --test frontend/src/api.test.js frontend/src/profileMenu.test.js frontend/src/release.test.js frontend/src/uiPlacement.test.js`
- `node --check frontend/src/main.js frontend/src/profileMenu.js frontend/src/release.js frontend/src/api.js`
- `python scripts/check_release_version.py`

如果当前本地环境没有可用 `npm` 或前端依赖未安装，需要记录 `npm run build` 未执行原因；合并前仍应在具备 Node/npm 依赖的环境补跑构建。缺少 npm 时，本地最低验收必须完成 Node 单元测试、前端语法检查、后端测试、版本一致性检查和浏览器手动验收。

如果新增前端工具函数，需要补 `frontend/src/api.test.js` 或新增对应测试。

版本功能需要补充测试：

- 后端测试确认 `/api/meta/` 返回版本号和更新日志摘要。
- 后端测试确认 `/api/openapi.json` 的 `info.version` 等于 `VERSION`。
- 前端测试或构建检查确认页面使用 `state.meta.release.version` 展示版本号按钮。
- 前端测试或手动验收确认版本号按钮打开小弹窗，小弹窗默认显示 `release.latest`。
- 前端测试或手动验收确认点击历史版本号可以展开并收起对应历史更新内容。
- 增加版本一致性检查，确认 `VERSION`、`CHANGELOG.md`、`frontend/package.json`、API 文档版本一致。

如果新增后端 API，需要补 `api/tests.py`，至少覆盖：

- 登录用户能获取收藏列表。
- 未登录用户不能获取收藏列表。
- 分页、排序或过滤行为。
- 取消收藏后列表同步。

浏览器手动验收必须覆盖：

- 未登录访问课题库。
- 登录普通用户访问课题库。
- 主题筛选。
- 课题列表收藏。
- 课题详情收藏。
- 预览弹窗收藏。
- 我的收藏页取消收藏。
- 详情页主题文件域展示。
- 顶部个人 hover 小窗。
- 版本号展示。
- 点击版本号后出现更新日志小弹窗。
- 小弹窗默认显示最新版本更新内容。
- 点击历史版本号后展开历史版本更新内容。
- 移动端窄屏布局。

## 风险与边界

- 当前 `GET /api/projects/` 不返回每个课题相对当前用户的 `viewer_state`，列表收藏状态需要通过 dashboard follows 合并。这个方案减少后端改动，但登录后首次进入列表可能需要额外一次 dashboard 请求。
- 当前 `GET /api/me/dashboard/` 没有分页。如果单个用户收藏大量课题，后续需要新增分页收藏 API。当前数据规模下先复用 dashboard，避免过早增加接口。
- 详情页加载主题文件域会多一次 `/api/themes/{slug}/space/` 请求。可以缓存最近加载的主题文件域，避免同一主题反复请求。
- 预览弹窗和详情页存在重复模板，执行时应尽量抽出小的渲染片段或共享状态函数，但不要为了本轮引入复杂组件体系。
- `CHANGELOG.md` 如果由后端解析，格式必须保持稳定。实现时只解析版本标题和 Added、Changed、Fixed 条目，不做复杂 Markdown 渲染，避免解析逻辑变成新的维护负担。
- 历史版本很多时，小弹窗需要限制高度并允许内部滚动，不能撑破页面。
- 版本号递增逻辑以“合并到 dev 的交付 PR”为单位，不能按本地每次 commit 递增，否则版本号会乱跳。

## 交付定义

本轮实现完成后，用户应能：

1. 在更紧凑的课题库首页快速看到课题列表。
2. 以一行一个的形式浏览课题关键字段。
3. 在筛选区按主题过滤课题。
4. 在课题详情和预览中看到所属主题文件域。
5. 在列表、详情、预览中收藏课题，并获得即时反馈。
6. 从右上角个人入口快速查看个人概要并进入个人相关页面。
7. 在“我的收藏”页面集中查看和管理已收藏课题。
8. 在系统页面看到当前版本号，并通过小弹窗查看最新版本更新日志，也可以按历史版本号展开查看过往更新。
