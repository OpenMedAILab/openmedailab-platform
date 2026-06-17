# 首页用户统计、主题下拉与状态颜色任务实现文档

日期：2026-06-17

目标分支：`codex/update-agents-doc`

关联基准文档：`AGENTS.md` 的 2.1、2.2、2.9、2.10、4.2、5.1、6、7.3、8、9。

## 1. 需求范围

本次任务只实现三个用户可见变化：

1. 在网站不起眼位置展示注册用户数和在线人数。
2. 首页主题入口收敛为不横向滚动的一行：第一个入口为“不限主题”，末尾入口关闭时为“展示全部主题”、展开时为“收起全部主题”，中间主题沿用原首页快捷主题逻辑；点击末尾入口后在主题栏下方展开下拉窗口，只展示第一行之外的主题并支持选择。
3. 课题卡片中的组队人数、阶段状态和资助状态用更明确的颜色区分：已招满角色换色；“进行中”和“已获资助”分别使用不同语义颜色。

非目标：

- 不展示用户名、邮箱、真实姓名或 UID 列表。
- 不新增公开用户列表、在线用户列表或访客追踪页面。
- 不改变课题生命周期、参与自动通过、认领自动通过、资助管理员审批等规则。
- 不恢复旧 `ProjectTask` 拆任务主流程。
- 不新增与已有筛选、阶段变更、资助状态同义的 API。
- 不新增动态岗位容量、AI 博士专门模型或自动启动/自动进入进行中的逻辑。

## 2. 产品口径

### 2.1 注册用户数

展示字段：`registered_user_count`。

统计口径：

- 统计 `UserProfile` 对应的已注册平台账号。
- 默认只统计 `user.is_active = true` 且已有 `UserProfile` 的账号。
- 包含平台管理员账号，因为它也是平台账号；如果后续产品要求对外排除管理员，必须同步更新本文档、API 测试和前端文案。

展示位置：

- 放在顶部 `account-area` 中版本按钮附近，以低对比度小字显示，例如 `注册 128 · 在线 6`。
- 在未登录和已登录状态都显示。
- 小屏允许换行或收缩，但不能挤压登录、个人菜单、版本按钮和主导航。

### 2.2 在线人数

展示字段：`online_user_count`。

统计口径：

- 在线人数定义为“最近 5 分钟内有请求活动的已登录注册用户”。
- 匿名访客不计入在线人数。
- 同一用户多个浏览器或多个会话只计 1 人。
- 统计窗口由后端返回 `online_window_seconds = 300`，前端不自行推断。

实现原则：

- 不用 Django session 过期时间直接当在线人数，因为 session 可能长时间有效，会明显高估。
- 不记录页面访问明细、IP、UA 或敏感内容；只更新聚合统计所需的最近活跃时间。
- 为避免每次请求都写库，活跃时间更新应做节流：同一用户距上次记录不足 60 秒时不更新。
- 不把 `last_seen_at` 放入 `/api/me/`、用户管理详情或资料编辑响应；在线状态只通过 `/api/meta/` 暴露聚合数字。

## 3. 后端设计

### 3.1 数据模型

文件：`accounts/models.py`

新增字段：

```python
last_seen_at = models.DateTimeField(null=True, blank=True, db_index=True)
```

配套动作：

- 生成迁移文件，例如 `accounts/migrations/00xx_userprofile_last_seen_at.py`。
- 字段可空，保证历史用户和现有数据无需回填即可迁移。
- `AGENTS.md` 的 5.1 需要补充 `last_seen_at` 是在线人数聚合字段。
- `last_seen_at` 不进入 `profile_payload`、`admin_user_detail_payload`、公开课题 payload、审计快照或任何前端用户详情展示。

### 3.2 活跃时间中间件

文件：`api/middleware.py`

新增 `LastSeenMiddleware`：

- 只处理 `request.user.is_authenticated` 的请求。
- 读取 `request.user.profile.last_seen_at`。
- 若为空或早于当前时间 60 秒以上，则更新为 `timezone.now()`。
- 使用 `UserProfile.objects.filter(pk=profile.pk).update(last_seen_at=now)`，避免触发不必要的 model save 副作用。
- 不对匿名访客写任何记录。

文件：`config/settings.py`

中间件顺序：

