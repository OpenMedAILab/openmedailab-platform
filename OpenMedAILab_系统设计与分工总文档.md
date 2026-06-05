# OpenMedAILab 系统设计与分工总文档

版本：v1.0  
适用人员：钱护磊、王志  
文档目标：用一份文档说明项目背景、系统目标、功能范围、技术方案、数据库设计、页面设计、开发分工、部署安装、验收标准和后续迭代。后续可以直接按本文档重新设计和实现系统，不要求在现有静态代码上继续修改。

## 1. 一句话说明

OpenMedAILab 是一个医学 AI 开放科研课题协作平台。它先把大量医学 AI 课题公开展示出来，再通过登录、关注、评分、参与意向、角色组队、项目管理、任务贡献、积分和后台统计，把医生、学生、老师、AI 工程师、专家和资助者组织起来，让他们围绕具体课题形成可追踪、可推进、可产出的科研合作。

第一版系统的重点不是复杂算法，也不是完整论文管理系统，而是先跑通一个最小闭环：

```text
课题公开展示
  -> 用户注册登录
  -> 用户关注/评分/表达参与意向
  -> 系统记录到数据库
  -> 用户能在个人主页看到自己的课题
  -> 管理员能在后台看到哪些课题有人关注、有人参与、有人愿意资助
  -> 平台根据真实互动推动课题组队和启动
```

## 2. 项目背景

### 2.1 为什么要做这个平台

目前医学科研和 AI 科研之间存在明显错配。

医生群体有真实临床问题和科研产出压力，但很多医生日常工作非常忙，接触 AI 技术、模型、代码、数据分析和工程实现的机会有限。他们可能有好问题，却没有足够时间和技术资源把问题做成论文、工具或研究项目。

学生群体有学习和参与真实科研项目的需求，但常常受限于导师方向、实验室资源、学校平台和个人信息差。很多学生想接触医学 AI、真实数据、真实问题和跨校合作，但缺少入口。

高校老师和年轻科研人员也有类似问题。他们可能有方法能力、指导能力或论文经验，但缺少高质量医学问题、医生资源、数据资源和执行团队。

AI 工程师和算法研究者则常常缺少真实医学场景。他们有技术，但不知道医生真正需要什么，也不容易获得医学专家反馈。

因此需要一个开放平台，把不同角色连接起来：

- 医生提供问题、医学判断、临床价值和审核。
- 学生承担文献、实验、整理、标注、写作等执行工作。
- 老师和专家提供方向、方法、审稿和项目指导。
- AI 工程师提供模型、RAG、Agent、多模态、工程实现。
- 资助者提供经费、算力、积分池或其他资源。
- 平台提供课题目录、规则、记录、任务、积分和项目管理。

### 2.2 平台要解决的问题

平台要解决的不是单个网页展示问题，而是开放科研协作的组织问题：

1. 课题从哪里来。
2. 谁对课题感兴趣。
3. 谁愿意参与，愿意以什么角色参与。
4. 一个课题是否已经凑齐基本团队。
5. 哪些课题更有价值，哪些课题应该优先推进。
6. 参与者是否有持续动机把课题做完。
7. 项目进度如何管理，不能只靠人手工催。
8. 用户贡献、积分、声誉和成果如何记录。
9. 平台如何尽量自动化、低维护运行。
10. 后续如何盈利，但第一版不直接做在线交易。

### 2.3 第一阶段的现实目标

第一阶段先服务少量用户，例如 3-5 人或一小批内部试用者。此时系统不要求完美，但必须真实可用：

- 用户能访问网站。
- 用户能注册登录。
- 用户能看课题。
- 用户能点关注、参与、评分、认领、资助意向。
- 这些操作必须进数据库，不能只存在浏览器里。
- 用户下次登录后还能看到自己的记录。
- 管理员能看到所有用户行为和课题热度。

这比做一个漂亮静态页面更重要。因为平台核心是协作数据和项目组织，不只是展示。

## 3. 当前已有资料如何使用

当前已有一个静态页面网站和一批课题文件。它们可以作为产品参考，但后续实现不要求直接基于现有代码改。

### 3.1 可参考的内容

现有目录里有：

```text
项目背景.txt
OpenMedAILab/site/
OpenMedAILab/topics/
OpenMedAILab/scripts/
OpenMedAILab/metadata/
```

建议这样使用：

- `项目背景.txt`：作为产品需求来源。
- `OpenMedAILab/site/`：作为页面视觉和交互原型参考。
- `OpenMedAILab/topics/`：作为课题 Markdown/PDF 内容库。
- `OpenMedAILab/site/topics_index.json`：作为第一版导入数据库的参考数据。
- `OpenMedAILab/scripts/build_topic_index.py`：作为理解课题字段抽取逻辑的参考。
- `OpenMedAILab/metadata/topic_scoring/topic_scores.xlsx`：作为课题评分、标签和推荐期刊的参考数据。

### 3.2 不建议直接依赖的内容

第一版正式系统不建议继续依赖：

- 浏览器 `localStorage` 保存用户互动。
- 静态生成的课题详情页作为唯一详情页。
- 纯 JSON 文件作为主数据库。
- 多个零散 Markdown 文档作为开发依据。

原因是正式系统需要用户、权限、数据库、后台、部署和统计。静态站适合展示，不适合正式协作管理。

### 3.3 新系统与旧代码的关系

推荐关系是：

```text
旧静态站 = 产品原型 + 内容来源 + 页面参考
新 Django 系统 = 正式开发主体
```

也就是说，后续可以重新建一个干净工程。需要时从现有课题库导入数据，不必在旧静态代码上继续堆功能。

## 4. 产品定位

OpenMedAILab 的定位不是普通论坛，也不是单纯课题展示站，而是：

```text
医学 AI 课题目录 + 开放协作平台 + 项目管理工具 + 贡献和积分记录系统
```

### 4.1 核心用户

第一版主要面向以下用户：

- 医生。
- 学生。
- 高校老师。
- AI 工程师。
- 医学统计或数据分析人员。
- 专家顾问。
- 资助者。
- 平台管理员。

### 4.2 核心价值

对医生：

