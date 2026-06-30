# 课题卡片紧凑化与“我的角色”高亮设计稿

日期：2026-06-20
范围：首页课题库卡片为主，兼顾复用同一组队 chip、按钮与状态样式的收藏课题卡片和课题进度页。
状态：设计稿与执行方案，尚未进入代码实现。

## 多 Agent 审批结论

审批时间：2026-06-20
审批方式：3 个只读子 agent 并行审阅，分别覆盖产品/需求一致性、视觉/UX/可访问性、工程实现/测试风险。

综合结论：Approved with required changes。

必须纳入实现计划的硬要求：

1. 移动端和窄屏交互按钮的实际渲染高度不得低于 44px；当前代码在部分断点存在 42px、40px、38px 的覆盖，实施时必须修正并测试。
2. `viewer_state.team_role_keys` 不能只复用现有 `interest_team_role_key`；必须额外处理 `interest.role == Leader` 映射到 `leader`，并处理 active 项目负责人认领。
3. 前端必须保留 fallback 映射；本地乐观更新目前只更新 `interest_roles` 和 `claim_types`，如果只读新后端字段，“我的角色”不会在参与/认领后立即刷新。
4. 首页卡片缩窄只能作用于首页课题库卡片，不得通过全局 `.project-grid` 误伤收藏页。
5. 组队 chip 的 `self-role` class 必须接入首页、收藏页和课题进度页三处模板，避免深链进入详情/进度页时视觉状态不一致。
6. `self-role` 和 `self-role + overfilled` 都必须提供明确 `aria-label`，不能依赖 `title` 作为可访问性兜底；可聚焦 chip 必须有清晰 `:focus-visible` 焦点环。
7. 金色语义必须收口：金色只用于“我的关系/我的角色”；普通超员、资助按钮和非本人“已获资助”状态不得再使用 amber/gold。
8. 测试必须同步移除旧 sponsor 黄色断言，并新增 red/gold/teal 的 computed-style 断言和截图。
9. 实现阶段若新增 API payload 或用户可见 UI 调整，必须同步更新 `VERSION`、`CHANGELOG.md` 和 `AGENTS.md`。

## UI 方案复审修订记录

复审时间：2026-06-20

本轮按 `ui-ux-pro-max` 的可访问性、触控、响应式与语义色规则复审后，追加以下修订：

1. 卡片底部所有按钮形态控件都纳入触控高度验收，不只检查 `.project-interaction-actions button`，还包括 `查看PDF/下载PDF` 这类 `.project-pdf-actions .ghost-button` 链接。
2. 组队 chip 增加 `:focus-visible` 焦点环要求，截图和自动化验收要能证明键盘用户看得见当前焦点。
3. 课题进度页也要接入 `requiredTeamRoles(project.team_status, project)`、`self-role` 和 `aria-label`，保证从首页卡片进入详情/进度页后的状态一致。
4. `1920x1080` 宽屏从建议视口升级为必验截图，防止卡片收窄后在宽屏上漂浮或比例异常。

## Design Read

这是一个医学 AI 协作平台的课题列表 UI，不是营销页。设计语言应继续保持当前白底、低饱和青绿色操作态、金色个人关系提示的产品风格，但把卡片从“展示型大卡”收紧为“研究课题列表型大卡”：信息仍完整，阅读路径更短，状态颜色更语义化。

视觉密度目标：当前约 4/10，调整到 6.5/10。
交互目标：不牺牲按钮触控尺寸，不引入只能靠 hover 才能理解的信息。
可访问性目标：颜色变化必须保留文字计数与状态含义，不能只靠颜色表达。

## 当前代码与 UI 逻辑

关键代码位置：

- `frontend/src/main.js`
  - 首页课题卡：`project-card project-list-card project-catalog-card`
  - 个人关系角标：`project-card--self-related`、`self-relation-corner`、`self-relation-inline-chip`
  - 组队角色：`requiredTeamRoles(project.team_status)`，目前只返回 `ready`、`overfilled` 等状态
  - 资助按钮：`sponsor-action-button`，当前有单独黄色样式