- 必须放在 `django.contrib.auth.middleware.AuthenticationMiddleware` 之后。
- 建议放在 `api.middleware.PasswordChangeRequiredMiddleware` 之后或之前都可，但文档验收要求强制改密用户访问允许 API 时也能刷新在线状态；若放在之后，被拦截的请求不会刷新。
- 推荐顺序：`AuthenticationMiddleware` 后、`PasswordChangeRequiredMiddleware` 前。

审计说明：

- `last_seen_at` 是请求派生的在线状态心跳，不属于业务写操作，不写 `AuditLog`。
- 这个例外需要在实现 PR 说明中说明；如产品要求审计所有心跳，会产生大量噪声，不推荐。

### 3.3 平台统计 API

文件：`api/ninja_api.py`

复用现有公共 API：`GET /api/meta/`。

新增返回字段：

```json
{
  "platform_stats": {
    "registered_user_count": 128,
    "online_user_count": 6,
    "online_window_seconds": 300
  }
}
```

统计实现：

```python
registered_user_count = UserProfile.objects.filter(user__is_active=True).count()
online_since = timezone.now() - timedelta(seconds=300)
online_user_count = UserProfile.objects.filter(
    user__is_active=True,
    last_seen_at__gte=online_since,
).count()
```

注意事项：

- `/api/meta/` 已经是首页启动时必取的公共元数据，新增聚合字段不会暴露个人信息。
- 不新增 `/api/platform-stats/`，避免重复 API。
- 需要在 `AGENTS.md` 的 4.2 说明 `/api/meta/` 包含平台统计。
- `/api/meta/` 只返回聚合数字，不返回用户列表、UID、邮箱、真实姓名、IP、UA、访问明细或 `last_seen_at`。

## 4. 前端设计

### 4.1 顶部不起眼统计

文件：`frontend/src/main.js`

状态：

- `state.meta.platform_stats` 由 `api.meta()` 直接带回。
- `state.meta` 初始值要补 `{ platform_stats: { registered_user_count: 0, online_user_count: 0, online_window_seconds: 300 } }`，避免启动前模板读取 undefined。
- 新增辅助函数：
  - `platformStats()` 或 computed，提供默认值 `{ registered_user_count: 0, online_user_count: 0 }`。
  - `compactCount(value)` 可选，用于超过 9999 时显示 `1.2万`，但测试必须覆盖原始数字仍来自 API。

模板位置：

- 在 `<div class="account-area">` 内，紧邻版本按钮：

```html
<span class="site-micro-stats" aria-label="平台统计">
  注册 {{ platformStats.registered_user_count || 0 }} · 在线 {{ platformStats.online_user_count || 0 }}
</span>
```

样式：

- 文件：`frontend/src/styles.css`
- 新增 `.site-micro-stats`：
  - 12px 或更小的次要文本。
  - 使用 `var(--muted)` 或更低对比度但仍满足可读性。
  - `white-space: nowrap`，小屏在 `.account-area` 中可换行，不遮挡按钮。

### 4.2 首页主题入口一行与展示全部主题下拉

当前代码位置：

- `frontend/src/main.js` 中首页模板 `theme-strip topic-theme-strip`。
- `topicThemeCards(state.meta.themes)` 负责生成图片主题卡片，需要沿用原首页快捷主题排序逻辑。
- `frontend/src/uiPlacement.test.js` 需要断言首个“不限主题”、末尾“展示全部主题/收起全部主题”切换、下拉只展示第一行之外主题和单行无横向滚动布局。
- `frontend/src/styles.css` 当前 `.topic-theme-strip` 是 `grid` 且 `auto-fit`，需要改为单行布局。

目标交互：

- 主题栏只保留一行。
- 第一个入口固定显示“不限主题”，用于清空主题筛选。
- 中间入口沿用原首页快捷主题展示逻辑，不把全部主题都塞入首行。
- 最后一个入口关闭时显示“展示全部主题”，展开时显示“收起全部主题”。
- 点击“展示全部主题”后，在主题栏下方展开下拉窗口。
- 下拉窗口只展示第一行之外的启用主题，按 `topicThemeCards` 的原排序展示；下拉内不重复“不限主题”和首行快捷主题，各主题按钮必须与首页主题卡按钮视觉一致。
- 点击任一主题：
  - 设置 `state.filters.theme = theme.slug`。
  - 调用现有 `applyFilters()`。
  - 关闭下拉。
- 按 `Escape` 关闭下拉。
- 切换路由时关闭下拉。

推荐实现：

