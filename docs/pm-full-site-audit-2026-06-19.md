# OpenMedAI Lab 全站产品与验收审查报告

审查日期：2026-06-19  
审查阶段：只读产品审查，本阶段不修改产品代码  
审查视角：资深产品经理 + 前端体验 + 后端权限/API + QA 验收覆盖  
当前版本：`0.13.1`  
当前本地服务：前端 `http://127.0.0.1:5173/`、后端 `http://127.0.0.1:8000/`

## 1. 结论摘要

当前站点的主方向是成立的：课题库、课题详情、个人空间、管理员空间、主题/PDF、讨论区、资助/认领/参与等主干能力已经形成闭环；自动化测试也保持通过。尤其是项目负责人认领、论文第一单位认领、本人关系优先排序、斜角关系标签、资助类型多选等近期重点规则，代码层面已有明显落地。

但从产品上线质量看，仍存在若干会直接影响隐私、转化、审批闭环和真实设备体验的问题。最需要优先处理的是：匿名访客信息边界、详情页缺失协作 CTA、资助审批意见和资助统计口径、审批中认领撤回口径前后端不一致、真实浏览器 E2E/视觉验收缺失。

总体判断：不建议把当前状态视为“全站产品验收完成”。建议先完成 P1 项，再进入更大范围试用；P2/P3 可分批进入后续小版本。

## 2. 本次审查方法

### 2.1 多 agent 分工

| 审查角色 | 审查重点 | 结果概况 |
| --- | --- | --- |
| 产品流程 PM agent | 访客、普通用户、认领、资助、管理员任务管理、信息隐私 | 发现资助审批意见缺失、访客信息泄露、管理员任务管理缺资助 UID 等问题 |
| 前端 UI/UX agent | 详情页、移动端、弹窗、toast、无障碍、真实浏览器量测 | 发现详情页缺 CTA、modal 焦点逃逸、toast 无 live region、移动首屏内容下沉 |
| 后端/API agent | 权限、状态机、唯一约束、审计、并发、文件校验 | 发现资助统计口径、事务/并发、失败审计、PDF 文件校验等风险 |
| QA 验收 agent | 自动化测试、文档一致性、验收命令、覆盖缺口 | 确认现有测试通过，但缺少真实 E2E/视觉验收；旧验收文档与当前 AGENTS 冲突 |

### 2.2 主 agent 本地验证

已执行并通过：

```bash
curl http://127.0.0.1:5173/
curl http://127.0.0.1:8000/api/meta/
cd frontend && node --test src/*.test.js
cd frontend && npm run build
.venv/bin/python manage.py test accounts api projects interactions credits
```

结果：

| 验证项 | 结果 |
| --- | --- |
| 前端服务 | HTTP 200 |
| 后端 `/api/meta/` | HTTP 200 |
| 前端单测 | 60/60 通过 |
| 前端构建 | 通过 |
| 后端测试 | 79/79 通过 |

### 2.3 本地 QA 账号

通过注册 API 创建了 3 个本地审查账号，用于验证注册、登录态课题列表、`viewer_state`、`claim_availability` 返回。账号仅用于本地审查环境。

| 用户名 | UID | 角色 | 验证结果 |
| --- | --- | --- | --- |
| `pm_audit_doctor_20260619021108` | `D00000011` | 医生 | 可登录并读取课题列表 |
| `pm_audit_student_20260619021108` | `U00000012` | 在读本科及以下 | 可登录并读取课题列表 |
| `pm_audit_sponsor_20260619021108` | `E00000013` | 工程师 | 可登录并读取课题列表 |

统一测试密码：`StrongPass12345`。

### 2.4 本地数据快照

| 指标 | 数值 |
| --- | ---: |
| 用户数 | 12 |
| 课题总数 | 14 |
| 公开课题数 | 6 |
| 主题总数 | 10 |
| `/api/meta/` 启用主题数 | 9 |
| 参与记录数 | 11 |
| 认领记录数 | 7 |
| 资助记录数 | 8 |
| pending 认领 | 1 |
| pending 资助 | 5 |
| 审计日志数 | 189 |