- `frontend/src/styles.css`
  - 卡片尺寸：`.project-card`、`.project-list-card`、`.project-card-bottom`、`.project-card-footer`
  - 角色 chip：`.project-role-chip-row > span`、`.ready`、`.overfilled`
  - 资助按钮黄色覆盖：`.project-interaction-actions .sponsor-action-button`、`.sponsor-action-button.interaction-active`
- `projects/models.py`
  - `Project.team_status.required_roles` 已提供 `key/label/count/required/ready/overfilled/status`
- `api/ninja_api.py`
  - `viewer_state` 当前提供 `interest_roles`、`claim_types`、`sponsor_types`，但没有直接提供当前用户对应的组队角色 key

现状判断：

- 整卡“这是我的课题关系”已经有金色斜角、金色顶线和二级金色小标签。
- 组队角色 chip 目前只知道“满足/超员/缺失”，不知道“这个角色是否对应我”。
- 学生 `2/1` 这类超员状态目前使用黄色，容易和“我的关系”金色混淆。
- “管理资助”按钮独立使用黄色，抢占了“我的关系”颜色语义，也和其他互动按钮不一致。

## 用户需求拆解

1. 课题卡片整体更窄、更紧凑。
2. 卡片内部内容之间的间距收紧，但不能拥挤或重叠。
3. 组队角色超员，例如“学生（实验） 2/1”，不再使用独立颜色，只保留 `2/1` 计数，并按普通已满足角色视觉展示。
4. 如果某个组队角色是“我”对应的角色，该角色 chip 使用当前个人关系系统里的金色。
5. “我的角色”逻辑适用于医生、学生、博士毕业及以上指导、项目负责人等所有角色。
6. “管理资助”按钮改成和其他互动按钮一样的颜色体系。
7. 验收以截图为主。

## 方案对比

### 方案 A：只改 CSS 颜色与间距

做法：

- 删除 `.overfilled` 的独立颜色覆盖，让超额角色沿用普通已满足角色视觉。
- 直接删除资助按钮的黄色 CSS。
- 调小卡片 padding/gap/font-size。

优点：最快，风险低。
缺点：无法实现“我的角色 chip 金色”，因为模板没有这个状态。
结论：不满足核心需求。

### 方案 B：前端派生“我的角色 key”

做法：

- 用 `viewer_state.interest_roles`、`viewer_state.claim_types` 和当前用户 `profile.role_type` 在前端推导 `self_team_role_keys`。
- `requiredTeamRoles(project.team_status, project)` 返回每个角色的 `isSelfRole`。
- 模板新增 `self-role` class。

优点：不改后端接口，实施快。
缺点：角色映射规则会散落在前端，和后端已有 `interest_team_role_key` 逻辑可能长期漂移。
结论：适合作为短期补丁，不适合作为稳定主方案。

### 方案 C：后端补充稳定角色信号，前端负责展示

做法：

- 后端在 `viewer_state` 中新增 `team_role_keys`，例如 `["mentor"]`、`["student"]`、`["leader"]`。
- 规则复用后端已有的参与角色与用户身份映射逻辑。
- 前端只判断 `role.key` 或 alias 是否在 `viewer_state.team_role_keys` 中。
- CSS 新增 `self-role` 和 `self-role overfilled` 组合态。

优点：状态来源稳定，前后端职责清晰，后续详情页/状态卡也能复用。
缺点：需要改 API payload 和相关测试。
推荐：采用方案 C。若需要极快上线，可先按方案 B 做小步实现，但最终仍应收敛到方案 C。

## 推荐设计

### 1. 卡片宽度与密度

桌面端首页课题卡不再横向铺满所有可用宽度。只对首页课题库卡片生效：