- 能发布或选择真实医学 AI 课题。
- 能找到 AI 和学生合作者。
- 能表达资助或医学指导意向。
- 能看到课题进展和参与人。

对学生：

- 能浏览大量真实课题。
- 能选择感兴趣课题参与。
- 能通过任务贡献积累积分和经历。
- 能接触跨校、跨医院、跨专业合作。

对老师和专家：

- 能找到值得指导的课题。
- 能低成本参与项目指导。
- 能通过专家点评影响课题优先级。

对 AI 工程师：

- 能获得真实医学问题和反馈。
- 能参与模型、RAG、Agent、多模态和工程实现。

对资助者：

- 能看到哪些课题有人关注、有人参与。
- 能表达对特定课题的支持意向。
- 第一版只记录意向，不做在线支付。

对平台：

- 能统计用户、课题、互动和热度。
- 能逐步沉淀贡献记录、积分和声誉。
- 能通过规则化流程减少人工维护。

## 5. 产品原则

### 5.1 先可用，再复杂

第一版不要追求完整科研平台。先把用户行为记录下来，让平台真实跑起来。

最小可用系统必须包含：

- 课题浏览。
- 登录注册。
- 个人主页。
- 关注。
- 评分。
- 参与意向。
- 认领意向。
- 资助意向。
- 后台管理。
- 数据库记录。

### 5.2 平台管理项目，不靠人手工管理全部细节

项目一旦启动，系统应该要求用户定期更新进度、拆任务、提交结果、记录贡献。第一版可以先做简单状态和意向记录，后续逐步扩展任务和进度提醒。

### 5.3 积分是协作激励，不等于论文署名

积分可以表示贡献、承诺、奖励和平台资源使用权，但不能自动等同于论文署名。论文署名必须由项目规则、真实贡献和学术规范决定。

### 5.4 声誉和积分分离

积分可以通过任务获得，也可能未来通过购买获得。声誉只能通过高质量贡献、审核通过、长期可靠参与获得。后续高权限操作应该更依赖声誉，而不是单纯积分。

### 5.5 第一版不做在线交易

资助按钮只记录意向。涉及经费、付款、报销、劳务、赞助等，应先线下沟通，或由管理员后台登记。系统页面必须避免承诺现金收益或直接撮合交易。

### 5.6 医学隐私优先

第一版不允许普通用户上传真实患者数据。课题公开页不能包含姓名、身份证号、住院号、手机号、详细地址等敏感信息。后续如果做上传，必须先做脱敏和审核。

## 6. 第一版 MVP 范围

### 6.1 必须做

第一版必须实现以下功能：

1. 首页。
2. 课题列表。
3. 课题详情。
4. 搜索、筛选、排序、分页。
5. 用户注册、登录、退出。
6. 用户资料。
7. 关注课题。
8. 评分课题。
9. 表达参与意向并选择角色。
10. 认领课题或认领工作意向。
11. 资助意向记录。
12. 个人工作台。
13. 管理后台。
14. 课题数据导入。
15. 基础统计。
16. 部署到服务器。

### 6.2 暂缓做

第一版暂不做：

- 真实在线支付。
- 积分购买。
- 自动分配论文署名。
- 完整任务市场。
- 完整论坛。
- 文件上传和数据集管理。
- 向量检索。
- 在线调用大模型。
- 邮件/微信自动通知。
- 复杂权限认证。

这些可以在数据库设计中预留，但不要阻塞第一版上线。

### 6.3 第一版上线后的判断标准

第一版是否成功，不看功能多不多，而看：

- 是否能让真实用户登录。
- 是否能记录用户对课题的真实兴趣。
- 是否能看出哪些课题可能启动。
- 是否能给管理员提供可操作数据。
- 是否能支撑后续任务和积分扩展。

## 7. 用户角色设计

系统里要区分两类角色：系统权限角色和项目参与角色。

### 7.1 系统权限角色

访客：

- 可以浏览公开课题。
- 可以搜索和筛选。
- 不能关注、评分、参与、认领。
- 点击互动按钮时跳转登录。

注册用户：

- 可以维护个人资料。
- 可以关注课题。
- 可以评分。
- 可以表达参与意向。
- 可以认领课题或任务意向。
- 可以表达资助意向。
- 可以查看个人工作台。

管理员：

- 可以进入后台。
- 可以导入课题。
- 可以修改课题信息。
- 可以查看所有用户和互动记录。
- 可以处理异常、删除不当内容、修改项目状态。

后续可扩展：

- 项目负责人。
- 专家。
- 认证医生。
- 认证老师。
- 财务或运营人员。

### 7.2 项目参与角色

医生：

- 医学指导。
- 临床价值判断。
- 医学术语审核。
- 数据解释。
- 论文医学部分把关。

学生：

- 文献整理。
- 数据清洗。
- 实验执行。
- 结果整理。
- 图表制作。
- 论文初稿。

Leader：

- 项目负责人。
- 拆任务。
- 协调参与者。
- 推进时间节点。
- 汇总成果。

AI 工程师：

- 模型训练。
- RAG 系统。
- Agent 流程。
- 多模态模型。
- 后端/前端工程。
- 实验复现。

医学统计：

- 统计方案。
- 样本量和终点定义。
- 因果推断。
- 真实世界研究设计。
- 结果解释。

资助者：

- 表达经费、算力、标注预算、专家咨询、学生劳务等支持意向。
- 第一版只记录意向，不直接付款。

专家顾问：

- 方法审核。
- 医学审核。
- 投稿建议。
- 风险提示。

### 7.3 项目启动最低条件

建议第一版把项目启动条件定义清楚：

```text
基础启动团队 = 医生 + 学生 + Leader
增强启动条件 = 基础启动团队 + AI 工程师或统计人员 + 资助意向
```

系统可以在课题详情页显示：

```text
医生 0/1
学生 2/1
Leader 0/1
AI工程师 1
资助意向 0
```

当医生、学生、Leader 都有人表达意向后，系统标记为“具备组队基础”。是否正式启动由管理员或 Leader 确认。

## 8. 系统功能总览

系统分为 9 个功能模块：