## 3. 已确认做得较好的部分

| 模块 | 当前表现 |
| --- | --- |
| 课题公开过滤 | 公开列表只返回 `is_public=true` 且公开阶段课题，访客没有 `viewer_state` |
| 登录态关系恢复 | 登录态课题列表返回 `viewer_state` 和 `claim_availability` |
| 本人关系排序 | 后端 `with_self_relation_rank()` 按认领、参与、资助优先排序 |
| 项目负责人/第一单位认领 | 数据库有条件唯一约束，避免同课题同席位同时存在多个 pending/approved |
| 第一单位认领字段 | 前后端已要求填写 `claimed_unit_name`，并保存到认领记录 |
| 资助多选入口 | 当前 popover 已从单选改为劳务费/算力 checkbox |
| 审批状态按钮 | 前端已区分 `项目负责人审批中`、`第一单位认领审批中`、通过后撤回 |
| 任务结果 | 后端测试覆盖纯资助者不能提交任务结果 |
| 版本/构建 | `VERSION`、前端 package 版本和构建均处于可运行状态 |

## 4. P1 问题：建议优先修复

### P1-1 匿名访客可能看到创建者姓名/昵称

问题：公开课题 payload 始终添加 `created_by_display`，其中 `name` 来自真实姓名、显示名或用户名。前端 `projectCreatorLabel()` 又优先显示 `contact.name`。这与“访客和公开展示只暴露 UID，不暴露用户名、邮箱、真实姓名”的隐私边界不一致。

证据：

| 证据 | 位置 |
| --- | --- |
| `collaboration_display_name()` 优先返回真实姓名/显示名/用户名 | `api/ninja_api.py:4069` |
| `collaboration_contact_payload()` 无论是否包含微信都返回 `name` | `api/ninja_api.py:4078` |
| `enrich_project_collaboration_payload()` 对匿名用户也添加 `created_by_display` | `api/ninja_api.py:4148` |
| 前端创建者展示优先使用 `contact.name` | `frontend/src/main.js:7608` |

影响：匿名访客无需登录即可从课题列表/详情看到创建者非 UID 身份信息，存在隐私和信任风险。

建议验收标准：

| 场景 | 验收 |
| --- | --- |
| 匿名 `/api/projects/` | 响应中创建者只包含 UID，不能包含 `name`、微信、邮箱、用户名 |
| 匿名课题卡 | 创建者只显示 `创建者：Uxxxxxxxx` 或系统导入 |
| 登录态课题卡 | 如果产品确认登录后可看姓名/微信，则仍需只对登录用户返回 |
| 测试 | 增加匿名响应 JSON 断言，确保真实姓名、昵称、用户名、微信不出现 |

### P1-2 课题详情页缺少核心协作 CTA

问题：`#/project/{id}` 课题详情页首屏只提供返回课题库、查看 PDF、下载 PDF；首页卡片上的点赞、关注、参与、认领项目负责人、认领第一单位、资助按钮没有在详情页复用。

证据：

| 证据 | 位置 |
| --- | --- |
| 详情页 header 只渲染返回/PDF 操作 | `frontend/src/main.js:5338` |
| 首页卡片完整协作按钮在卡片 footer | `frontend/src/main.js:5227` |
| 前端 UI agent 运行页量测 `.project-progress-page .interaction-button` 数量为 0 | 浏览器只读量测 |

影响：用户从分享链接、搜索结果或外部文档直接进入课题详情后，不能立即参与、认领或资助，被迫返回课题库寻找同一课题，转化路径断裂。

建议验收标准：

| 场景 | 验收 |
| --- | --- |
| 访客打开详情页 | 看到点赞/关注/参与/认领/资助入口，点击需触发登录提示 |
| 登录用户打开详情页 | 能在详情页完成参与、认领、资助、撤回等同首页一致的操作 |
| 审批中/不可认领 | 详情页按钮文案、禁用原因、tooltip/toast 与首页一致 |
| 移动端 | 详情页操作区可 sticky 或紧凑排列，不遮挡正文 |
| 测试 | 增加深链详情页 E2E，断言协作 CTA 存在并能完成至少一个流程 |