- 使用 `.project-catalog-card` 或首页专属 wrapper 控制视觉宽度，宽度控制在 `1080px - 1120px` 并居中展示。
- 不通过全局 `.project-grid` 设置宽度，因为收藏页也使用 `.project-grid`。
- 不改变移动端 `100%` 宽度，不造成横向滚动。
- 卡片 padding 从 `20px` 收至 `16px`，小屏保持 `14px - 16px`。
- `.project-list-card` gap 从 `18px` 收至 `12px`。
- `.project-list-main/.project-card-body` gap 从 `10px` 收至 `8px`。
- 标题字号从 `21px` 收至 `19px - 20px`，保持 `line-height: 1.32 - 1.35`。
- 摘要区 `.project-expanded-detail` gap 从 `12px` 收至 `8px`，顶部 padding 从 `4px` 改为 `0`。
- 三个字段框 padding 从 `10px` 收至 `8px`，正文行高从 `1.5` 收至 `1.42 - 1.48`。
- tag 行 `margin: 14px 0` 收至 `8px 0 4px`，gap 从 `8px` 收至 `6px`。
- 状态框 `.project-card-bottom` padding 从 `8px 10px` 收至 `7px 8px`，gap 从 `6px` 收至 `4px`。
- footer 顶部分隔仍保留，但 `padding-top` 从 `14px` 收至 `10px`，按钮区域 gap 维持 `8px`。

禁止项：

- 不把按钮形态控件高度压低到 44px 以下。
- 修正现有 `980px/640px/380px` 断点下互动按钮低于 44px 的覆盖，所有 `.project-interaction-actions button` 渲染高度必须 `>=44px`。
- 同步检查 `.project-pdf-actions .ghost-button`、`.pdf-view-link` 和 `.pdf-download-link`，这些链接虽然不是 `button` 元素，但属于卡片底部触控目标，实际渲染高度也必须 `>=44px`。
- 不隐藏关键状态行。
- 不用负 margin 或 transform 硬挤内容。
- 不改变移动端已经隐藏 `.project-expanded-detail` 的策略。

### 2. 组队角色 chip 颜色语义

新增语义优先级：

1. 缺失：灰白底，维持当前默认样式。
2. 已满足：浅青绿色，维持当前 `ready` 样式。
3. 超员：不单独配色，继续通过 `2/1` 计数表示人数超过要求。
4. 我的角色：金色，表示该角色和当前登录用户有关。

推荐颜色：

| 状态 | 背景 | 边框 | 文字 |
| --- | --- | --- | --- |
| 默认 | `#f7fafc` | `rgba(100, 116, 139, 0.18)` | `#5f7378` |
| ready | `#e8f7f4` | `rgba(15, 159, 154, 0.28)` | `#08766f` |
| self-role | `#fff4d2` | `rgba(217, 154, 24, 0.42)` | `#7a4c00` |

组合态规则：

- 普通 `overfilled` 不应有独立颜色覆盖，不再出现黄色、红色或额外蓝灰色。
- 普通 `self-role` 使用金色，和现有“我已参与/我已认领/我已资助”系统一致。
- 如果一个角色同时是 `self-role` 和 `overfilled`，视觉上按普通 `self-role` 金色展示，不为超额额外加色。
  - `aria-label` 补充“我的角色，人数已超过要求”

可访问性规则：

- 每个可聚焦的 `team-role-chip` 都要有 `aria-label`，至少包含角色名、当前人数、要求人数和状态。
- 普通 `self-role` 的 `aria-label` 必须包含“我的角色”。
- `self-role + overfilled` 的 `aria-label` 必须包含“我的角色，人数已超过要求”。
- 每个可聚焦的 `team-role-chip` 都要有清晰 `:focus-visible` 样式，建议使用 2px 青绿色或金色焦点环加 2px offset，且不能被 `overflow: hidden` 裁掉。
- 不使用 `title` 作为主要可访问性信息来源。

这样可以同时满足两件事：超员不再黄色，我的角色仍被突出。

### 3. “我的角色”数据规则

后端建议新增：

```json
"viewer_state": {
  "team_role_keys": ["mentor", "leader"]
}
```

映射规则：