1. 课题库模块。
2. 公开浏览模块。
3. 用户与资料模块。
4. 用户互动模块。
5. 个人工作台模块。
6. 项目管理模块。
7. 任务、贡献与积分模块。
8. 管理后台模块。
9. 部署、运维与备份模块。

## 9. 课题库模块

### 9.1 目标

把现有大量 Markdown/PDF 课题变成数据库里的结构化项目。用户浏览时从数据库读取，而不是直接读取静态 JSON。

### 9.2 数据来源

初始数据可以来自：

- 现有 `topics/` 文件夹。
- 现有 `topics_index.json`。
- 现有评分 Excel。

第一版推荐先导入 `topics_index.json`，因为它已经包含标题、摘要、主题、标签、评分、Markdown 路径、PDF 路径等字段。后续再补充直接扫描 Markdown 的导入脚本。

### 9.3 课题字段

每个课题至少包含：

- 课题 ID。
- 主题。
- 课题编号。
- 标题。
- 摘要。
- 标签。
- 阶段。
- 初始评分。
- 社区评分。
- 综合评分。
- 推荐期刊。
- 需要角色。
- Markdown 原文路径。
- PDF 路径。
- 是否公开。
- 创建时间。
- 更新时间。

### 9.4 导入要求

导入必须可重复执行。重复执行时不能产生重复课题。

导入逻辑：

```text
读取 topics_index.json
  -> 遍历 projects
  -> 按 topic_id 或 source_md_path 判断是否已存在
  -> 不存在则创建
  -> 已存在则更新标题、摘要、标签、评分、路径
  -> 同步 Theme
  -> 同步 Tag
  -> 同步 ProjectDocument
  -> 写入 ImportLog
```

导入完成后，后台应看到：

- 总课题数。
- 新增课题数。
- 更新课题数。
- 失败记录。
- 导入时间。

## 10. 公开浏览模块

### 10.1 首页

首页目标是让用户快速理解平台和进入课题。

首页展示：

- 平台名称：OpenMedAILab。
- 一句话介绍。
- 统计数字：
  - 课题数。
  - 主题数。
  - 注册用户数。
  - 关注次数。
  - 参与意向数。
  - 评分次数。
- 主题入口：
  - AntiVEGF。
  - FFA。
  - ROP。
  - 眼前节。
  - 阴道镜。
- 热门课题：
  - 初评高。
  - 关注多。
  - 最近有人互动。
- 快速入口：
  - 浏览课题。
  - 登录/注册。
  - 我的工作台。

首页不需要做很重的宣传页。打开后应该直接能进入课题。

### 10.2 课题列表页

课题列表页是用户使用频率最高的页面。

必须支持：

- 关键词搜索。
- 主题筛选。
- 标签筛选。
- 阶段筛选。
- 是否有 PDF 筛选。
- 排序。
- 分页。

排序方式：

- 综合推荐。
- 初始评分高到低。
- 社区评分高到低。
- 关注数高到低。
- 最近更新。
- 课题编号。

课题卡片显示：

- 标题。
- 主题。
- 编号。
- 阶段。
- 摘要。
- 标签。
- 初始评分。
- 社区评分。
- 关注数。
- 参与意向数。
- 组队状态。
- 是否有 PDF。
- 操作按钮。

操作按钮：

- 查看详情。
- 关注。
- 评分。
- 感兴趣/申请参与。
- 认领意向。
- 资助意向。

未登录用户点击互动按钮时跳转登录，并带上返回地址。

### 10.3 课题详情页

详情页是用户判断是否参与的核心页面。

详情页显示：

- 课题标题。
- 所属主题。
- 标签。
- 阶段。
- 初始评分。
- 社区评分。
- 推荐期刊。
- 摘要。
- Markdown 正文。
- PDF 入口。
- 当前组队情况。
- 参与按钮。
- 评分入口。
- 关注按钮。
- 资助意向按钮。
- 最近动态。

Markdown 展示建议结构化：

- 课题背景。
- 科学问题。
- 技术路线。
- 数据需求。
- 可拆分任务。
- 预期成果。
- 风险和合规。

如果原始 Markdown 不规范，第一版先完整展示，后续再做自动结构化抽取。

## 11. 用户与资料模块

### 11.1 注册

注册字段第一版保持简单：

- 用户名。
- 密码。
- 昵称。
- 主要身份。
- 联系方式，可选。

主要身份可选：

- 医生。
- 学生。
- 老师。
- AI 工程师。
- 医学统计。
- 资助者。
- 其他。

注册后给予初始积分，例如 100 分。该数值可以后台配置。

### 11.2 登录退出

使用 Django 自带认证系统。

登录后页面右上角显示：

- 昵称。
- 我的工作台。
- 退出。

未登录时显示：

- 登录。
- 注册。

### 11.3 个人资料

个人资料字段：

- 昵称。
- 真实姓名，可选。
- 身份类型。
- 单位或学校。
- 职称或年级。
- 研究方向。
- 擅长技能。
- 每周可投入时间。
- 微信或邮箱，管理员可见。
- 自我介绍。

资料用途：

- 帮助管理员判断参与者是否合适。
- 帮助项目负责人组队。
- 后续用于推荐课题。

## 12. 用户互动模块

### 12.1 关注课题

关注表示用户想持续跟进该课题。

规则：

- 登录后才能关注。
- 每个用户对每个课题只能关注一次。
- 可以取消关注。
- 关注不消耗积分。
- 关注记录进入个人工作台。

数据库记录：

- 用户。
- 课题。
- 创建时间。

### 12.2 评分课题

评分表示用户对课题价值的判断。

第一版采用 1-10 分总分。

规则：

- 登录后才能评分。
- 每个用户对每个课题只能有一条评分。
- 用户可以更新评分。
- 社区评分取平均值或加权平均值。
- 后续专家评分和普通用户评分可以分开。

评分弹窗可以让用户选 1-10 分，并可选填写短评。

### 12.3 参与意向

参与意向是系统最重要的功能之一。

用户点击“申请参与”后填写：

- 参与角色。
- 可投入时间。
- 相关经验。
- 想承担的工作。
- 留言。

参与角色：