### P1-3 资助审批意见没有持久化给申请人

问题：管理员审批资助时可以传 `review_note`，但 `SponsorIntent` 模型没有 `review_comment`、`reviewed_by`、`reviewed_at` 字段，`sponsor_payload()` 也不返回审核意见。当前审核意见只进入审计日志，申请人在个人空间看不到。

证据：

| 证据 | 位置 |
| --- | --- |
| `SponsorIntent` 只有 `note/status/created_at/updated_at` | `interactions/models.py:169` |
| 管理员审批时只有 claim 写审核字段 | `api/ninja_api.py:1361` |
| `sponsor_payload()` 不返回审核意见 | `api/serializers.py:326` |

影响：资助者无法理解“为什么通过/为什么拒绝”，资助闭环不完整；这与认领审批的用户反馈体验不一致。

建议验收标准：

| 场景 | 验收 |
| --- | --- |
| 管理员通过资助 | 资助记录保存审核意见、审核人 UID、审核时间 |
| 管理员拒绝资助 | 申请人在个人空间可看到拒绝原因 |
| 管理端列表 | 审批后仍能查看审核意见 |
| API | `/api/me/dashboard/` 的 sponsors 返回审核字段 |
| 测试 | 覆盖 sponsor approved/rejected 后用户可见审核意见 |

### P1-4 资助统计可能把 pending/rejected 误算为已资助

问题：`project_stat_annotations()` 的 `sponsor_count=Count("sponsor_intents")` 统计所有资助记录，不过滤状态；而 `Project.team_status` 里的 `sponsor_count` 只统计 approved。这导致公开列表/详情中的 `sponsor_count` 可能和组队状态中的 sponsor count 不一致。

证据：

| 证据 | 位置 |
| --- | --- |
| 注解统计全部 sponsor intent | `interactions/services.py:11` |
| `Project.team_status` 只统计 approved | `projects/models.py:127` |
| `project_summary_payload()` 返回注解 `sponsor_count` | `api/serializers.py:166` |
| 本地数据 T0002 注解 sponsor_count=2，但 approved=0、pending=2 | 本地 shell 验证 |

影响：用户可能看到“已有资助”或更高资助数，但实际只是待审批或已拒绝意向；会影响课题可信度、筛选判断和管理员判断。

建议验收标准：

| 场景 | 验收 |
| --- | --- |
| 公开列表 sponsor_count | 只统计 approved |
| team_status.sponsor_count | 与公开 sponsor_count 口径一致 |
| pending/rejected 资助 | 不影响“已获资助”状态 |
| 测试 | 构造 pending/rejected/approved 三种记录，断言公开统计只等于 approved 数 |

### P1-5 审批中认领撤回口径前后端不一致

问题：前端已经按新规则只允许 approved 后显示“撤回项目负责人认领/撤回论文第一单位认领”，pending 时显示审批中；但后端通用撤回接口仍允许用户把自己的 pending claim 改为 withdrawn，现有测试还固化了 pending 负责人认领可撤回的旧行为。

证据：

| 证据 | 位置 |
| --- | --- |
| 前端 claim 可撤回状态只包含 approved | `frontend/src/main.js:16` |
| 前端 pending 文案为审批中 | `frontend/src/main.js:2719`、`frontend/src/main.js:2730` |
| 后端通用撤回不检查 claim 状态 | `api/ninja_api.py:1382` |
| 测试中 pending leader claim 被 withdraw 并断言成功 | `api/tests.py:2148` |

影响：同一业务在 UI 和 API 层存在两套规则。懂 API 的用户可以绕过前端撤回审批中认领；后续 agent 也可能依据旧测试恢复错误交互。

建议验收标准：

| 场景 | 验收 |
| --- | --- |
| pending 项目负责人认领 | 前端显示审批中，不显示撤回；后端如产品确认不可撤回，应返回 422 |
| pending 第一单位认领 | 同上 |
| approved 认领 | 前端和后端均允许撤回 |
| 测试 | 更新 pending claim withdraw 测试，明确新口径 |