- 当前用户有 active 参与关系：
  - `doctor` 身份或参与角色医生 -> `doctor`
  - 本科/硕士/博士在读或参与角色学生/其他兜底 -> `student`
  - 博士毕业及以上/大学老师 -> `mentor`
  - 参与角色 `Leader` -> `leader`
- 当前用户有 active 项目负责人认领：
  - `claim_type = leader` -> `leader`
- 当前用户只有论文第一单位认领或资助：
  - 不自动映射到组队四角色，除非当前用户同时有参与关系或项目负责人认领
  - 整卡仍通过斜角和二级标签显示“我已认领/我已资助”

active 口径沿用现有前端逻辑：`pending` 和 `approved` 都能体现“这是我的申请/关系”，但 `withdrawn/rejected` 不高亮。

前端建议：

- 新增 `selfTeamRoleKeys(project)`。
- `requiredTeamRoles(project.team_status, project)` 返回 `isSelfRole`。
- `selfTeamRoleKeys(project)` 优先读取 `viewer_state.team_role_keys`，同时保留从 `viewer_state.interest_roles`、`viewer_state.claim_types` 和当前用户 `profile.role_type` 推导的 fallback。
- fallback 是必需项，用于参与/认领成功后的本地乐观刷新，避免等待重新请求后才出现“我的角色”高亮。
- fallback 必须覆盖医生、学生、博士毕业及以上、参与角色 `Leader`、项目负责人认领。
- 模板 class 改为：

```vue
:class="{
  ready: role.ready,
  overfilled: role.overfilled,
  'self-role': role.isSelfRole
}"
```

### 4. 资助按钮颜色

资助按钮不再有独立黄色主色：

- 删除 `.project-interaction-actions .sponsor-action-button` 的黄色背景/边框/文字覆盖。
- 删除 `.sponsor-action-button.interaction-active` 的黄色激活态覆盖。
- 资助按钮默认使用 `.ghost-button.interaction-button` 白底样式。
- active 时使用现有 `.interaction-button.interaction-active` 青绿色样式。
- 金色只留给“我的关系”角标、关系小标签、我的角色 chip。
- 非本人“已获资助”项目状态不得继续使用 amber/gold；建议将 `.project-funding-chip.funded` 改为青绿或蓝绿状态色，例如浅青底配深青文字，避免和个人关系金色混淆。

视觉结果：

- “管理资助”按钮和“取消关注”“取消参与”“撤回论文第一单位认领”等按钮在同一按钮系统内。
- 用户仍能通过顶部金色“我已资助”识别个人关系，不需要按钮也变黄。

### 5. 信息层级

桌面端从上到下保持现有顺序：

1. 关系角标与 meta chip
2. 标题
3. 摘要
4. 三个结构字段
5. tag
6. 招募/组队/启动
7. 互动按钮与 PDF 操作

只收紧空间，不重排结构。原因：

- 当前测试已经覆盖关系角标与内容不重叠。
- 用户截图中的主要问题是尺度和状态颜色，不是信息顺序。
- 重排会增加审批、状态卡和移动端回归风险。

## 执行方案

### Step 1：补稳定状态来源

优先后端补 `viewer_state.team_role_keys`：

- 在 `api/ninja_api.py` 增加 `viewer_team_role_keys(user, project)`。
- 对齐 `interest_team_role_key` 的身份映射逻辑，但不要只复用它；必须额外把 `interest.role == ParticipationRole.LEADER` 加入 `leader`。
- active 项目负责人认领加入 `leader`。
- 论文第一单位认领和 sponsor-only 关系不自动加入四个组队角色。
- `viewer_state` payload 增加 `team_role_keys`。
- 更新 `api/tests.py`：登录用户参与/认领后能拿到正确 `team_role_keys`；撤回或拒绝后不返回；必须覆盖 `doctor/student/mentor/leader`、`Leader` 参与角色、active 项目负责人认领、sponsor-only 不返回角色、论文第一单位 only 不返回角色。
- 覆盖 `/api/projects/`、`/api/projects/{id}/`、`/api/projects/{id}/progress/` 和 `/api/projects/{id}/status-card/` 中的 `viewer_state` 口径。