- 医生。
- 学生。
- Leader。
- AI 工程师。
- 医学统计。
- 文献整理。
- 数据处理。
- 论文写作。
- 资助者。
- 其他。

状态：

- 待处理。
- 已通过。
- 已拒绝。
- 已撤回。

第一版可以先不做复杂审核，默认记录为“待处理”或“已记录”。管理员后台可查看。

### 12.4 认领意向

认领表示用户愿意推动课题或承担一部分工作。

认领类型：

- 认领项目负责人。
- 认领实验。
- 认领文献整理。
- 认领数据处理。
- 认领模型实现。
- 认领论文写作。
- 认领医学审核。

第一版认领只是意向，不自动变成任务。后续任务系统上线后，认领可以转成具体任务。

### 12.5 资助意向

资助意向表示用户愿意支持该课题。

资助类型：

- 经费。
- 积分池。
- 算力。
- 数据整理预算。
- 标注预算。
- 专家咨询。
- 学生劳务。
- 论文版面费。
- 其他。

重要边界：

- 第一版不做在线付款。
- 不展示具体支付入口。
- 不承诺收益。
- 只记录意向，由管理员线下联系。

### 12.6 最近动态

课题详情页可以展示简单动态：

- 某用户关注了课题。
- 某用户表达参与意向。
- 某用户评分。
- 管理员修改阶段。

为了隐私，第一版可显示昵称，不显示联系方式。

## 13. 个人工作台模块

登录用户进入 `/dashboard/` 后看到自己的所有记录。

### 13.1 工作台内容

工作台显示：

- 我的关注课题。
- 我的参与意向。
- 我的认领意向。
- 我的资助意向。
- 我的评分记录。
- 我的积分余额。
- 推荐课题。

### 13.2 工作台价值

用户下次登录后能继续查看：

- 我上次对什么课题感兴趣。
- 我申请参与了哪些项目。
- 哪些项目有新动态。
- 我评分过哪些项目。

这正是从静态站升级到正式系统的关键。

## 14. 项目管理模块

### 14.1 项目阶段

建议第一版项目阶段：

```text
draft              草稿
open_recruiting    开放招募
team_building      组队中
active             进行中
experimenting      实验中
writing            写作中
submitted          投稿中
published          已发表
paused             暂停
archived           归档
```

阶段用途：

- 列表筛选。
- 详情页展示。
- 后续自动提醒。
- 管理员判断项目状态。

### 14.2 组队状态

系统按角色统计参与意向：

- 医生人数。
- 学生人数。
- Leader 人数。
- AI 工程师人数。
- 医学统计人数。
- 资助意向数量。

如果医生、学生、Leader 都至少 1 人，则显示“基础团队已具备”。

### 14.3 进度管理

第一版可先不做复杂进度，但数据库和页面应预留：

- 项目状态。
- 最近更新时间。
- 最近动态。
- 管理员备注。

第二版再做：

- 项目里程碑。
- 周报。
- 任务看板。
- 超期提醒。

## 15. 任务、贡献与积分模块

第一版只做基础字段和概念，不必全部做页面。

### 15.1 任务系统

后续每个课题可以拆成任务：

- 文献检索。
- 相关工作整理。
- 数据清洗。
- 数据标注。
- 统计分析。
- 模型训练。
- RAG 实现。
- Agent 流程。
- 实验复现。
- 图表制作。
- 医学审核。
- 论文初稿。
- 论文润色。
- 投稿材料。

任务字段：

- 标题。
- 描述。
- 所属项目。
- 适合角色。
- 难度。
- 截止时间。
- 承诺积分。
- 奖励积分。
- 状态。
- 负责人。

### 15.2 贡献记录

贡献记录用于证明谁做了什么。

字段：

- 用户。
- 课题。
- 任务。
- 贡献标题。
- 贡献说明。
- 文件或链接。
- 审核人。
- 审核结果。
- 获得积分。
- 获得声誉。

### 15.3 积分系统

积分用途：

- 注册奖励。
- 申请高质量项目。
- 认领任务承诺金。
- 完成任务奖励。
- 资助项目积分池。
- 后续使用专家审核或算力服务。

第一版可以先给用户建积分余额字段，但不一定开放复杂流转。

积分账本必须用追加记录方式，不只存余额。

账本字段：

- 用户。
- 课题。
- 任务。
- 操作类型。
- 积分变化。
- 变化后余额。
- 原因。
- 创建人。
- 创建时间。

## 16. 管理后台模块

第一版后台直接使用 Django Admin，不单独写复杂后台。

### 16.1 管理员能做什么

管理员需要能：

- 查看用户列表。
- 搜索用户。
- 查看用户资料。
- 查看课题列表。
- 搜索课题。
- 修改课题阶段。
- 查看关注记录。
- 查看评分记录。
- 查看参与意向。
- 查看认领意向。
- 查看资助意向。
- 查看导入日志。
- 手动调整积分。

### 16.2 后台列表字段

课题列表显示：

- 标题。
- 主题。
- 阶段。
- 初始评分。
- 社区评分。
- 关注数。
- 参与意向数。
- 是否有 PDF。
- 更新时间。

参与意向列表显示：

- 用户。
- 课题。
- 角色。
- 状态。
- 可投入时间。
- 留言。
- 创建时间。

资助意向列表显示：

- 用户。
- 课题。
- 资助类型。
- 状态。
- 备注。
- 创建时间。

### 16.3 基础统计

后台或首页统计：

- 总课题数。
- 总用户数。
- 今日注册用户数。
- 总关注数。
- 总评分数。
- 总参与意向数。
- 总认领意向数。
- 总资助意向数。
- 热门课题。
- 具备基础团队的课题。

## 17. 技术方案

### 17.1 推荐技术栈

推荐使用：

```text
语言：Python
Web 框架：Django
页面：Django Templates + HTML + CSS + 少量 JavaScript
开发数据库：SQLite
正式数据库：PostgreSQL
后台：Django Admin
部署：Gunicorn + Nginx + systemd
静态文件：Django collectstatic + Nginx 或 WhiteNoise
配置：.env
版本管理：Git
```