- `state.themeDropdownOpen = false`。
- computed：
  - `homeThemeCards = computed(() => topicThemeCards(state.meta.themes))`
  - `homeThemeRowThemes = computed(() => homeThemeCards.value.slice(0, 4))`
  - `homeThemeDropdownThemes = computed(() => homeThemeCards.value.slice(4))`
  - `homeThemeRowColumnCount = computed(() => homeThemeRowThemes.value.length + 2)`
- 函数：
  - `toggleThemeDropdown()`
  - `closeThemeDropdown()`
  - `selectTheme(slug = "")` 内部最后调用 `closeThemeDropdown()`。
- `closeRouteScopedOverlays()` 中补充关闭主题下拉。
- `handleKeydown()` 中补充 `Escape` 关闭主题下拉，优先级低于确认弹窗和业务弹窗。

模板结构建议：

```html
<div class="theme-strip topic-theme-strip single-row" :style="{ '--home-theme-columns': homeThemeRowColumnCount }">
  <button
    class="theme-chip topic-theme-card theme-action-card all-projects-theme-trigger"
    :class="{ active: !state.filters.theme }"
    :style="topicThemeCardStyle()"
    type="button"
    @click="selectTheme('')"
  >
    <span>不限主题</span>
  </button>
  <button
    v-for="theme in homeThemeRowThemes"
    :key="theme.slug"
    class="theme-chip topic-theme-card"
    :class="{ active: state.filters.theme === theme.slug }"
    :style="topicThemeCardStyle(theme)"
    type="button"
    @click="selectTheme(theme.slug)"
  >
    <span>{{ theme.name }}</span>
  </button>
  <button
    class="theme-chip topic-theme-card theme-action-card all-themes-trigger"
    :class="{ active: state.themeDropdownOpen }"
    :style="topicThemeCardStyle()"
    type="button"
    aria-haspopup="listbox"
    :aria-expanded="state.themeDropdownOpen ? 'true' : 'false'"
    @click="toggleThemeDropdown"
  >
    <span>展示全部主题</span>
  </button>
</div>
<div v-if="state.themeDropdownOpen" class="theme-dropdown" role="listbox" aria-label="全部主题">
  ...
</div>
```

样式要求：

- `.topic-theme-strip.single-row` 使用单行 grid，列数由 `--home-theme-columns` 控制，不使用 `overflow-x: auto`。
- 小屏 `@media (max-width: 640px)` 中不能把 `.topic-theme-strip.single-row` 改回换行或横向滚动；需要用更具体选择器覆盖现有 `.theme-strip` 规则。
- 主题入口有稳定高度，避免图片或文字改变行高。
- 下拉按钮使用 `topic-theme-card` 和 `topicThemeCardStyle(...)`，不得退回普通文本列表按钮。
- `.theme-dropdown` 最大高度固定，内容超出内部滚动。
- 下拉层级低于确认弹窗和业务弹窗，高于普通卡片。
- 小屏宽度为容器宽度，主题按钮仍在一行内等分压缩；下拉不遮挡顶部导航。

### 4.3 组队、阶段和资助颜色

当前代码位置：

- `projects/models.py` 的 `Project.team_status.required_roles` 已返回医生、学生、博士毕业及以上、Leader 的 count/ready。
- `frontend/src/main.js` 的 `DEFAULT_PROJECT_RECRUITMENT_ROLES` 当前前端展示“医生、学生、AI博士及以上、项目负责人”。
- `requiredTeamRoles()` 会读取后端 `required_roles` 或 visible groups。
- `frontend/src/styles.css` 已有 `.project-role-groups span.ready`，但颜色需更明确且纳入验收。
- 首页列表和用户空间收藏/任务中的课题卡片存在相似渲染块，阶段 chip、资助 chip、组队 role chip 两处都必须同步修改。

目标展示：

- 未满足：中性背景，例如浅灰或浅蓝灰。
- 已满足：成功语义颜色，例如绿色或青绿色。
- `进行中` 阶段：阶段语义颜色，例如蓝色，不与“已获资助”共用同一颜色。
- `已获资助`：资助语义颜色，例如金色或暖色，不与“进行中”和“招满”共用同一颜色。

模板调整建议：

```html
<span class="project-stage-chip" :class="projectStageTone(project)">
  {{ project.stage_label }}
</span>
<span class="project-funding-chip" :class="{ funded: projectFundingReady(project) }">
  {{ projectFundingLabel(project) }}
</span>
```