### Step 2：前端角色派生

- `requiredTeamRoles(teamStatus, project)` 支持第二个参数，并在所有调用点传入 `project`。
- `matchedRequiredTeamRole` 继续兼容后端 `mentor` 和前端旧 alias `ai_phd_or_above`。
- 新增 `isSelfTeamRole(project, role)`，同时支持：
  - `viewer_state.team_role_keys`
  - 兼容旧 payload 的 `viewer_state.interest_roles` 和 `viewer_state.claim_types` fallback
- 首页、收藏页和课题进度页三处角色 chip 模板都接入 `self-role` class 与 `aria-label`。
- 课题进度页当前 `project-role-chip-row` 直接渲染 `<span>`，实现时需要统一调用 `requiredTeamRoles(state.projectProgress.project.team_status, state.projectProgress.project)`，并补齐 `team-role-chip` class、可访问名称和键盘焦点样式；如果决定保持不可聚焦展示，则必须改用非交互语义并通过邻近文本保留“我的角色/超员”含义。

### Step 3：CSS 颜色与密度

- 调整 `.project-card`、`.project-list-card`、`.project-card-body`、`.project-expanded-detail`、`.project-key-fields`、`.tag-row`、`.project-card-bottom`、`.project-card-footer` 的 spacing。
- 删除 `.project-role-chip-row > span.overfilled` 的独立颜色覆盖，超额角色沿用普通已满足视觉。
- 新增 `.project-role-chip-row > span.self-role`。
- 不新增 `.project-role-chip-row > span.self-role.overfilled` 组合态，超额不改变“我的角色”金色样式。
- 新增 `.project-role-chip-row > span:focus-visible` 或 `.team-role-chip:focus-visible`，焦点环必须可见且不造成布局跳动。
- 删除 sponsor button 黄色覆盖，让其回到通用按钮体系。
- `.project-funding-chip.funded` 从 amber/gold 改为非金色语义色。
- 修正窄屏断点下 `.project-interaction-actions button` 低于 44px 的覆盖。
- 修正 `.project-pdf-actions .ghost-button`、`.pdf-view-link`、`.pdf-download-link` 的触控高度，让卡片底部所有按钮形态控件实际渲染高度 `>=44px`。

### Step 4：测试更新

静态测试：

- `frontend/src/uiPlacement.test.js`
  - 更新 overfilled 断言：不再存在独立颜色覆盖。
  - 新增 `self-role` class 接线断言。
  - 更新 sponsor button 断言：不再匹配 amber 覆盖，匹配通用 active 样式。
  - 断言首页、收藏页和课题进度页三处模板都传入 `requiredTeamRoles(project.team_status, project)` 或等价的当前 project 对象。
  - 断言 `team-role-chip` 有 `aria-label`。
  - 断言 `team-role-chip` 有 `:focus-visible` 焦点环样式。
  - 断言移动端按钮断点不低于 `44px`，并把 PDF 查看/下载链接纳入按钮形态控件高度检查。
  - 更新紧凑 spacing 的关键断言，但避免断言过多像素细节。

浏览器/E2E：

- `frontend/e2e/project-core.spec.js`
  - 保留现有不重叠断言。
  - 新增截图采集目录。
  - 新增 overfilled standard、self-role gold、sponsor button unified 三类截图。
  - 新增 computed-style 断言：普通超员沿用普通已满足视觉、普通我的角色为金、我的角色且超员仍为金色、资助 active 按钮为通用青绿色。
  - 新增移动端互动按钮高度断言：所有卡片互动按钮和 PDF 查看/下载链接实际高度 `>=44px`。
  - 新增键盘焦点断言：Tab 到组队 chip 时焦点环可见，且 accessible name 包含角色名、计数和状态。

## 截图验收标准

截图目录建议：

```text
docs/qa/screenshots/project-card-compact-self-role-2026-06-20/
```

必验视口：