### P1-6 Modal 和 toast 无障碍反馈不足

问题：多个 modal 使用 `role="dialog" aria-modal="true"`，但没有统一焦点进入、焦点 trap、关闭后回到触发控件等机制。全局 toast 只是普通 `div`，没有 `role="status"` 或 `aria-live`。

证据：

| 证据 | 位置 |
| --- | --- |
| `openConfirmDialog()` 只设置状态，不做焦点管理 | `frontend/src/main.js:4450` |
| toast 仅为普通 div | `frontend/src/main.js:5055` |
| toast 样式无 live region 语义 | `frontend/src/styles.css:3871` |
| 前端 agent 浏览器量测：打开版本弹窗后焦点仍可进入背景按钮 | 浏览器只读量测 |

影响：键盘和读屏用户可能不知道操作结果，也可能在 modal 打开时误操作背景页面。考虑到登录、删除、归档、认领、资助等关键操作大量依赖 modal/toast，这属于全站可用性风险。

建议验收标准：

| 场景 | 验收 |
| --- | --- |
| 任意 modal 打开 | 焦点进入标题或第一个可操作控件 |
| Tab / Shift+Tab | 焦点被限制在当前顶层 modal 内 |
| modal 关闭 | 焦点返回触发控件 |
| toast 成功提示 | 使用 `role="status"` 和 `aria-live="polite"` |
| toast 错误提示 | 使用 `role="alert"` 或等效 assertive 区 |
| 测试 | 浏览器 E2E 覆盖参与、资助、确认弹窗、版本弹窗的焦点路径 |

### P1-7 缺少真实浏览器 E2E/视觉验收

问题：当前前端测试很多是源码字符串或 CSS 正则断言，不能发现真实布局、focus、hover、移动端首屏、popover 裁切等问题。`frontend/package.json` 没有 test/e2e 脚本，`devDependencies` 为空。

证据：

| 证据 | 位置 |
| --- | --- |
| package scripts 只有 dev/build/preview | `frontend/package.json:6` |
| `uiPlacement.test.js` 大量读取源码做正则断言 | `frontend/src/uiPlacement.test.js` |
| AGENTS 要求至少 16 条浏览器验收路径，但未形成自动化 E2E | `AGENTS.md:804` |
| 本次前端 agent 通过浏览器才发现焦点、首屏、图标朗读问题 | 多 agent 审查 |

影响：测试全绿并不代表真实用户界面可用。近期多次“截图看起来没改”的问题，本质上就是缺少浏览器级视觉回归和可交互验收。

建议验收标准：

| 场景 | 验收 |
| --- | --- |
| viewport | 至少覆盖 1440、768、390、360、320px |
| 布局 | `document.documentElement.scrollWidth <= window.innerWidth` |
| 卡片标签 | 斜角标签、关系标签、标题 bounding box 不相交 |
| popover | sponsor/claim tooltip 完全在 viewport 内，距离触发点符合阈值 |
| E2E | 登录、参与、认领、第一单位认领、资助、撤回、管理员审批形成端到端脚本 |
| CI | 把浏览器验收纳入统一 QA 命令或 CI |

## 5. P2 问题：建议进入下个迭代

### P2-1 管理员任务管理漏掉已获批资助 UID

问题：管理员任务管理详情只拉取 `interest` 和 `claim` 的已通过 UID，不展示已通过 sponsor UID。

证据：

| 证据 | 位置 |
| --- | --- |
| `fetchProjectApprovedInteractions()` 过滤为 `interest/claim` | `frontend/src/main.js:3711` |
| 管理端任务详情区标题为“已获批人员” | `frontend/src/main.js:6982` |

影响：管理员看课题任务详情时无法同时看到资助者闭环，需要去审批列表或其他位置查，管理效率低。

建议验收标准：任务详情按“参与/认领成员”和“已获批资助”分组展示 UID；pending/rejected 不进入已获批分组。

### P2-2 FAQ/枚举支持 token 资助，但用户入口不可达