新增辅助函数：

- `projectStageTone(project)`：
  - `active` -> `stage-active`
  - `team_building` -> `stage-team-building`
  - `open_recruiting` -> `stage-open`
  - `paused` -> `stage-paused`
  - fallback -> `stage-default`
- `projectFundingReady(project)` 保持现有语义，但要确认只把 approved sponsor 计为已资助。

后端注意：

- `Project.team_status.sponsor_count` 当前只统计 approved sponsor。
- `interactions/services.py` 的 `project_stat_annotations()` 当前 `sponsor_count=Count("sponsor_intents", distinct=True)` 可能包含 pending/rejected。前端优先使用 `project.team_status.sponsor_count`，不要用顶层 `sponsor_count` 判断“已获资助”。
- 如实现时调整顶层 `sponsor_count` 语义，必须同步更新 API 测试和文档。
- “AI博士及以上”当前是前端展示别名，后端统计来源是 `mentor` / `博士毕业及以上` 角色，不是独立的 AI 能力模型；除非另开需求，不新增角色模型或岗位容量字段。
- “最低团队已满足 + 已获资助”只能表示可进入下一步管理判断，不能自动把课题阶段改为 `active`。

颜色红线：

- 不用颜色作为唯一信息；文字 `0/1`、`1/1`、`进行中`、`已获资助` 必须保留。
- 不使用高饱和大面积色块影响卡片扫描。
- 颜色名称以语义类表达，不以具体颜色名表达，例如 `.stage-active`、`.funded`、`.ready`。

## 5. 测试计划

### 5.1 后端测试

文件：`api/tests.py`

新增或扩展测试：

1. `/api/meta/` 返回 `platform_stats`：
   - 包含 `registered_user_count`、`online_user_count`、`online_window_seconds`。
   - `online_window_seconds` 等于 300。
   - 注册用户数只统计 active user profile。
2. 在线人数统计：
   - `last_seen_at` 在 5 分钟内的 active 用户计入。
   - `last_seen_at` 早于 5 分钟的不计入。
   - inactive 用户不计入。
   - `last_seen_at` 不出现在 `/api/me/`、profile payload、管理员用户详情 payload。
3. `LastSeenMiddleware`：
   - 登录用户请求 API 后更新自己的 `last_seen_at`。
   - 匿名请求不创建或更新 profile。
   - 上次更新时间距当前不足 60 秒时不重复写库；可用时间冻结或 mock 验证。
4. 资助计数语义：
   - pending sponsor 不让前端判断为 `已获资助`。
   - approved sponsor 才让 `team_status.sponsor_count > 0`。

### 5.2 前端静态与单元测试

文件：`frontend/src/uiPlacement.test.js`

需要改动旧断言：

- 断言存在首个 `class="theme-chip topic-theme-card theme-action-card all-projects-theme-trigger"` 和文案“不限主题”。
- 断言末尾入口文案可在“展示全部主题”和“收起全部主题”之间切换。
- 断言存在 `FEATURED_TOPIC_THEMES`、`topicThemeMatchesPreset` 和 `homeThemeCards.value.slice(0, 4)`，确保中间主题沿用原快捷主题逻辑。
- 断言存在 `homeThemeDropdownThemes = computed(() => homeThemeCards.value.slice(4))`，确保下拉不重复第一行主题。
- 断言不存在 `sortThemesByInitial`。
- 断言下拉内存在 `theme-dropdown-card`，且不再出现 `theme-dropdown-item`。
- 旧断言 `.topic-theme-strip` 使用 `grid-template-columns: repeat(auto-fit...)` 要改为单行 grid，且当前规则块内不得有 `overflow-x: auto`。

新增断言：

- 存在 `state.themeDropdownOpen`。
- 存在 `toggleThemeDropdown`、`closeThemeDropdown`。
- `selectTheme` 会关闭主题下拉。
- `handleKeydown` 能在 Escape 时关闭主题下拉。
- 模板中存在 `aria-haspopup="listbox"` 和 `aria-expanded`。
- 样式中存在 `.theme-dropdown`，且有 `max-height` 和 `overflow-y: auto`。
- 小屏样式中存在对 `.topic-theme-strip.single-row` 的 nowrap 覆盖，防止旧 `.theme-strip` 媒体查询把它改回换行。
- 存在 `.site-micro-stats`，并引用 `platform_stats`。
- 阶段 chip 和资助 chip 使用不同 class：`.project-stage-chip`、`.project-funding-chip`。
- 存在 `.project-stage-chip.stage-active` 和 `.project-funding-chip.funded`。
- 组队已满足仍有 `.project-role-groups span.ready`，且样式区别于未满足。