- `desktop-1440`: `1440x1000`
- `desktop-wide`: `1920x1080`
- `tablet`: `768x1000`
- `mobile`: `390x844`
- `mobile-small`: `360x740`

### 必须截图 1：桌面默认课题卡

文件：

```text
desktop-default-card-1440.png
```

验收：

- 首页课题卡在桌面居中，视觉宽度比当前更收敛，不能横向铺得过满。
- 截图旁或测试附件记录代表性卡片 bounding box 宽度，目标为 `1080px - 1120px` 区间或实现中定义的 max-width。
- 第一张代表性课题卡的标题、摘要、三字段、标签、组队区和按钮区都可见。
- 卡片留白明显少于当前截图，但文字不拥挤、不重叠。
- 三个结构字段仍为清晰的横向三列。
- 互动按钮与 PDF 查看/下载链接高度不低于 44px。

### 必须截图 1b：宽屏课题卡比例

文件：

```text
desktop-wide-card-1920.png
```

验收：

- 在 `1920x1080` 下首页课题卡仍居中，宽度保持在 `1080px - 1120px` 或实现定义的 max-width。
- 卡片不会因为过窄显得漂浮，左右留白与页面主体布局保持均衡。
- footer 按钮与 PDF 操作不被拉得过散，不出现异常换行。
- 组队 chip、meta chip、个人关系角标不重叠。

### 必须截图 2：超员角色不单独配色

文件：

```text
desktop-overfilled-role-standard.png
```

场景：

- 使用已有 E2E 数据中“学生（实验） 2/1”的课题。

验收：

- `学生（实验） 2/1` 与普通已满足角色视觉一致，不出现红色、黄色或其他独立超额配色。
- chip 仍只显示 `2/1` 计数，不追加“超额/超员”文字。
- 周围 `ready` 角色仍为浅青绿色或默认色，视觉体系不被额外超额颜色污染。

### 必须截图 3：我的角色金色

文件：

```text
desktop-self-role-gold.png
```

场景：

- 登录一个与课题有 active 参与或项目负责人认领关系的用户。
- 用户身份或参与关系映射到某个 required role，例如 `mentor`。

验收：

- 对应角色 chip，例如 `博士毕业及以上（指导） 0/1` 或 `1/1`，显示金色。
- 键盘 focus 到该 chip 时，可访问名称包含“我的角色”。
- 键盘 focus 到该 chip 时焦点环清晰可见，不能只靠浏览器默认弱 outline。
- 整卡顶部仍保留原有“我已参与/我已认领/我已资助”角标体系。
- 金色只出现在“我的关系/我的角色”上，不再用于普通超员。
- 其他非我的角色不被误高亮。

### 必须截图 4：我的角色且超员的组合态

文件：

```text
desktop-self-overfilled-role-dual-state.png
```

场景：

- 当前用户映射到一个已超员角色，例如学生 `2/1`。

验收：

- chip 主体按普通“我的角色”金色展示，不因超额额外改色。
- 键盘 focus 到该 chip 时，可访问名称包含“我的角色，人数已超过要求”。
- 键盘 focus 到该 chip 时焦点环清晰可见，并且不会遮挡“我的角色”主体语义。

### 必须截图 5：管理资助按钮统一颜色

文件：

```text
desktop-sponsor-button-unified.png
```

场景：

- 登录有 active 资助关系的用户，卡片按钮文案为 `管理资助` 或相关资助状态。

验收：

- 资助按钮颜色与其他 active 互动按钮一致，为青绿色体系。
- 不出现黄色/琥珀色 sponsor button。
- 金色“我已资助”关系提示仍在 meta 区或角标中出现。
- 非本人但已获资助的项目状态 chip 不使用金色。
- 点击后 sponsor popover 仍贴近按钮，不超出视口。

### 必须截图 6：移动端紧凑与换行

文件：

```text
mobile-card-390.png
mobile-card-360.png
```

验收：