问题：`SponsorType` 枚举包含 token，FAQ 文案写“算力、token 或劳务费”，但当前快速资助入口只显示劳务费和算力。

证据：

| 证据 | 位置 |
| --- | --- |
| `QUICK_SPONSOR_TYPES = ["labor_fee", "compute"]` | `frontend/src/main.js:17` |
| FAQ 写 token 资助 | `frontend/src/main.js:100` |
| sponsor popover 只遍历 quick sponsor options | `frontend/src/main.js:6766` |

影响：用户按 FAQ 预期寻找 token 资助，但无法提交；产品承诺和入口不一致。

建议验收标准：产品明确是否保留 token。若保留，入口、审批、状态、撤回、个人空间展示全链路可达；若不保留，同步删除 FAQ 和枚举对外展示。

### P2-3 重复提交资助会把已通过状态重置为 pending

问题：`sponsor_project()` 使用 `update_or_create()`，同一用户/课题/类型再次提交时，默认把状态设置为 `pending`。如果原记录是 approved，会被回退到待审批。

证据：

| 证据 | 位置 |
| --- | --- |
| `defaults={"note": ..., "status": InteractionStatus.PENDING}` | `api/ninja_api.py:2963` |

影响：已获批资助的状态可能被用户重复提交覆盖，造成审批和展示混乱。

建议验收标准：approved/pending 的同类型资助重复提交不应改变状态；如需要修改说明，需有明确“补充说明/重新提交”机制和审计。

### P2-4 “点赞排序”不是后端分页前全局排序

问题：前端选择 `likes` 时发给后端的是 `follows`，后端按收藏/参与排序，前端再对当前页按 `score_count` 本地排序。这不是全局点赞排序。

证据：

| 证据 | 位置 |
| --- | --- |
| `likes` 被映射成 `follows` | `frontend/src/main.js:549` |
| 前端只对当前已加载 rows 二次排序 | `frontend/src/main.js:565` |
| 后端 sort_map 没有 `likes` | `api/ninja_api.py:773` |

影响：高点赞但低收藏课题可能不在第一页，用户看到的“点赞排序”不可信。

建议验收标准：后端支持 `sort=likes`，按 `score_count` 在分页前排序；测试用 `page_size=1` 验证高赞课题排到第一页。

### P2-5 移动端首页首屏内容下沉

问题：390px 宽移动端量测中，顶部导航、筛选、主题卡条占满首屏，首个课题卡刚好落在首屏底部之外。并且 toolbar 中已有主题 select，下面又有主题卡条，移动端信息重复。

证据：

| 证据 | 位置 |
| --- | --- |
| 搜索筛选区 | `frontend/src/main.js:5071` |
| 主题卡条 | `frontend/src/main.js:5103` |
| 前端 agent 量测：390x844 时 `.topbar` 高 216px，首个 `.project-card` top 为 844px | 浏览器只读量测 |

影响：移动用户打开首页首先看到大量导航和筛选控件，而不是课题内容，降低浏览和转化效率。

建议验收标准：390x844 首屏至少露出首个课题标题和状态；移动端高级筛选折叠或抽屉化；主题 select 与主题卡条去重或明确主次。

### P2-6 联系人悬浮卡可能被卡片裁切

问题：`.project-card` 设置 `overflow: hidden`，联系人 hover card 又是卡片内部绝对定位，且没有 max-height/overflow 规则。成员多或触发点靠近卡片底部时容易被裁切。

证据：

| 证据 | 位置 |
| --- | --- |
| `.project-card { overflow: hidden; }` | `frontend/src/styles.css:769` |
| `.contact-hover-card` 无最大高度和内部滚动 | `frontend/src/styles.css:1306` |
| 组队联系人卡渲染在课题卡内 | `frontend/src/main.js:5207` |

影响：登录用户查看成员姓名/微信时可能看不到完整信息，尤其移动端和成员较多场景。

建议验收标准：联系人卡使用 viewport 定位或 portal 到卡片外层；设置 max-height 和内部滚动；390/768/1440px 下 hover/focus 不被裁切。

### P2-7 PDF 上传校验口径不一致