### 17.2 为什么用 Django

Django 适合这个项目，因为：

- 纯 Python，符合快速开发要求。
- 不需要前端编译。
- 自带用户系统。
- 自带后台管理。
- ORM 和 migration 成熟。
- SQLite 开发很方便。
- 后续切 PostgreSQL 成本低。
- 适合有数据库、后台、权限、表单、模板的系统。

### 17.3 不建议第一版用的方案

不建议第一版使用重前端框架：

- Next.js。
- React SPA。
- Vue SPA。
- 复杂前后端分离。

原因：

- 会引入 Node、构建、打包、接口联调。
- 两个人开发初期会增加沟通成本。
- 当前核心需求是数据库和协作闭环，不是复杂前端动画。

如果后续系统变大，再把前端拆出去。

## 18. 推荐工程结构

建议新建一个干净工程，例如：

```text
openmedailab/
  manage.py
  requirements.txt
  .env.example
  .gitignore
  README.md
  config/
    settings.py
    urls.py
    wsgi.py
    asgi.py
  apps/
    accounts/
      models.py
      views.py
      forms.py
      urls.py
      admin.py
    projects/
      models.py
      views.py
      forms.py
      urls.py
      admin.py
      management/
        commands/
          import_topics.py
    interactions/
      models.py
      views.py
      urls.py
      admin.py
    credits/
      models.py
      admin.py
    dashboard/
      views.py
      urls.py
  templates/
    base.html
    home.html
    accounts/
    projects/
      project_list.html
      project_detail.html
    dashboard/
      dashboard.html
  static/
    css/
      main.css
    js/
      main.js
    logos/
  media/
  deploy/
    nginx.conf.example
    gunicorn.service.example
    install_server.md
```

## 19. 数据库设计

### 19.1 UserProfile

用途：扩展 Django 用户信息。

字段：

- user。
- display_name。
- real_name。
- role_type。
- organization。
- title。
- research_interests。
- skills。
- available_hours_per_week。
- contact_email。
- contact_wechat。
- bio。
- credit_balance。
- reputation_score。
- created_at。
- updated_at。

### 19.2 Theme

用途：课题大主题。

字段：

- name。
- slug。
- description。
- cover_image。
- sort_order。
- is_active。
- created_at。
- updated_at。

### 19.3 Project

用途：课题主体。

字段：

- topic_id。
- title。
- summary。
- body_markdown。
- theme。
- project_no。
- stage。
- source_md_path。
- source_pdf_path。
- content_hash。
- llm_score。
- community_score。
- composite_score。
- recommended_journal。
- needed_roles。
- has_pdf。
- is_public。
- imported_at。
- created_at。
- updated_at。

### 19.4 Tag 和 ProjectTag

用途：标签和课题多对多关系。

Tag 字段：

- name。
- slug。
- created_at。

ProjectTag 字段：

- project。
- tag。

### 19.5 ProjectDocument

用途：保存 Markdown、PDF、附件路径。

字段：

- project。
- doc_type。
- title。
- path。
- content_hash。
- created_at。

### 19.6 ProjectFollow

用途：关注。

字段：

- user。
- project。
- created_at。

唯一约束：

- user + project。

### 19.7 ProjectScore

用途：评分。

字段：

- user。
- project。
- score。
- comment。
- weight。
- created_at。
- updated_at。

唯一约束：

- user + project。

### 19.8 ProjectInterest

用途：参与意向。

字段：

- user。
- project。
- role。
- available_hours_per_week。
- experience。
- message。
- status。
- created_at。
- updated_at。

### 19.9 ProjectClaimIntent

用途：认领意向。

字段：

- user。
- project。
- claim_type。
- message。
- status。
- created_at。
- updated_at。

### 19.10 SponsorIntent

用途：资助意向。

字段：

- user。
- project。
- sponsor_type。
- note。
- status。
- created_at。
- updated_at。

### 19.11 ProjectTask

用途：后续任务系统。

字段：

- project。
- title。
- description。
- task_type。
- required_role。
- difficulty。
- status。
- assignee。
- deadline。
- credit_deposit。
- credit_reward。
- created_at。
- updated_at。

### 19.12 Contribution

用途：贡献记录。

字段：

- user。
- project。
- task。
- title。
- description。
- file_path。
- status。
- reviewer。
- review_comment。
- created_at。
- reviewed_at。

### 19.13 CreditLedger

用途：积分账本。

字段：

- user。
- project。
- task。
- action_type。
- amount。
- balance_after。
- reason。
- created_by。
- created_at。

### 19.14 ImportLog

用途：记录导入历史。

字段：

- source_file。
- total_count。
- created_count。
- updated_count。
- failed_count。
- message。
- created_at。

### 19.15 AuditLog

用途：记录关键操作。

字段：

- actor。
- action。
- target_type。
- target_id。
- before。
- after。
- created_at。

## 20. 页面和路由

### 20.1 页面路由

```text
GET /                         首页
GET /projects/                课题列表
GET /projects/<id>/           课题详情
GET /dashboard/               我的工作台
GET /profile/                 个人资料
GET /accounts/login/          登录
GET /accounts/register/       注册
GET /accounts/logout/         退出
GET /admin/                   管理后台
```

### 20.2 交互路由

```text
POST /projects/<id>/follow/
POST /projects/<id>/unfollow/
POST /projects/<id>/score/
POST /projects/<id>/interest/
POST /projects/<id>/claim/
POST /projects/<id>/sponsor/
```

第一版可以用普通表单 POST，不一定要做 REST API。这样模板开发更快，也更容易处理 CSRF。

### 20.3 查询参数

课题列表支持：

```text
/projects/?q=RAG&theme=ROP&tag=安全鲁棒&stage=open_recruiting&sort=score&page=2
```

参数：

- `q`: 搜索词。
- `theme`: 主题。
- `tag`: 标签。
- `stage`: 阶段。
- `has_pdf`: 是否有 PDF。
- `sort`: 排序。
- `page`: 页码。

## 21. 关键业务流程

### 21.1 用户浏览课题