- 页面无横向滚动。
- 课题标题、组队 chip、按钮文字不溢出父容器。
- 组队 chip 可以自然换行。
- 操作按钮保持两列或一列响应式，不重叠。
- 所有互动按钮与 PDF 查看/下载链接实际渲染高度 `>=44px`。
- 个人关系角标不遮挡标题或 meta chip。

### 必须截图 7：收藏页复用卡片

文件：

```text
desktop-favorites-card.png
```

验收：

- 收藏页卡片若复用同一角色 chip 和按钮样式，也应应用新颜色语义。
- 收藏页不需要强制使用首页的窄宽度，但不能出现比首页更松散的异常 spacing。

### 必须截图 8：课题进度页组队状态一致

文件：

```text
desktop-progress-role-state.png
```

场景：

- 从首页点击进入一个当前用户有 active 参与或项目负责人认领关系的课题进度页。

验收：

- 课题进度页的组队 chip 与首页同一课题的颜色语义一致。
- 当前用户对应角色显示 `self-role` 状态；如果同时超员，仍按普通 `self-role` 金色展示。
- chip 的 `aria-label` 与首页口径一致。
- 键盘 focus 到 chip 时焦点环清晰可见。

## 自动化验收建议

实现后至少运行：

```bash
conda run -n openmedailab python manage.py check
conda run -n openmedailab python manage.py test api.tests
node --test frontend/src/uiPlacement.test.js
node --check frontend/src/main.js
npm run test:e2e -- --project=desktop-1440 frontend/e2e/project-core.spec.js
npm run test:e2e -- --project=mobile-390 frontend/e2e/project-core.spec.js
git diff --check
```

如果只做前端实现、没有后端 payload 变化，仍需说明为什么没有新增 `viewer_state.team_role_keys`，并保证 fallback 映射覆盖医生、学生、博士毕业及以上、项目负责人四类。

实现阶段还必须同步：

- `VERSION`
- `CHANGELOG.md`
- `AGENTS.md` 中关于 `viewer_state.team_role_keys`、我的角色高亮、超员不单独配色和资助按钮颜色语义的规则

## 方案文档验收记录

验收时间：2026-06-20

验收结论：方案文档已按复审要求修订完成，可进入实现阶段；截图验收需在代码实现后按“截图验收标准”执行。

已验证内容：

- `desktop-wide` 已升级为必验视口，并新增 `desktop-wide-card-1920.png` 宽屏截图验收。
- PDF 查看/下载链接已纳入按钮形态控件触控高度验收，要求实际渲染高度 `>=44px`。
- 首页、收藏页和课题进度页三处模板均已纳入 `self-role`、`aria-label` 和 `requiredTeamRoles(..., project)` 接线要求。
- `team-role-chip` 已补充 `:focus-visible` 焦点环设计与自动化验收要求。
- 推荐色值对比度均满足 WCAG AA 普通文本 4.5:1 以上：默认 4.76，ready 4.97，self-role 6.68。

已执行文档检查：

- 使用 `git diff --no-index --check` 对新文档做 whitespace check。
- 使用 `rg` 扫描常见未决标记。
- 使用 `rg` 反查宽屏截图、PDF 链接触控高度、焦点环、课题进度页和 `44px` 等关键验收项。

结果：

- whitespace check 无输出，未发现格式问题。
- 未决标记检查无命中。
- 关键验收项反查均有命中。

## 非目标

- 不重做整个课题卡信息架构。
- 不恢复旧任务拆分或旧协作流程。
- 不把人员真实姓名、邮箱等敏感信息直接放进卡片。
- 不把“超员”写成额外文字标签。
- 不改公开列表排序和课题生命周期。
- 不把黄色或红色用于资助按钮、普通超员状态或非本人“已获资助”状态。

## 设计自检

- 卡片缩窄和紧凑化只改变视觉密度，不改变 API 语义。
- 超员不再单独配色，避免和个人关系金色或错误红色冲突。
- 我的角色高亮有稳定数据来源方案。
- 资助按钮回归通用按钮体系，不再占用金色语义。
- 截图验收覆盖桌面、宽屏、移动端、超员、我的角色、组合态和 sponsor popover。