问题：任务结果文档上传会校验 PDF 签名和大小；课题主 PDF、项目进度 PDF、主题数据集 PDF 主要按扩展名判断。

证据：

| 证据 | 位置 |
| --- | --- |
| 主题数据集 PDF 只检查 `.pdf` 后缀 | `api/ninja_api.py:2107` |
| 任务结果 PDF 会校验 `%PDF-` 签名 | `api/ninja_api.py:3537` |

影响：非 PDF 内容可能作为公开 PDF 被托管，影响安全和用户体验。

建议验收标准：主 PDF、进度 PDF、主题 PDF 均校验扩展名、大小、PDF 签名；非法内容返回 422 并写失败审计。

### P2-8 阶段变更与积分扣返不在同一事务

问题：管理员更新课题阶段时，先更新课题，再另开事务扣除或返还积分。如果阶段保存成功但后续积分扣返或审计失败，状态与积分流水可能不一致。

证据：

| 证据 | 位置 |
| --- | --- |
| `update_project()` 先保存课题 | `api/ninja_api.py:2545` |
| 积分扣返分别另开 `transaction.atomic()` | `api/ninja_api.py:2562` |

影响：进行中/归档状态与积分流水可能出现不一致，后续追责困难。

建议验收标准：阶段变更、积分扣返、审计写入在同一事务边界内；模拟扣分失败时课题阶段回滚。

### P2-9 交互提交存在并发窗口

问题：参与、认领、资助提交前的阶段和积分检查未统一在锁内完成。认领对课题加锁较充分，但积分可用额度检查发生在锁前；interest/sponsor 不锁课题并重检阶段。

证据：

| 证据 | 位置 |
| --- | --- |
| interest 提交先检查阶段/积分，再 `update_or_create()` | `api/ninja_api.py:2847` |
| claim 积分检查发生在事务和锁之前 | `api/ninja_api.py:2887` |
| sponsor 不在事务内锁课题重检阶段 | `api/ninja_api.py:2952` |

影响：高并发或管理员同时变更阶段时，可能发生超额占用、错误阶段提交或后续扣分异常。

建议验收标准：交互写入统一锁课题和用户积分记录，并在锁内重检阶段、席位、积分；增加并发或事务回归测试。

### P2-10 失败写操作审计覆盖不完整

问题：部分写接口的失败路径直接 `fail()`，没有 `status=failed` 审计。注册、资料、课题保存等部分失败路径已经有审计，但交互重复提交、积分不足、审批非法、文件非法等路径不完整。

证据：

| 证据 | 位置 |
| --- | --- |
| 无法招募/积分不足直接返回 | `api/ninja_api.py:2853` |
| 重复认领/席位占用直接返回 | `api/ninja_api.py:2922` |
| 非法审批类型直接返回 | `api/ninja_api.py:1340` |

影响：越权、恶意重复提交和失败原因难以在审计中关联 request_id，管理员排查成本高。

建议验收标准：所有写接口代表性失败路径写 failed audit；测试覆盖 403/422 的失败审计。

### P2-11 错误结构与文档契约不一致

问题：AGENTS 写“字段错误放在 `errors`”，当前 API 实际放在 `error.details`，前端也按该结构读取。代码和文档契约漂移。

证据：

| 证据 | 位置 |
| --- | --- |
| ErrorDetail 字段为 `details` | `api/ninja_api.py:143` |
| `error_payload()` 写 `error.details` | `api/ninja_api.py:2995` |
| 注册错误测试断言字段详情 | `api/tests.py:2885` |

影响：后续 agent 或外部调用方可能按 `errors` 实现，造成字段错误读取失败。

建议验收标准：统一公开契约。若保留 `error.details`，同步更新 AGENTS；若改为 `errors`，同步前端和测试。

### P2-12 隐私授权边界需要产品确认

问题：登录用户悬停组队角色即可查看成员姓名和微信，这是当前文档允许的，但缺少用户可控的“是否展示联系方式”或“仅对同项目成员展示”的开关。

证据：