```text
用户进入首页
  -> 点击主题或浏览课题
  -> 进入课题列表
  -> 搜索/筛选
  -> 点击课题详情
  -> 阅读摘要和正文
  -> 决定是否登录互动
```

### 21.2 用户表达参与意向

```text
用户登录
  -> 进入课题详情
  -> 点击申请参与
  -> 选择角色
  -> 填写经验、时间和留言
  -> 提交
  -> 系统写入 ProjectInterest
  -> 用户工作台显示该课题
  -> 管理后台可查看
```

### 21.3 用户评分

```text
用户登录
  -> 点击评分
  -> 选择 1-10 分
  -> 可填写短评
  -> 提交
  -> 系统创建或更新 ProjectScore
  -> 重新计算 community_score
```

### 21.4 用户关注

```text
用户登录
  -> 点击关注
  -> 系统创建 ProjectFollow
  -> 按钮变成已关注
  -> 工作台显示该课题
```

### 21.5 管理员导入课题

```text
管理员或开发者执行 import_topics
  -> 系统读取 topics_index.json
  -> 写入 Theme/Project/Tag
  -> 写入 ImportLog
  -> 管理员后台检查
```

### 21.6 项目具备启动条件

```text
某课题有医生参与意向
  + 有学生参与意向
  + 有 Leader 参与意向
  -> 系统显示“基础团队已具备”
  -> 管理员联系相关人员
  -> 管理员把阶段改为 team_building 或 active
```

## 22. 钱护磊与王志分工

总体原则：

- 钱护磊偏后端、数据库、业务规则、数据导入和后端可部署性。
- 王志偏前端、页面、交互、视觉、用户体验、服务安装落地和上线检查。
- 两人共同负责接口约定、Git 合并、问题排查和最终验收。
- 两条线并行推进：后端先提供稳定字段和模板变量，前端可先用假数据搭页面，再接真实数据。

## 23. 钱护磊任务清单

钱护磊负责后端与数据侧工作，任务量与王志保持 1:1。重点是系统数据结构正确、业务规则清楚、后端接口稳定、后台可管理、部署时后端配置完整。

### 23.1 项目初始化

钱护磊负责：

- 新建 Django 工程。
- 配置 `requirements.txt`。
- 配置 `.env.example`。
- 配置 `.gitignore`。
- 配置开发 SQLite。
- 配置基础 settings。
- 配置模板目录和静态目录。
- 配置主路由。

交付标准：

- `python manage.py runserver` 能启动。
- 首页路由能打开。
- Git 仓库结构清晰。

### 23.2 数据库模型

钱护磊负责：

- `accounts` app。
- `projects` app。
- `interactions` app。
- `credits` app。
- 所有 model。
- migration。
- model 字段枚举。
- 唯一约束。
- 基础索引。

重点模型：

- UserProfile。
- Theme。
- Project。
- Tag。
- ProjectDocument。
- ProjectFollow。
- ProjectScore。
- ProjectInterest。
- ProjectClaimIntent。
- SponsorIntent。
- CreditLedger。
- ImportLog。

交付标准：

- `python manage.py makemigrations` 成功。
- `python manage.py migrate` 成功。
- Django Admin 能看到主要表。

### 23.3 数据导入

钱护磊负责：

- 编写 `import_topics` management command。
- 支持从 `topics_index.json` 导入。
- 创建或更新 Theme。
- 创建或更新 Project。
- 创建或更新 Tag。
- 创建 ProjectDocument。
- 记录 ImportLog。
- 处理重复导入。
- 处理异常日志。

交付标准：

- 一条命令导入全部课题。
- 重复执行不会重复创建。
- 后台课题数量正确。
- 导入失败能看到错误。

### 23.4 用户认证

钱护磊负责：

- 注册视图。
- 登录视图，可使用 Django 自带。
- 退出视图。
- 注册后自动创建 UserProfile。
- 初始积分。
- 权限判断。

交付标准：

- 用户能注册。
- 用户能登录退出。
- 未登录用户不能提交互动。
- 注册后能进入工作台。

### 23.5 互动后端

钱护磊负责：

- 关注和取消关注逻辑。
- 评分创建和更新逻辑。
- 社区评分重新计算。
- 参与意向提交。
- 认领意向提交。
- 资助意向提交。
- 防止重复记录。
- 记录简单动态。

交付标准：

- 表单提交能写入数据库。
- 用户刷新页面后状态仍保留。
- 管理后台能看到互动。

### 23.6 管理后台

钱护磊负责：

- 注册所有 model 到 Admin。
- 设置 list_display。
- 设置 search_fields。
- 设置 list_filter。
- 配置只读字段。
- 配置批量操作。

交付标准：

- 管理员不用写 SQL 就能查课题和用户互动。
- 可以按主题、阶段、角色筛选。
- 可以修改项目阶段。

### 23.7 统计

钱护磊负责：

- 首页统计查询。
- 课题列表关注数、评分数、参与数。
- 详情页组队统计。
- 热门课题排序数据。

交付标准：

- 首页统计真实来自数据库。
- 详情页组队人数正确。

### 23.8 后端部署适配

钱护磊负责：

- `.env`。
- 数据库迁移。
- 创建管理员。
- 导入课题。
- Gunicorn 启动参数。
- Django 生产配置。
- 静态文件收集命令。
- 数据库连接配置。
- 后端日志配置。
- collectstatic。

交付标准：

- 后端在生产配置下能启动。
- 数据库迁移和课题导入能在服务器上执行。
- 后端错误能通过日志定位。
- 服务安装文档能直接引用这些后端配置。

## 24. 王志任务清单

王志负责前端、页面体验与服务安装侧工作，任务量与钱护磊保持 1:1。重点是用户能顺畅使用系统、页面能清楚表达业务流程、服务能按文档安装并完成上线检查。

### 24.1 页面结构

王志负责：

- 设计 `base.html`。
- 顶部导航。
- 登录状态显示。
- 公共按钮样式。
- 表单样式。
- 分页样式。
- Toast 或消息提示。

交付标准：

- 所有页面视觉一致。
- 页面不依赖复杂前端构建。

### 24.2 首页

王志负责：

- 首页布局。
- 平台统计展示。
- 主题卡片。
- 热门课题区域。
- 快速入口。
- 移动端适配。