文件：`frontend/src/api.test.js`

- 如果 API wrapper 对 `meta` 有结构断言，补充 `platform_stats`。

文件：`frontend/src/release.test.js`

- 如版本号和更新日志结构调整，保持 release 测试通过。

### 5.3 浏览器验收

桌面宽度约 1440px：

- 打开首页，顶部版本按钮附近显示 `注册 N · 在线 M`，位置低调，不抢占主导航。
- 首页主题栏只有一行。
- 第一项是“不限主题”。
- 最后一项关闭时是“展示全部主题”，展开后变为“收起全部主题”。
- 点击“展示全部主题”，主题下拉在主题栏下方展开，只展示第一行之外的主题。
- 下拉中的“不限主题”和各主题按钮与主题卡按钮视觉一致。
- 点击某个主题后项目列表按该主题筛选，下拉关闭。
- 再次点击“收起全部主题”后下拉关闭；点击第一行“不限主题”后恢复全量课题。
- 中间主题沿用原首页快捷主题逻辑。
- 课题卡片里某角色为 `1/1` 时颜色明显不同于 `0/1`。
- `进行中` 阶段和 `已获资助` 使用不同颜色。

小屏宽度约 390px：

- 顶部统计不遮挡品牌、导航、登录或个人菜单。
- 主题栏仍是一行，不出现横向滚动条。
- 主题下拉宽度不超出页面，内容超出时内部滚动。
- 课题卡片文字不溢出、不互相覆盖。
- 颜色变化保留文字，不依赖颜色才能理解。

登录态：

- 登录后刷新首页，在线人数在统计窗口内能包含当前用户。
- 强制改密用户访问允许 API 时不会破坏页面启动。

## 6. 发布与文档更新

本次是用户可见的新功能和 UI 调整，按 `AGENTS.md` 版本规则应更新：

1. `VERSION`
2. `CHANGELOG.md`
3. `/api/meta/` release 信息随版本读取自动生效
4. 前端版本弹窗内容
5. `AGENTS.md`

`AGENTS.md` 需要补充：

- 2.1：用户资料模型增加 `last_seen_at` 和在线人数统计。
- 2.2 或 2.9：首页主题下拉和课题卡片状态颜色属于前端入口。
- 4.2：`/api/meta/` 返回 `platform_stats`。
- 5.1：`UserProfile.last_seen_at` 的用途。
- 9.2：浏览器验收增加顶部统计、主题下拉、状态颜色。

建议版本：

- 当前如仍为 `0.7.x`，本次属于用户可见功能新增，建议提升到下一个 minor，例如 `0.8.0`。
- 如果实际实现时已存在更高版本，以当前 `VERSION` 为准递增。

## 7. 实施顺序

1. 后端补 `UserProfile.last_seen_at` 字段和迁移。
2. 后端补 `LastSeenMiddleware` 并调整 `MIDDLEWARE` 顺序。
3. 后端扩展 `/api/meta/` 的 `platform_stats`。
4. 后端补 API 与在线统计测试。
5. 前端在 `state.meta` 和顶部 `account-area` 展示低调统计。
6. 前端把首页主题卡片改为首个“不限主题”、中间沿用原快捷主题逻辑、末尾“展示全部主题”的无横向滚动单行入口。
7. 前端补下拉关闭逻辑：选择、Escape、路由切换。
8. 前端拆分阶段 chip、资助 chip 和组队 ready chip 的语义 class。
9. 更新 `frontend/src/uiPlacement.test.js` 和必要的 API/release 测试。
10. 更新 `VERSION`、`CHANGELOG.md`、`AGENTS.md`。
11. 跑完整验收命令和浏览器验收。

## 8. 必跑命令

代码实现完成后必须运行：

```bash
conda run -n openmedailab python manage.py makemigrations --check --dry-run
conda run -n openmedailab python manage.py check
conda run -n openmedailab python manage.py test
node --test frontend/src/*.test.js
node --check frontend/src/main.js
git diff --check
```

如果实现过程中新增 migration，第一次生成迁移后再运行：

```bash
conda run -n openmedailab python manage.py makemigrations accounts
conda run -n openmedailab python manage.py migrate
```