| 证据 | 位置 |
| --- | --- |
| FAQ 明确登录后可看姓名和微信 | `frontend/src/main.js:88` |
| 后端登录态 `include_contacts=True` | `api/ninja_api.py:4148` |

影响：注册用户之间默认共享联系方式，可能超出部分用户预期。对于医疗/科研协作社区，建议把隐私授权做成明确产品规则。

建议验收标准：资料页明确说明联系方式展示范围；支持用户选择公开给所有登录用户、仅项目成员、仅管理员或不公开；后端按权限裁剪。

## 6. P3 问题：可随维护迭代优化

| 编号 | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| P3-1 | Material Symbols 装饰图标未统一 `aria-hidden`，读屏可能朗读 `library_books`、`login` 等 ligature | 导航和按钮读屏体验嘈杂 | 所有装饰图标加 `aria-hidden="true"`，必要时按钮补 `aria-label` |
| P3-2 | 我的任务禁用提示在混合关系下可能优先显示“资助意向不产生任务结果提交权限” | 用户同时有资助和待审批参与/认领时，真实卡点不清楚 | 先解释参与/认领状态，只有纯资助时才显示资助不产生提交权限 |
| P3-3 | 管理端归档确认体验不一致：直接归档按钮不确认，阶段下拉归档会确认 | 管理员对同一动作预期不稳定 | 统一归档交互；若产品决定归档要确认，同步更新 AGENTS |
| P3-4 | 兼容 claim 类型存在，但管理查询和撤回查询只保留需要审批的两类 | 历史兼容认领可能不能完整管理 | 要么明确迁移隐藏旧类型，要么补全 legacy claim 管理/撤回 |
| P3-5 | `frontend/src/main.js`、`api/ninja_api.py` 体量过大 | 后续修改容易互相影响，审查成本高 | 后续按路由/领域拆分模块，但不要在当前修 bug 阶段大重构 |
| P3-6 | QA 命令入口分散 | 不同人执行的验收集合不同 | 增加统一只读 QA 脚本或文档，并纳入 CI |

## 7. 文档与验收体系问题

### 7.1 旧验收文档与当前主流程冲突

`docs/user-admin-workspace-execution-and-acceptance.md` 仍保留管理员创建/分配任务、贡献审核、审核通过发积分奖励等旧闭环；当前 AGENTS 已明确任务结果提交后不进入管理员审批，旧 `ProjectTask` 只保留兼容。

证据：

| 旧文档内容 | 位置 |
| --- | --- |
| 管理员可以创建任务、分配 UID、更新任务状态 | `docs/user-admin-workspace-execution-and-acceptance.md:152` |
| 用户提交贡献后关联任务进入 review | `docs/user-admin-workspace-execution-and-acceptance.md:156` |
| 管理员审核贡献通过并发奖励 | `docs/user-admin-workspace-execution-and-acceptance.md:157` |
| 当前 AGENTS 任务结果不进入管理员审批 | `AGENTS.md:831` |

影响：QA 或后续 agent 可能按旧文档验收，把已裁掉流程当作缺陷。

建议验收标准：建立唯一“当前有效验收基准”。旧文档保留时需在开头标记历史归档，并指向 AGENTS 当前流程。

### 7.2 验收标准不够机器可判定

AGENTS 中有“观察状态反馈”“检查文字和颜色差异”“小屏检查”等表述，适合人工巡检，但不够稳定。近期设计文档里已有 bounding box、viewport、popover 距离等更严格标准，但未进入必跑矩阵。

建议验收标准：

| 验收对象 | 建议机器断言 |
| --- | --- |
| 卡片标签 | ribbon、meta chip、标题 bounding box 不相交 |
| 移动端 | `scrollWidth <= innerWidth`，首屏露出首个课题标题 |
| popover | 完全在 viewport 内，距触发按钮不超过指定像素 |
| modal | 焦点 trap、Escape、关闭后 focus return |
| toast | DOM 存在 live region |

## 8. 建议修复路线

### 第一批：上线前必须收口