交付标准：

- 首页打开后用户能直接进入课题。
- 统计数字清晰。
- 主题入口明确。

### 24.3 课题列表页

王志负责：

- 搜索框。
- 筛选表单。
- 排序选择。
- 课题卡片。
- 分页组件。
- 空结果状态。
- 登录和未登录状态按钮。

交付标准：

- 用户能方便找课题。
- 卡片内容清晰。
- 筛选后 URL 参数可保留。

### 24.4 课题详情页

王志负责：

- 详情页标题区。
- 摘要区。
- 标签区。
- 评分区。
- Markdown 正文展示样式。
- PDF 入口。
- 组队状态展示。
- 互动按钮布局。
- 最近动态展示。

交付标准：

- 课题详情可读。
- 长 Markdown 不显得混乱。
- 用户能明确看到如何参与。

### 24.5 互动表单前端

王志负责：

- 评分表单。
- 参与意向表单。
- 认领意向表单。
- 资助意向表单。
- 成功和失败提示。
- 防止重复点击。

交付标准：

- 表单易填。
- 提交后提示清楚。
- 错误信息能显示。

### 24.6 个人工作台

王志负责：

- 工作台布局。
- 我的关注列表。
- 我的参与意向列表。
- 我的认领意向列表。
- 我的评分列表。
- 我的资助意向列表。
- 返回课题详情按钮。

交付标准：

- 用户登录后能找回自己的课题。
- 工作台页面不拥挤。

### 24.7 前端静态资源

王志负责：

- 整理 logo。
- 整理 CSS。
- 整理少量 JS。
- 确保移动端显示正常。
- 检查不同浏览器基础兼容。

交付标准：

- 页面没有明显错位。
- 按钮文字不溢出。
- 手机和电脑都能用。

### 24.8 服务安装与上线检查

王志负责：

- 服务器基础安装步骤整理。
- Python 虚拟环境安装验证。
- 依赖安装验证。
- 静态文件发布检查。
- Nginx 配置文件整理。
- systemd 配置文件整理。
- 服务器部署后页面检查。
- 静态文件是否加载。
- 登录注册是否正常。
- 筛选、分页、详情是否正常。
- 表单提交是否正常。
- 移动端访问检查。
- 记录上线问题清单。

交付标准：

- 服务安装步骤能被复现。
- Nginx 和 systemd 配置清楚可用。
- 王志从普通用户角度完整走一遍流程。
- 发现页面和交互问题及时修复。

## 25. 两人接口约定

为了减少冲突，两人先约定接口。

### 25.1 模板变量

课题列表页需要：

- `projects`。
- `themes`。
- `tags`。
- `current_filters`。
- `page_obj`。

每个 project 至少有：

- `id`。
- `title`。
- `summary`。
- `theme`。
- `tags`。
- `stage`。
- `llm_score`。
- `community_score`。
- `follow_count`。
- `interest_count`。
- `has_pdf`。
- `user_has_followed`。
- `user_score`。
- `user_interest`。

### 25.2 表单约定

关注表单：

```text
POST /projects/<id>/follow/
```

评分表单：

```text
score: 1-10
comment: optional
```

参与表单：

```text
role
available_hours_per_week
experience
message
```

认领表单：

```text
claim_type
message
```

资助表单：

```text
sponsor_type
note
```

### 25.3 分支约定

建议分支：

```text
main
dev
feature/backend-core
feature/import-topics
feature/project-pages
feature/user-interactions
feature/deploy
```

钱护磊主要用：

- `feature/backend-core`
- `feature/import-topics`
- `feature/user-interactions`
- `feature/deploy`

王志主要用：

- `feature/project-pages`
- `feature/user-interactions`

两人都合并到 `dev`，稳定后合并到 `main`。

## 26. 本地开发安装说明

后续代码建好后，本地开发建议步骤如下。

### 26.1 创建环境

```bash
cd openmedailab
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 26.2 配置环境变量

```bash
cp .env.example .env
```

`.env` 至少包含：

```text
DEBUG=1
SECRET_KEY=change-me
ALLOWED_HOSTS=127.0.0.1,localhost
DATABASE_URL=sqlite:///db.sqlite3
```

### 26.3 初始化数据库

```bash
python manage.py migrate
python manage.py createsuperuser
```

### 26.4 导入课题

```bash
python manage.py import_topics --source ../OpenMedAILab/site/topics_index.json
```

如果未来直接扫描 Markdown：

```bash
python manage.py import_topics --topics-dir ../OpenMedAILab/topics
```

### 26.5 启动开发服务

```bash
python manage.py runserver 0.0.0.0:8000
```

访问：

```text
http://127.0.0.1:8000/
```

后台：

```text
http://127.0.0.1:8000/admin/
```

## 27. 服务器部署安装说明

### 27.1 推荐部署结构

```text
Nginx
  -> Gunicorn
    -> Django
      -> SQLite 或 PostgreSQL
```

第一批用户少时可以先用 SQLite。多人并发增加后切 PostgreSQL。

### 27.2 服务器准备

服务器需要：

- Linux。
- Python 3。
- Nginx。
- Git。
- 项目运行用户，例如 `openmedailab`。

### 27.3 拉取代码

```bash
git clone <repo-url> /opt/openmedailab
cd /opt/openmedailab
```

### 27.4 创建虚拟环境

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 27.5 配置生产环境变量

```bash
cp .env.example .env
```

生产 `.env` 示例：

```text
DEBUG=0
SECRET_KEY=<strong-secret-key>
ALLOWED_HOSTS=your-domain.com,server-ip
DATABASE_URL=sqlite:////opt/openmedailab/db.sqlite3
STATIC_ROOT=/opt/openmedailab/staticfiles
MEDIA_ROOT=/opt/openmedailab/media
```

### 27.6 初始化生产数据库

```bash
source .venv/bin/activate
python manage.py migrate
python manage.py createsuperuser
python manage.py import_topics --source /path/to/topics_index.json
python manage.py collectstatic
```

### 27.7 Gunicorn 测试

```bash
gunicorn config.wsgi:application --bind 127.0.0.1:8000
```

确认能访问后再配置 systemd。

### 27.8 systemd 服务示例

文件：

```text
/etc/systemd/system/openmedailab.service
```

内容示例：

```ini
[Unit]
Description=OpenMedAILab Django service
After=network.target