文档单独验收命令：

```bash
git diff --check
rg -n 'TO[D]O|TB[D]|FIX[M]E|待[定]|不确[定]' docs/homepage-platform-stats-theme-dropdown-status-colors-plan.md
```

## 9. 验收标准

### 9.1 功能验收

- 首页或全站顶部能看到注册用户数和在线人数。
- 统计只展示聚合数字，不展示任何个人身份信息。
- 在线人数按最近 5 分钟活跃登录用户统计，同一用户只计 1 人。
- 首页主题入口视觉上只有一行。
- 首页主题入口不出现横向滚动条。
- “展示全部主题”入口可打开和关闭。
- 下拉中只展示第一行以外的启用主题，且按钮视觉与主题卡按钮一致。
- 选择主题后列表筛选生效，下拉关闭。
- 清空主题筛选后列表恢复全量公开课题。
- 组队角色 `0/1` 和 `1/1` 有明确视觉差异。
- `进行中` 与 `已获资助` 的颜色不同，且都保留文字。

### 9.2 安全与隐私验收

- `/api/meta/` 不返回用户列表、UID 列表、邮箱、真实姓名、IP 或 UA。
- 匿名访客不会产生在线状态记录。
- `last_seen_at` 不写入审计日志，避免审计噪声。
- 强制改密拦截不影响 `/api/meta/` 获取公共统计。
- `last_seen_at` 不出现在任何用户资料、管理员用户详情或审计摘要响应中。

### 9.3 兼容性验收

- 草稿和归档课题仍不进入公开列表。
- 参与和认领仍自动通过。
- 资助仍由管理员审批。
- pending/rejected 资助不显示为已获资助。
- 团队满足且已获资助不会自动改变课题阶段。
- 旧任务接口不进入首页或主导航。
- 前端所有请求仍通过 `frontend/src/api.js` 的统一封装。

### 9.4 UI 验收

- 桌面和小屏均无文字溢出、遮挡或按钮被覆盖。
- 主题下拉层级低于确认弹窗，高于项目卡片。
- 顶部统计不改变主导航可用性。
- 状态颜色符合语义，不形成单一色系堆叠。
- 首页列表和用户空间列表中的课题卡片状态颜色一致。

## 10. 严格校验清单

实现前：

- 已确认当前分支正确。
- 已读 `AGENTS.md`。
- 已确认复用 `/api/meta/`，不新增重复统计 API。
- 已确认需要数据库迁移。
- 已确认需要版本和更新日志。

实现中：

- `last_seen_at` 更新节流，避免每个请求写库。
- 在线人数只统计 active user profile。
- `last_seen_at` 只用于聚合统计，不进入用户 payload。
- 前端不直接 `fetch`。
- 主题下拉关闭逻辑覆盖选择、Escape、路由切换。
- 颜色 class 使用语义命名。
- 首页列表和收藏/任务区的课题卡片展示同步修改。

完成前：

- 后端、前端、文档测试命令全部执行并记录结果。
- 桌面和小屏浏览器验收完成。
- `AGENTS.md` 与实际实现同步。
- 若有未执行命令，最终说明原因。

## 11. 独立 agent 校验结论

已调用独立校验 agent 做只读审查，结论如下：

- 复用 `/api/meta/` 新增 `platform_stats` 是合适方案，不建议新增重复统计 API。
- 在线人数必须明确为“最近 5 分钟活跃的已登录用户数”，不能用 session 过期时间代替。
- `last_seen_at` 是隐私字段，只能用于聚合统计，不能进入 profile、管理员用户详情、审计摘要或公开 payload。
- 首页主题区从图片卡片网格调整为“一行 + 展示全部主题下拉”时必须同步改掉 `uiPlacement.test.js` 中旧的 grid 布局断言。
- 小屏媒体查询当前会让 `.theme-strip` 换行，实现时必须用更具体选择器保持主题栏单行且不横向滚动。
- 课题卡片至少有首页列表和用户空间列表两处相似渲染块，状态颜色改动必须两处同步。
- “AI博士及以上”当前是前端别名，后端统计来源是 `mentor` / `博士毕业及以上`，不应因此新增角色模型。
- pending/rejected 资助不能显示为“已获资助”；前端判断应优先使用 `project.team_status.sponsor_count`。
- 团队满足且已获资助不能暗示自动进入进行中，课题进入 `active` 仍由管理员显式操作。