1. 修匿名创建者信息泄露。
2. 详情页补核心协作 CTA。
3. 资助审批意见持久化并给申请人展示。
4. 统一资助统计口径，只统计 approved。
5. 统一 pending 认领是否可撤回的前后端规则。
6. 给 modal/toast 补基础无障碍机制。
7. 增加最小 Playwright/E2E 验收，覆盖关键交互和移动端。

### 第二批：下一小版本

1. 管理员任务管理补已获批资助 UID。
2. 明确 token 资助是否保留，并同步 FAQ/入口/枚举。
3. 修重复提交资助回退状态。
4. 修点赞排序为后端分页前排序。
5. 移动端首页筛选/主题区减重。
6. 联系人悬浮卡改为不被卡片裁切。
7. PDF 上传统一签名和大小校验。

### 第三批：稳定性和治理

1. 阶段变更与积分扣返放入统一事务。
2. 交互提交锁内重检阶段、席位和积分。
3. 补失败写操作审计。
4. 统一 API 错误字段契约。
5. 清理旧验收文档和旧任务主流程表达。
6. 增加统一 QA 命令或 CI。

## 9. 严格验收清单

### 9.1 隐私与权限

| 验收项 | 标准 |
| --- | --- |
| 匿名课题列表 | 不返回姓名、用户名、邮箱、微信 |
| 匿名课题详情 | 创建者和成员只显示 UID |
| 登录态联系方式 | 展示范围符合产品隐私设置 |
| 普通用户访问 admin API | 返回 403 且记录失败审计 |

### 9.2 课题协作

| 验收项 | 标准 |
| --- | --- |
| 首页卡片 | 点赞、关注、参与、认领项目负责人、认领第一单位、资助均可操作或有明确不可操作原因 |
| 详情页 | 与首页卡片同等协作能力 |
| 项目负责人认领 | 同课题最多一个 pending/approved；pending 显示审批中；approved 才出现撤回入口 |
| 第一单位认领 | 必填完整第一单位；同课题最多一个 pending/approved |
| 资助 | 劳务费/算力/产品确认的其他类型可提交、撤回、审批、展示 |
| 任务结果 | 只有进行中课题且本人有 approved 参与/认领才可提交 |

### 9.3 管理端

| 验收项 | 标准 |
| --- | --- |
| 任务审批 | 只处理认领和资助审批；参与不进入管理员审批 |
| 资助审批 | 审核意见在申请人个人空间可见 |
| 任务管理详情 | 展示已通过参与/认领 UID 和已通过资助 UID |
| 课题阶段 | 阶段、积分扣返、审计一致 |
| 备份恢复 | 不覆盖用户、协作关系、任务结果、积分、审计日志 |

### 9.4 UI/移动端/无障碍

| 验收项 | 标准 |
| --- | --- |
| 移动首页 | 390x844 首屏露出首个课题标题 |
| 卡片标签 | 320/360/390/1440px 均不重叠、不横向溢出 |
| sponsor popover | 距按钮不超过 16px，完全在 viewport 内，可 Escape/外部点击关闭 |
| claim tooltip | 距触发按钮不超过 12px，完全在 viewport 内 |
| modal | 焦点进入、trap、关闭后返回触发控件 |
| toast | 读屏可感知 |

## 10. 本阶段未做的事

1. 未修改任何产品代码。
2. 未修复上述问题。
3. 未删除或清理本地 QA 账号。
4. 未修改旧验收文档。
5. 未引入新的依赖或测试框架。

## 11. 附录：本次发现来源归并

| 来源 | 代表发现 |
| --- | --- |
| 产品流程 agent | 资助审批意见缺失、访客创建者信息泄露、管理员任务管理缺资助 UID、token 入口不一致 |
| 前端 UI agent | 详情页无 CTA、modal 焦点逃逸、toast 不可读、移动首屏下沉、联系人 hover 被裁切 |
| 后端/API agent | 资助统计口径、阶段变更事务、并发窗口、失败审计、PDF 校验 |
| QA agent | 缺真实 E2E、旧验收文档冲突、验收标准不可机器判定、备份恢复负保护不足 |
| 主 agent 本地验证 | 服务可访问、测试全绿、QA 账号注册成功、登录态 payload 正常返回 |