[Service]
User=openmedailab
Group=openmedailab
WorkingDirectory=/opt/openmedailab
EnvironmentFile=/opt/openmedailab/.env
ExecStart=/opt/openmedailab/.venv/bin/gunicorn config.wsgi:application --workers 3 --bind 127.0.0.1:8000
Restart=always

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable openmedailab
sudo systemctl start openmedailab
sudo systemctl status openmedailab
```

### 27.9 Nginx 配置示例

文件：

```text
/etc/nginx/sites-available/openmedailab
```

内容示例：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /static/ {
        alias /opt/openmedailab/staticfiles/;
    }

    location /media/ {
        alias /opt/openmedailab/media/;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用：

```bash
sudo ln -s /etc/nginx/sites-available/openmedailab /etc/nginx/sites-enabled/openmedailab
sudo nginx -t
sudo systemctl reload nginx
```

### 27.10 数据备份

SQLite 备份：

```bash
mkdir -p /opt/openmedailab/backups
cp /opt/openmedailab/db.sqlite3 /opt/openmedailab/backups/db_$(date +%Y%m%d_%H%M%S).sqlite3
```

PostgreSQL 备份：

```bash
pg_dump openmedailab > /opt/openmedailab/backups/openmedailab_$(date +%Y%m%d_%H%M%S).sql
```

建议建立定期备份机制。

## 28. Git 协作规范

### 28.1 必须忽略的文件

`.gitignore` 建议：

```gitignore
.env
*.sqlite3
db.sqlite3
__pycache__/
*.pyc
.pytest_cache/
media/
staticfiles/
*.log
.venv/
```

### 28.2 提交信息

建议格式：

```text
feat: add project import command
feat: add project list page
fix: prevent duplicate project scores
docs: update deployment guide
```

### 28.3 合并规则

- 每个人在自己的 feature 分支开发。
- 合并前先跑本地服务。
- 合并前确认 migration 可执行。
- 功能稳定后及时合并到 `dev`。
- `main` 只放可部署版本。

## 29. 测试与验收

### 29.1 功能验收

必须通过：

- 首页能打开。
- 课题列表能打开。
- 搜索能用。
- 筛选能用。
- 分页能用。
- 课题详情能打开。
- 用户能注册。
- 用户能登录退出。
- 用户能关注课题。
- 用户能取消关注。
- 用户能评分。
- 用户能更新评分。
- 用户能提交参与意向。
- 用户能提交认领意向。
- 用户能提交资助意向。
- 工作台能看到自己的记录。
- 管理员后台能看到所有记录。
- 未登录用户不能提交互动。
- 数据刷新后不丢。

### 29.2 页面验收

必须检查：

- 桌面端布局正常。
- 手机端布局正常。
- 长标题不溢出。
- 按钮文字不挤压。
- Markdown 正文可读。
- 空数据有提示。
- 表单错误有提示。
- 成功提交有提示。

### 29.3 部署验收

必须检查：

- systemd 服务运行。
- Nginx 转发正常。
- 静态文件加载正常。
- 管理后台可访问。
- 重启服务后网站恢复。
- 服务器重启后服务自动启动。
- 数据库能备份。

## 30. 风险与边界

### 30.1 医学隐私风险

处理原则：

- 第一版不开放患者数据上传。
- 公开课题不包含可识别患者身份的信息。
- 后续上传必须先脱敏。

### 30.2 交易合规风险

处理原则：

- 第一版资助只记录意向。
- 不做在线支付。
- 不承诺投资收益。
- 不承诺参与一定获得论文或金钱回报。

### 30.3 署名争议风险

处理原则：

- 关注、评分、参与意向不等于贡献。
- 积分不等于署名。
- 真实贡献必须有记录和审核。
- 项目启动前应说明署名规则。

### 30.4 刷分风险

处理原则：

- 每个用户每个课题只能一条评分。
- 可更新但保留更新时间。
- 后续引入声誉权重。
- 异常评分由管理员处理。

### 30.5 项目烂尾风险

处理原则：

- 项目启动前检查团队是否齐。
- 后续任务要有截止时间。
- 长期无进展项目进入暂停。
- 积分承诺机制后续再做。

## 31. 后续迭代

### 31.1 第二版

第二版建议做：

- 任务系统。
- 贡献提交。
- 审核流程。
- 积分账本真实流转。
- 项目进度更新。
- 管理员统计看板。

### 31.2 第三版

第三版建议做：

- 专家点评。
- 项目负责人工作区。
- 项目周报。
- 邮件或微信通知。
- 自动提醒。
- 更细的权限。

### 31.3 长期版本

长期可以做：

- 语义搜索。
- LLM 自动摘要。
- LLM 自动拆任务。
- 相似课题推荐。
- 自动检测重复课题。
- 隐私检测。
- 项目成果展示。
- 积分商城或平台服务，但必须先处理合规。

## 32. 最终执行建议

最务实的执行方式是两条线并行推进。

钱护磊主线：

1. 建立 Django 工程、数据库模型和后台管理。
2. 完成课题导入、查询、登录、互动入库和统计。
3. 提供生产环境配置、迁移命令、导入命令和后端日志方案。

王志主线：

1. 建立页面模板、样式体系、首页、课题列表、课题详情和工作台。
2. 完成关注、评分、参与、认领、资助等表单交互和用户提示。
3. 整理服务安装步骤、Nginx/systemd 配置、静态文件发布和上线检查。

共同主线：

1. 共同确认字段、路由、模板变量和表单协议。
2. 共同联调从浏览课题到登录互动再到工作台展示的完整流程。
3. 共同验收后台数据、页面体验、部署访问、备份和风险边界说明。

第一版不要追求功能完整，目标是“能让真实用户用起来，并且所有操作都能记录下来”。只要这个闭环跑通，后面任务、积分、贡献、声誉、项目管理都可以逐步加。
