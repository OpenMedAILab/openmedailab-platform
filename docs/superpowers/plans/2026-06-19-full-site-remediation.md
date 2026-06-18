# OpenMedAI Lab 全站审查问题修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `docs/pm-full-site-audit-2026-06-19.md` 中所有 P1/P2/P3 问题，形成隐私安全、审批闭环、可深链转化、可浏览器验收的全站产品质量基线。

**Architecture:** 先用后端测试锁定隐私、状态机、统计、审批、事务和文件校验规则，再补前端行为、无障碍和移动端体验，最后用 Playwright 级浏览器验收覆盖真实布局和关键用户流。保持现有 Django Ninja API、Vue 单文件入口和本地样式体系，不做大型框架迁移。

**Tech Stack:** Django, Django Ninja, SQLite/PostgreSQL-compatible ORM, Vue 3, Vite, Node test runner, Playwright, CSS.

---

## 0. 执行原则

- 每个任务先写失败测试，再改实现，再运行该任务测试。
- 改动业务规则、API 契约、数据模型、前端入口或验收方式时，同步更新 `AGENTS.md`、`CHANGELOG.md`、`VERSION`。
- 不恢复旧 `ProjectTask` 主流程；任务结果仍为提交后可由管理员查看，不进入主审批流程。
- 不新增平行 API；前端继续经过 `frontend/src/api.js`。
- UI 修复遵守 `ui-ux-pro-max`：键盘可达、触控目标不低于 44px、移动端无横向溢出、toast 可读屏、modal 有焦点管理。

## 1. 分支与基线

**建议分支：** `codex/full-site-remediation-2026-06-19`

**执行前命令：**

```bash
git status --short
cd /Users/wang/CodeWz/lingyi/openmedailab-platform
.venv/bin/python manage.py check
.venv/bin/python manage.py test accounts api projects interactions credits
cd frontend && node --test src/*.test.js && npm run build
```

**基线通过标准：**

- 后端测试通过。
- 前端 Node 测试通过。
- Vite build 通过。
- 当前 dirty worktree 中非本计划文件不得被回退。

## 2. 文件责任图

| 文件 | 责任 |
| --- | --- |
| `interactions/models.py` | Sponsor 审核字段、review-required claim 审核字段复用与条件唯一约束确认 |
| `interactions/migrations/*` | Sponsor 审核字段迁移 |
| `interactions/services.py` | 公开统计注解口径，尤其 sponsor approved count |
| `accounts/models.py` | 联系方式展示范围若经产品确认后在此新增字段；P1 先不强制改 profile 模型 |
| `accounts/forms.py` | 联系方式展示范围若经产品确认后纳入表单 |
| `accounts/migrations/*` | 联系方式可见性迁移仅在产品确认后创建 |
| `api/ninja_api.py` | 隐私裁剪、claim withdraw 规则、sponsor 提交/审批、status-card 结构化字段、失败审计、事务和文件校验 |
| `api/serializers.py` | sponsor payload、admin interaction payload、profile payload、错误或审计摘要映射 |
| `api/tests.py` | 后端主回归：隐私、审批、统计、撤回、排序、上传、备份、审计 |
| `frontend/src/api.js` | 新增或调整 wrapper，保持统一 request |
| `frontend/src/main.js` | 详情页 CTA、modal focus、toast live、资助 token、任务管理 sponsor UID、隐私设置 |
| `frontend/src/styles.css` | 详情页操作区、移动首屏、hover card、modal focus、toast、响应式 |
| `frontend/src/uiPlacement.test.js` | 静态/源码级前端规则补充 |
| `frontend/e2e/*.spec.js` | 真实浏览器验收 |
| `frontend/package.json`、`frontend/package-lock.json` | Playwright 脚本和依赖 |
| `scripts/qa_full.sh` | 统一只读 QA 命令 |
| `AGENTS.md` | 产品规则、API、验收矩阵同步 |
| `docs/user-admin-workspace-execution-and-acceptance.md` | 标记历史归档并指向 AGENTS |
| `CHANGELOG.md`、`VERSION` | 对外版本和变更说明 |

## 3. 任务列表

### Task 1: 匿名隐私边界收口

**目标：** 匿名公开列表、详情、状态卡不暴露创建者姓名、用户名、微信、邮箱；登录态按联系方式可见性规则返回。

**Files:**
- Modify: `api/ninja_api.py`
- Modify: `api/serializers.py`
- Modify: `frontend/src/main.js`
- Modify: `api/tests.py`
- Modify: `frontend/src/uiPlacement.test.js`

- [ ] **Step 1: 写失败测试，锁定匿名 payload**

在 `api/tests.py` 增加测试：

```python
def test_anonymous_project_payload_uses_uid_only_for_creator(self):
    creator = User.objects.create_user(username="privacycreator", email="privacycreator@example.com", password="StrongPass12345")
    creator.profile.display_name = "真实昵称"
    creator.profile.real_name = "真实姓名"
    creator.profile.contact_wechat = "wechat-secret"
    creator.profile.save(update_fields=["display_name", "real_name", "contact_wechat", "updated_at"])
    self.project.created_by = creator
    self.project.save(update_fields=["created_by", "updated_at"])

    response = self.client.get("/api/projects/?page_size=1")

    self.assertEqual(response.status_code, 200)
    payload = json.dumps(response.json()["data"]["results"][0], ensure_ascii=False)
    self.assertIn(creator.profile.uid, payload)
    self.assertNotIn("真实昵称", payload)
    self.assertNotIn("真实姓名", payload)
    self.assertNotIn("privacycreator", payload)
    self.assertNotIn("wechat-secret", payload)
    creator_payload = response.json()["data"]["results"][0]["created_by_display"]
    self.assertEqual(creator_payload["uid"], creator.profile.uid)
    self.assertNotIn("name", creator_payload)
    self.assertNotIn("wechat", creator_payload)
```

- [ ] **Step 2: 运行失败测试**

```bash
.venv/bin/python manage.py test api.tests.ProjectApiTests.test_anonymous_project_payload_uses_uid_only_for_creator
```

Expected: 当前实现失败，原因是匿名 payload 包含 `name`。

- [ ] **Step 3: 实现隐私裁剪**

在 `api/ninja_api.py` 中拆分联系人 payload：

```python
def public_uid_contact_payload(user):
    if not user:
        return None
    profile = getattr(user, "profile", None)
    return {"uid": getattr(profile, "uid", None)}


def collaboration_contact_payload(user, include_name=False, include_wechat=False):
    if not user:
        return None
    profile = getattr(user, "profile", None)
    payload = {"uid": getattr(profile, "uid", None)}
    if include_name:
        payload["name"] = collaboration_display_name(user)
    if include_wechat:
        payload["wechat"] = getattr(profile, "contact_wechat", "")
        payload["wechat_visible"] = bool(getattr(profile, "contact_wechat", ""))
    return payload
```

在 `enrich_project_collaboration_payload()` 中匿名只返回 UID：

```python
def enrich_project_collaboration_payload(payload, project, user):
    authenticated = bool(getattr(user, "is_authenticated", False))
    payload["created_by_display"] = (
        collaboration_contact_payload(project.created_by, include_name=True, include_wechat=True)
        if authenticated
        else public_uid_contact_payload(project.created_by)
    )
    payload["team_contact_groups"] = project_team_contact_groups(project, include_wechat=authenticated) if authenticated else []
    return payload
```

前端 `projectCreatorLabel()` 保持兼容：优先 `name`，否则 UID。

- [ ] **Step 4: 运行隐私回归**

```bash
.venv/bin/python manage.py test api.tests.ProjectApiTests.test_anonymous_project_payload_uses_uid_only_for_creator
node --test frontend/src/uiPlacement.test.js
```

Expected: PASS。

### Task 2: 联系方式展示范围产品门禁

**目标：** 不把“登录后默认可见全部成员姓名/微信”作为本轮 P1 必修策略改动。P1 只修 Task 1 的匿名泄露；联系方式展示范围属于隐私产品策略，必须先形成可选方案、影响面和验收标准，再由产品确认是否进入本轮实现。

**Files:**
- Modify: `docs/pm-full-site-audit-2026-06-19.md` 或追加本计划决策记录
- Conditional Modify: `accounts/models.py`
- Conditional Modify: `accounts/forms.py`
- Conditional Create: `accounts/migrations/0007_userprofile_contact_visibility.py`
- Conditional Modify: `api/ninja_api.py`
- Conditional Modify: `api/serializers.py`
- Conditional Modify: `frontend/src/main.js`
- Conditional Modify: `api/tests.py`
- Conditional Modify: `AGENTS.md`

- [ ] **Step 1: 写产品决策记录，不直接改代码**

在本计划执行记录或 PM 审查文档中补一段决策：

```markdown
联系方式展示范围不是本轮 P1 bug 修复的前置条件。P1 只保证匿名访客只能看到 UID。

如产品确认需要继续收紧登录态联系方式，可选方案如下：
- 方案 A：默认仅同课题已通过参与/认领成员和管理员可见，用户可放宽到所有登录用户。
- 方案 B：默认所有登录用户可见，用户可主动收紧。
- 方案 C：不新增设置，只在 hover 卡内弱化微信，仅保留 UID。

推荐方案 A，但只有在产品确认后才创建模型字段和迁移。
```

- [ ] **Step 2: 若产品确认方案 A，再写后端失败测试**

在 `api/tests.py` 增加：

```python
def test_contact_wechat_visible_only_to_related_users_after_visibility_feature_enabled(self):
    member = User.objects.create_user(username="visiblemember", email="visiblemember@example.com", password="StrongPass12345")
    viewer = User.objects.create_user(username="unrelatedviewer", email="unrelatedviewer@example.com", password="StrongPass12345")
    teammate = User.objects.create_user(username="relatedviewer", email="relatedviewer@example.com", password="StrongPass12345")
    member.profile.contact_wechat = "member-wechat"
    member.profile.contact_visibility = "project_related"
    member.profile.save(update_fields=["contact_wechat", "contact_visibility", "updated_at"])
    ProjectInterest.objects.create(user=member, project=self.project, role="医生", status=InteractionStatus.APPROVED)
    ProjectInterest.objects.create(user=teammate, project=self.project, role="学生", status=InteractionStatus.APPROVED)

    self.client.force_login(viewer)
    unrelated = self.client.get("/api/projects/?page_size=1").json()["data"]["results"][0]
    self.assertNotIn("member-wechat", json.dumps(unrelated, ensure_ascii=False))

    self.client.force_login(teammate)
    related = self.client.get("/api/projects/?page_size=1").json()["data"]["results"][0]
    self.assertIn("member-wechat", json.dumps(related, ensure_ascii=False))
```

- [ ] **Step 3: 若产品确认方案 A，再新增模型字段**

在 `accounts/models.py` 添加 choices：

```python
class ContactVisibility(models.TextChoices):
    PROJECT_RELATED = "project_related", "仅同项目成员和管理员可见"
    LOGGED_IN = "logged_in", "所有登录用户可见"
    ADMIN_ONLY = "admin_only", "仅管理员可见"
    HIDDEN = "hidden", "不公开"
```

在 `UserProfile` 增加：

```python
contact_visibility = models.CharField(
    max_length=32,
    choices=ContactVisibility.choices,
    default=ContactVisibility.PROJECT_RELATED,
)
```

在 `accounts/forms.py` 把 `contact_visibility` 纳入 `UserProfileForm.Meta.fields`。

- [ ] **Step 4: 若产品确认方案 A，再实现可见性判断**

在 `api/ninja_api.py` 添加：

```python
def can_view_collaboration_contact(viewer, target_user, project=None):
    if not getattr(viewer, "is_authenticated", False) or not target_user:
        return False
    if has_capability(viewer, "manage_projects"):
        return True
    profile = getattr(target_user, "profile", None)
    visibility = getattr(profile, "contact_visibility", "project_related")
    if visibility == "logged_in":
        return True
    if visibility in {"admin_only", "hidden"}:
        return False
    if not project:
        return False
    return user_has_approved_project_relation(viewer, project)
```

调整 `project_team_contact_groups(project, viewer)`，按每个成员调用 `can_view_collaboration_contact(viewer, user, project)` 后才带 `name/wechat`。

- [ ] **Step 5: 若产品确认方案 A，再实现前端资料页设置**

在个人资料表单加入 select：

```html
<label>
  <span>联系方式展示范围</span>
  <select v-model="state.forms.profile.contact_visibility">
    <option value="project_related">仅同项目成员和管理员可见</option>
    <option value="logged_in">所有登录用户可见</option>
    <option value="admin_only">仅管理员可见</option>
    <option value="hidden">不公开</option>
  </select>
</label>
```

`profileFormFromUser()` 和 `profilePayloadFromForm()` 同步该字段。

- [ ] **Step 6: 门禁验收**

```bash
rg -n "contact_visibility|ContactVisibility" accounts api frontend/src/main.js AGENTS.md
.venv/bin/python manage.py test api.tests.ProjectApiTests.test_anonymous_project_payload_uses_uid_only_for_creator
```

Expected:

- 产品未确认时，除文档外不出现 `contact_visibility` 新字段，不产生迁移。
- 产品确认并执行方案 A 后，必须通过后端联系方式范围测试、profile 表单测试、资料页构建测试，并同步 `AGENTS.md`。

### Task 3: 资助审批闭环、统计口径和重复提交

**目标：** sponsor 审批意见持久化并对申请人可见；公开 sponsor count 只统计 approved；重复提交不把 approved 回退为 pending；token 资助入口完整可达。

**Files:**
- Modify: `interactions/models.py`
- Create: `interactions/migrations/0006_sponsor_review_fields.py`
- Modify: `interactions/admin.py`
- Modify: `interactions/services.py`
- Modify: `api/ninja_api.py`
- Modify: `api/serializers.py`
- Modify: `api/tests.py`
- Modify: `frontend/src/main.js`
- Modify: `frontend/src/uiPlacement.test.js`

- [ ] **Step 1: 写 sponsor 审批字段测试**

在 `api/tests.py` 添加：

```python
def test_sponsor_review_note_is_persisted_and_visible_to_applicant(self):
    sponsor = User.objects.create_user(username="sponsorreview", email="sponsorreview@example.com", password="StrongPass12345")
    intent = SponsorIntent.objects.create(user=sponsor, project=self.project, sponsor_type="compute", status=InteractionStatus.PENDING)
    admin = self.login_platform_admin()

    response = self.patch_json(
        f"/api/admin/interactions/sponsor/{intent.pk}/status/",
        {"status": "rejected", "review_note": "算力额度信息不足"},
    )

    self.assertEqual(response.status_code, 200)
    intent.refresh_from_db()
    self.assertEqual(intent.review_comment, "算力额度信息不足")
    self.assertEqual(intent.reviewed_by, admin)
    self.client.force_login(sponsor)
    dashboard = self.client.get("/api/me/dashboard/").json()["data"]
    row = next(item for item in dashboard["sponsors"] if item["id"] == intent.pk)
    self.assertEqual(row["review_comment"], "算力额度信息不足")
    self.assertEqual(row["reviewed_by"]["uid"], admin.profile.uid)

    admin_list = self.client.get("/api/admin/interactions/?type=sponsor").json()["data"]["results"]
    admin_row = next(item for item in admin_list if item["id"] == intent.pk)
    self.assertEqual(admin_row["review_comment"], "算力额度信息不足")
    self.assertEqual(admin_row["reviewed_by"]["uid"], admin.profile.uid)
```

- [ ] **Step 2: 写 sponsor count 测试**

```python
def test_project_sponsor_count_only_counts_approved_intents(self):
    pending = User.objects.create_user(username="pendingfund", email="pendingfund@example.com", password="StrongPass12345")
    approved = User.objects.create_user(username="approvedfund", email="approvedfund@example.com", password="StrongPass12345")
    rejected = User.objects.create_user(username="rejectedfund", email="rejectedfund@example.com", password="StrongPass12345")
    SponsorIntent.objects.create(user=pending, project=self.project, sponsor_type="compute", status=InteractionStatus.PENDING)
    SponsorIntent.objects.create(user=approved, project=self.project, sponsor_type="labor_fee", status=InteractionStatus.APPROVED)
    SponsorIntent.objects.create(user=rejected, project=self.project, sponsor_type="token", status=InteractionStatus.REJECTED)

    response = self.client.get("/api/projects/?page_size=1")

    self.assertEqual(response.status_code, 200)
    project = response.json()["data"]["results"][0]
    self.assertEqual(project["sponsor_count"], 1)
    self.assertEqual(project["team_status"]["sponsor_count"], 1)
```

- [ ] **Step 3: 写重复提交测试**

```python
def test_resubmitting_approved_sponsor_does_not_reset_status(self):
    sponsor = User.objects.create_user(username="sponsorrepeat", email="sponsorrepeat@example.com", password="StrongPass12345")
    sponsor.profile.credit_balance = 100
    sponsor.profile.save(update_fields=["credit_balance", "updated_at"])
    intent = SponsorIntent.objects.create(user=sponsor, project=self.project, sponsor_type="compute", status=InteractionStatus.APPROVED)
    self.client.force_login(sponsor)

    response = self.post_json(f"/api/projects/{self.project.pk}/sponsor/", {"sponsor_type": "compute", "note": "补充说明"})

    self.assertEqual(response.status_code, 200)
    intent.refresh_from_db()
    self.assertEqual(intent.status, InteractionStatus.APPROVED)
    self.assertEqual(intent.note, "补充说明")
```

- [ ] **Step 4: 写多类型和状态展示测试**

```python
def test_sponsor_multiple_types_and_statuses_are_serialized_consistently(self):
    sponsor = User.objects.create_user(username="sponsormulti", email="sponsormulti@example.com", password="StrongPass12345")
    SponsorIntent.objects.create(user=sponsor, project=self.project, sponsor_type="labor_fee", status=InteractionStatus.PENDING)
    SponsorIntent.objects.create(user=sponsor, project=self.project, sponsor_type="compute", status=InteractionStatus.APPROVED)
    SponsorIntent.objects.create(user=sponsor, project=self.project, sponsor_type="token", status=InteractionStatus.WITHDRAWN)

    self.client.force_login(sponsor)
    dashboard = self.client.get("/api/me/dashboard/").json()["data"]
    types = {(item["sponsor_type"], item["status"]) for item in dashboard["sponsors"]}
    self.assertIn(("labor_fee", "pending"), types)
    self.assertIn(("compute", "approved"), types)
    self.assertIn(("token", "withdrawn"), types)

    detail = self.client.get(f"/api/projects/{self.project.pk}/status-card/").json()["data"]
    groups = detail["uid_groups"]["groups"]
    approved_sponsor = [group for group in groups if group["type"] == "sponsor" and group["status"] == "approved"]
    self.assertTrue(approved_sponsor)
    self.assertFalse(any(group["type"] == "sponsor" and group["status"] == "pending" and group.get("label") == "已获批资助" for group in groups))
```

- [ ] **Step 5: 实现模型、admin 和 serializer**

`SponsorIntent` 增加：

```python
review_comment = models.TextField(blank=True)
reviewed_by = models.ForeignKey(
    settings.AUTH_USER_MODEL,
    on_delete=models.SET_NULL,
    null=True,
    blank=True,
    related_name="reviewed_sponsor_intents",
)
reviewed_at = models.DateTimeField(null=True, blank=True)
```

`sponsor_payload()` 增加：

```python
"review_comment": getattr(sponsor, "review_comment", ""),
"reviewed_by": uid_only_user_payload(sponsor.reviewed_by) if getattr(sponsor, "reviewed_by_id", None) else None,
"reviewed_at": getattr(sponsor, "reviewed_at", None),
```

`interaction_payload()` 同步 sponsor 审批字段，避免管理端只在 dashboard 可见。最终契约为：`review_comment/reviewed_by/reviewed_at` 作为 interaction 顶层字段返回，同时在 `detail` 中保留同名字段，便于旧前端读取。

```python
if kind == "sponsor":
    reviewed_by_payload = uid_only_user_payload(item.reviewed_by) if getattr(item, "reviewed_by_id", None) else None
    payload.update({
        "review_comment": getattr(item, "review_comment", ""),
        "reviewed_by": reviewed_by_payload,
        "reviewed_at": getattr(item, "reviewed_at", None),
    })
    detail.update({
        "sponsor_type": getattr(item, "sponsor_type", ""),
        "sponsor_type_label": getattr(item, "get_sponsor_type_display", lambda: "")(),
        "review_comment": getattr(item, "review_comment", ""),
        "reviewed_by": reviewed_by_payload,
        "reviewed_at": getattr(item, "reviewed_at", None),
    })
```

`interactions/admin.py` 把 `review_comment`、`reviewed_by`、`reviewed_at` 加入 sponsor 管理展示，queryset 对 `reviewed_by` 做 `select_related`。

- [ ] **Step 6: 实现审批写入**

在 `admin_interaction_update_status()` 中，sponsor 和 claim 都写审核字段：

```python
if type in {"claim", "sponsor"}:
    item.review_comment = payload.review_note or ""
    item.reviewed_by = request.user
    item.reviewed_at = timezone.now()
    update_fields.extend(["review_comment", "reviewed_by", "reviewed_at"])
```

审批测试必须覆盖 approved 和 rejected 两种状态：

```python
for status, note in [("approved", "额度确认"), ("rejected", "信息不足")]:
    response = self.patch_json(f"/api/admin/interactions/sponsor/{intent.pk}/status/", {"status": status, "review_note": note})
    self.assertEqual(response.status_code, 200)
    self.assertEqual(response.json()["data"]["review_comment"], note)
```

- [ ] **Step 7: 实现统计口径**

在 `interactions/services.py` 改为条件 Count：

```python
from django.db.models import Count, Q

sponsor_count=Count(
    "sponsor_intents",
    filter=Q(sponsor_intents__status=InteractionStatus.APPROVED),
    distinct=True,
)
```

- [ ] **Step 8: 实现 sponsor 重复提交语义**

在 `sponsor_project()` 中改为：已有 approved/pending 不回退状态，只更新 note 并返回 200；withdrawn/rejected 可重新变 pending。

```python
with transaction.atomic():
    sponsor, created = SponsorIntent.objects.select_for_update().get_or_create(
        user=request.user,
        project=project,
        sponsor_type=form.cleaned_data["sponsor_type"],
        defaults={"note": form.cleaned_data.get("note", ""), "status": InteractionStatus.PENDING},
    )
    if not created:
        sponsor.note = form.cleaned_data.get("note", "")
        if sponsor.status in {InteractionStatus.REJECTED, InteractionStatus.WITHDRAWN}:
            sponsor.status = InteractionStatus.PENDING
            sponsor.review_comment = ""
            sponsor.reviewed_by = None
            sponsor.reviewed_at = None
        sponsor.save(update_fields=["note", "status", "review_comment", "reviewed_by", "reviewed_at", "updated_at"])
```

Return status code: `201` when created or resubmitted from rejected/withdrawn, `200` when only updating active note.

审计语义：

- active pending/approved 只更新 note：写 `interaction.sponsor_update_note`，审计 detail 包含 `before_note`、`after_note`、`status`。
- rejected/withdrawn 重新提交：写 `interaction.sponsor_resubmit`，清空 `review_comment/reviewed_by/reviewed_at`。
- 并发重复提交：只保留同一 `user/project/sponsor_type` 的一个 active row，不产生 IntegrityError 暴露给用户。

- [ ] **Step 9: token 资助入口**

资助 popover 主视图只展示两个近距 checkbox：`资助劳务费`、`资助算力`，满足用户原始要求。`token` 通过同一 popover 的轻量二级入口可达，不作为默认并列第三项。

改资助类型配置：

```js
const PRIMARY_SPONSOR_TYPES = ["labor_fee", "compute"];
const SECONDARY_SPONSOR_TYPES = ["token"];
```

交互要求：

- 点击 `资助` 后，按钮旁弹出两个距离不超过 `16px` 的 checkbox：`资助劳务费`、`资助算力`，可多选。
- 点击 `更多资助类型` 后在同一 popover 下方展开 `资助 token`。
- 键盘 Tab 顺序为按钮、劳务费、算力、更多资助类型、token、提交。
- 同一用户同一课题可一次提交多个 sponsor type；提交后 viewer_state 只把 pending/approved 类型视为 active。

- [ ] **Step 10: 运行测试**

```bash
.venv/bin/python manage.py makemigrations interactions
.venv/bin/python manage.py test api interactions
node --test frontend/src/*.test.js
```

Expected:

- sponsor 审批字段在 admin list、admin review response、dashboard 三个入口一致。
- sponsor count 只统计 approved。
- pending/approved 重提不回退状态。
- rejected/withdrawn 重提清空旧审核意见。
- 劳务费/算力为主 checkbox；token 通过更多类型入口可提交、撤回、审批、展示。

### Task 4: 认领撤回状态机统一

**目标：** pending 项目负责人/论文第一单位认领不能通过 API 撤回；approved 后才可撤回。普通参与和资助仍可撤回 pending/approved。

**Files:**
- Modify: `interactions/models.py`
- Modify: `interactions/migrations/*` only if current conditional constraints are missing
- Modify: `api/ninja_api.py`
- Modify: `api/tests.py`
- Modify: `frontend/src/main.js`
- Modify: `AGENTS.md`

- [ ] **Step 1: 更新失败测试**

在 `api/tests.py` 添加：

```python
def test_pending_review_required_claim_cannot_be_withdrawn_by_user(self):
    user = User.objects.create_user(username="pendingclaimwithdraw", email="pendingclaimwithdraw@example.com", password="StrongPass12345")
    claim = ProjectClaimIntent.objects.create(user=user, project=self.project, claim_type="leader", status=InteractionStatus.PENDING)
    self.client.force_login(user)

    response = self.patch_json(f"/api/me/interactions/claim/{claim.pk}/withdraw/", {"reason": "想撤回"})

    self.assertEqual(response.status_code, 422)
    self.assertEqual(response.json()["error"]["code"], "claim_pending_cannot_withdraw")
    claim.refresh_from_db()
    self.assertEqual(claim.status, InteractionStatus.PENDING)
```

同步修改旧测试中 pending leader withdraw 的断言：先由管理员 approve，再验证 withdraw 成功。

- [ ] **Step 2: 写席位唯一性和释放测试**

必须显式覆盖两个 claim type：`leader` 和 `paper_first_unit`。

```python
def test_review_required_claim_slots_are_occupied_by_pending_and_approved_only(self):
    owner = User.objects.create_user(username="claimowner", email="claimowner@example.com", password="StrongPass12345")
    other = User.objects.create_user(username="claimother", email="claimother@example.com", password="StrongPass12345")
    ProjectClaimIntent.objects.create(user=owner, project=self.project, claim_type="leader", status=InteractionStatus.PENDING)
    self.client.force_login(other)

    response = self.post_json(f"/api/projects/{self.project.pk}/claim/", {"claim_type": "leader"})

    self.assertEqual(response.status_code, 409)
    self.assertEqual(response.json()["error"]["code"], "claim_slot_occupied")

    ProjectClaimIntent.objects.filter(user=owner, project=self.project, claim_type="leader").update(status=InteractionStatus.REJECTED)
    response = self.post_json(f"/api/projects/{self.project.pk}/claim/", {"claim_type": "leader"})
    self.assertIn(response.status_code, {200, 201})
```

再加一条 `TransactionTestCase` 或等价并发测试：两个用户同时提交同一课题同一 `claim_type`，最终只能有一个 `pending/approved` active claim；另一个返回 `409 claim_slot_occupied` 或可理解错误，不允许数据库 IntegrityError 原样冒泡。

- [ ] **Step 3: 确认数据约束**

在 `interactions/models.py` 核对 `ProjectClaimIntent` 条件唯一约束；若缺失则补迁移：

```python
models.UniqueConstraint(
    fields=["project", "claim_type"],
    condition=Q(
        status__in=[InteractionStatus.PENDING, InteractionStatus.APPROVED],
        claim_type__in=[ClaimType.LEADER, ClaimType.PAPER_FIRST_UNIT],
    ),
    name="unique_active_review_required_claim_per_project_type",
)
```

验收要求：

- pending/approved 占位。
- rejected/withdrawn 释放席位。
- admin 审批 pending claim 为 approved 前，在事务内重检同类 active slot；若已有 approved，返回 `409 claim_slot_occupied`，并写 failed audit。
- 用户提交 claim 在事务内 `select_for_update()` 锁定 project，并捕获 `IntegrityError` 映射为 `409 claim_slot_occupied`。
- claim 提交接口和 `admin_interaction_update_status()` 都要在 Ninja response schema 中声明 `409: ErrorEnvelope`。

- [ ] **Step 4: 后端实现状态限制**

在 `me_interaction_withdraw()` 中增加：

```python
with transaction.atomic():
    item = queryset.select_for_update().get(pk=interaction_id, user=request.user)
    if type == "claim" and getattr(item, "claim_type", "") in REVIEW_REQUIRED_CLAIM_TYPES:
        if item.status == InteractionStatus.PENDING:
            audit(request.user, "interaction.withdraw", item.__class__.__name__, item.pk, status="failed", error_code="claim_pending_cannot_withdraw")
            return fail("认领正在审批中，审批通过后才可撤回。", status=422, code="claim_pending_cannot_withdraw")
        if item.status != InteractionStatus.APPROVED:
            audit(request.user, "interaction.withdraw", item.__class__.__name__, item.pk, status="failed", error_code="interaction_not_withdrawable")
            return fail("当前认领状态不可撤回。", status=422, code="interaction_not_withdrawable")
```

同步更新 Ninja 路由 response schema，明确该接口可能返回 `422`：

```python
@api.patch("/me/interactions/{type}/{interaction_id}/withdraw/", response={200: Envelope, 400: ErrorEnvelope, 401: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope, 422: ErrorEnvelope})
```

- [ ] **Step 5: 前端错误提示和文案测试**

保持 `WITHDRAWABLE_CLAIM_STATUSES = new Set(["approved"])`。在通用 `withdrawInteraction()` catch 中补默认文案：

```js
showToast(error.message || "撤回失败");
```

在 `frontend/src/uiPlacement.test.js` 加静态断言，禁止泛称回归：

```js
test("withdraw labels always include concrete interaction type", () => {
  assert.doesNotMatch(mainSource, />\\s*撤回认领\\s*</);
  assert.doesNotMatch(mainSource, />\\s*撤回第一单位\\s*</);
  assert.match(mainSource, /撤回认领项目负责人/);
  assert.match(mainSource, /撤回第一单位认领/);
});
```

按钮状态验收：

- `leader pending`：按钮文案 `项目负责人审批中`，不可撤回。
- `paper_first_unit pending`：按钮文案 `第一单位认领审批中`，不可撤回。
- `leader approved`：按钮文案 `撤回认领项目负责人`。
- `paper_first_unit approved`：按钮文案 `撤回第一单位认领`。

- [ ] **Step 6: 运行测试**

```bash
.venv/bin/python manage.py test api.tests.ProjectApiTests.test_pending_review_required_claim_cannot_be_withdrawn_by_user api.tests.ProjectApiTests.test_review_required_claim_slots_are_occupied_by_pending_and_approved_only
node --test frontend/src/uiPlacement.test.js
```

Expected:

- pending claim withdraw 返回 422 且写 failed audit。
- approved claim withdraw 返回 200。
- 一个课题同一时刻最多一个 active 项目负责人认领、一个 active 第一单位认领。
- rejected/withdrawn 释放席位。
- 前端不存在泛称“撤回认领”按钮。

### Task 5: 课题详情页复用协作 CTA

**目标：** 公开课题详情页深链具备首页卡片同等协作能力。

**Files:**
- Modify: `frontend/src/main.js`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/uiPlacement.test.js`
- Create/Modify: `frontend/e2e/project-detail-actions.spec.js`

- [ ] **Step 1: 写静态测试**

在 `frontend/src/uiPlacement.test.js` 增加：

```js
test("project progress page exposes the same core interaction actions as project cards", () => {
  assert.match(mainSource, /class="project-progress-actions"/);
  assert.match(mainSource, /submitLike\\(state\\.projectProgress\\.project\\)/);
  assert.match(mainSource, /toggleFollow\\(state\\.projectProgress\\.project\\)/);
  assert.match(mainSource, /handleParticipationAction\\(state\\.projectProgress\\.project\\)/);
  assert.match(mainSource, /submitLeadClaim\\(state\\.projectProgress\\.project,\\s*\\$event\\)/);
  assert.match(mainSource, /submitPaperClaim\\(state\\.projectProgress\\.project,\\s*\\$event\\)/);
  assert.match(mainSource, /submitSponsor\\(state\\.projectProgress\\.project,\\s*\\$event\\)/);
});
```

- [ ] **Step 2: 实现详情页 action 区**

在 `project-progress-head` 后加入：

```html
<div class="project-progress-actions project-interaction-actions" v-if="state.projectProgress.project">
  <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('like', state.projectProgress.project) }" type="button" :disabled="isSubmittingLike(state.projectProgress.project)" @click.stop="submitLike(state.projectProgress.project)">
    <span class="material-symbols-rounded interaction-icon" aria-hidden="true">thumb_up</span>
    <span>{{ likeButtonLabel(state.projectProgress.project) }}</span>
  </button>
  <button v-if="shouldShowFollowButton(state.projectProgress.project)" class="ghost-button interaction-button follow-button" :class="{ active: isProjectFollowing(state.projectProgress.project), 'interaction-active': interactionButtonActive('follow', state.projectProgress.project) }" type="button" @click.stop="toggleFollow(state.projectProgress.project)">
    <span class="material-symbols-rounded interaction-icon" aria-hidden="true">star</span>
    <span>{{ followButtonLabel(state.projectProgress.project) }}</span>
  </button>
  <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('participation', state.projectProgress.project) }" type="button" :disabled="!canClickParticipation(state.projectProgress.project)" @click.stop="handleParticipationAction(state.projectProgress.project)">
    <span class="material-symbols-rounded interaction-icon" aria-hidden="true">groups</span>
    <span>{{ participationButtonLabel(state.projectProgress.project) }}</span>
  </button>
  <button class="ghost-button interaction-button claim-action-button" :class="{ 'interaction-active': interactionButtonActive('lead', state.projectProgress.project), 'is-disabled': !canClickLeadClaim(state.projectProgress.project) }" type="button" :aria-disabled="claimButtonAriaDisabled(state.projectProgress.project, 'leader')" @mouseenter="showClaimReasonTooltip($event, state.projectProgress.project, 'leader')" @focus="showClaimReasonTooltip($event, state.projectProgress.project, 'leader')" @touchstart.passive="showClaimReasonTooltip($event, state.projectProgress.project, 'leader')" @mouseleave="hideClaimReasonTooltip" @blur="hideClaimReasonTooltip" @click.stop="submitLeadClaim(state.projectProgress.project, $event)">
    <span class="material-symbols-rounded interaction-icon" aria-hidden="true">supervisor_account</span>
    <span>{{ leadClaimButtonLabel(state.projectProgress.project) }}</span>
  </button>
  <button class="ghost-button interaction-button claim-action-button" :class="{ 'interaction-active': interactionButtonActive('paper', state.projectProgress.project), 'is-disabled': !canClickPaperClaim(state.projectProgress.project) }" type="button" :aria-disabled="claimButtonAriaDisabled(state.projectProgress.project, 'paper_first_unit')" @mouseenter="showClaimReasonTooltip($event, state.projectProgress.project, 'paper_first_unit')" @focus="showClaimReasonTooltip($event, state.projectProgress.project, 'paper_first_unit')" @touchstart.passive="showClaimReasonTooltip($event, state.projectProgress.project, 'paper_first_unit')" @mouseleave="hideClaimReasonTooltip" @blur="hideClaimReasonTooltip" @click.stop="submitPaperClaim(state.projectProgress.project, $event)">
    <span class="material-symbols-rounded interaction-icon" aria-hidden="true">workspace_premium</span>
    <span>{{ paperClaimButtonLabel(state.projectProgress.project) }}</span>
  </button>
  <button class="ghost-button interaction-button sponsor-action-button" :class="{ 'interaction-active': interactionButtonActive('sponsor', state.projectProgress.project) }" type="button" :disabled="!canClickSponsor(state.projectProgress.project)" aria-controls="sponsor-popover" :aria-expanded="state.sponsorModal.open && state.sponsorModal.project?.id === state.projectProgress.project.id ? 'true' : 'false'" @click.stop="submitSponsor(state.projectProgress.project, $event)">
    <span class="material-symbols-rounded interaction-icon" aria-hidden="true">volunteer_activism</span>
    <span>{{ sponsorButtonLabel(state.projectProgress.project) }}</span>
  </button>
</div>
```

认领按钮禁止使用原生 `disabled` 属性表达不可操作，因为 disabled 元素不能稳定接收 hover/focus/tap。实现要求：

- 不可操作时使用 `aria-disabled="true"` 和 `.is-disabled` 样式。
- `submitLeadClaim()` / `submitPaperClaim()` 第一行检查 `canClick...`；不可提交时只调用 `showClaimReasonTooltip()` 或移动端 toast，不发送 API 请求。
- Playwright 必须断言不可认领按钮可 focus，且 `aria-disabled="true"`。

- [ ] **Step 3: 样式**

在 `styles.css` 增加：

```css
.project-progress-actions {
  margin-top: -4px;
  max-width: none;
}

@media (max-width: 640px) {
  .project-progress-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 4: 局部刷新同步**

确认 `refreshProjectStatus()` 已同步 `state.projectProgress.project`；如缺少 `viewer_state`，补充：

```js
if (state.projectProgress.project?.id === id) {
  Object.assign(state.projectProgress.project, latestProject);
  if (latestViewerState) state.projectProgress.project.viewer_state = latestViewerState;
  applyProjectViewerState(state.projectProgress.project);
}
```

- [ ] **Step 5: 运行测试**

```bash
node --test frontend/src/uiPlacement.test.js
npm run test:e2e -- project-core.spec.js --grep "project detail runs a real collaboration CTA flow"
npm run build
```

Expected:

- 详情页存在同等 CTA，构建通过。
- 访客点击协作 CTA 获得登录提示。
- 登录用户可在详情页真实完成点赞、关注、参与、资助多选提交，并触发局部状态刷新。
- 不可认领时，桌面 hover/focus 在按钮旁显示原因，移动端 tap 显示 toast。原因覆盖：未登录、课题阶段不可认领、已有 active 认领、本人 pending 审批中、积分不足、并发冲突。

### Task 6: Modal 焦点管理、toast live region、装饰图标语义

**目标：** 所有 modal 打开后焦点进入弹窗、Tab 不逃逸、关闭回到触发控件；toast 可被读屏感知；装饰图标不污染可访问名称。

**Files:**
- Modify: `frontend/src/main.js`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/uiPlacement.test.js`
- Create/Modify: `frontend/e2e/accessibility.spec.js`

- [ ] **Step 1: 写静态测试**

在 `frontend/src/uiPlacement.test.js` 增加：

```js
test("modals and toast expose accessible focus and live-region hooks", () => {
  assert.match(mainSource, /ref="confirmDialogRef"/);
  assert.match(mainSource, /function trapModalFocus/);
  assert.match(mainSource, /aria-live="polite"/);
  assert.match(mainSource, /role="status"/);
  assert.match(mainSource, /aria-hidden="true">library_books/);
  assert.match(mainSource, /aria-hidden="true">login/);
  assert.doesNotMatch(mainSource, /<span class="material-symbols-[^"]+"(?![^>]*aria-hidden="true")/);
});
```

- [ ] **Step 2: 增加 modal focus state**

在 `setup()` 中增加 refs：

```js
const confirmDialogRef = ref(null);
const lastModalTrigger = ref(null);
```

在返回对象中暴露。

- [ ] **Step 3: 实现 focus helpers**

在 `main.js` 增加：

```js
function focusFirstModalControl(root) {
  const target = root?.querySelector?.("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
  target?.focus?.();
}

function trapModalFocus(event, root) {
  if (event.key !== "Tab" || !root) return;
  const focusables = Array.from(root.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
```

`openConfirmDialog(options, trigger = document.activeElement)` 保存触发点，并 `nextTick(() => focusFirstModalControl(confirmDialogRef.value))`。

- [ ] **Step 4: 给 modal 模板接入 ref 和 keydown**

确认弹窗根节点使用：

```html
<section ref="confirmDialogRef" class="confirm-dialog" role="dialog" aria-modal="true" @keydown="trapModalFocus($event, confirmDialogRef)">
```

其他业务 modal 逐一接入同类 ref，至少覆盖 confirm、participation、paperClaim、sponsor、release、project form、contribution。

确认/警告弹窗必须高于业务弹窗，CSS z-index 验收值：

```css
.modal-backdrop { z-index: 900; }
.confirm-overlay { z-index: 1200; }
.toast { z-index: 1300; }
```

若实现中的实际类名不是 `.modal-backdrop` / `.confirm-overlay`，必须在同一步替换示例测试选择器为真实弹窗根节点类名或 `data-testid`，不允许测试查询不存在的元素后默认通过。

- [ ] **Step 5: toast live region**

把 toast 改成：

```html
<div v-if="state.toast" class="toast" role="status" aria-live="polite" aria-atomic="true">{{ state.toast }}</div>
```

错误 toast 若后续区分 tone，则错误使用 `role="alert"`。

- [ ] **Step 6: 装饰图标 aria-hidden**

所有 Material Symbols 纯装饰图标加 `aria-hidden="true"`，例如：

```html
<span class="material-symbols-rounded" style="font-size: 20px;" aria-hidden="true" v-if="item.name === 'home'">library_books</span>
```

- [ ] **Step 7: 写真实浏览器无障碍测试**

创建或补充 `frontend/e2e/accessibility.spec.js`：

```js
import { expect, test } from "@playwright/test";

test("modal traps focus, closes with escape, and returns focus", async ({ page }) => {
  await page.goto("/#/");
  const trigger = page.getByRole("button", { name: /版本|v\\d+/ }).first();
  await trigger.focus();
  await trigger.click();
  const modal = page.getByRole("dialog").first();
  await expect(modal).toBeVisible();
  await expect(modal.locator(":focus")).toHaveCount(1);
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    await expect(modal).toContainText(/版本|关闭/);
    expect(await modal.evaluate((root) => root.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await modal.evaluate((root) => root.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("toast announces success and confirm dialog stays above business modal", async ({ page }) => {
  await page.goto("/#/");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("openmedailab:test-toast", { detail: "测试提示" })));
  const toast = page.locator("[role='status'][aria-live='polite'], [role='alert'][aria-live]");
  await expect(toast).toContainText("测试提示");
  const zValues = await page.evaluate(() => ({
    confirm: Number.parseInt(getComputedStyle(document.querySelector(".confirm-overlay")).zIndex || "0", 10),
    modal: Number.parseInt(getComputedStyle(document.querySelector(".modal-backdrop")).zIndex || "0", 10),
  }));
  expect(zValues.confirm).toBeGreaterThan(zValues.modal);
});
```

若不希望生产暴露测试事件，使用 `import.meta.env.DEV` 包住事件监听。

- [ ] **Step 8: 运行测试**

```bash
node --test frontend/src/uiPlacement.test.js
npm run test:e2e -- accessibility.spec.js
npm run build
```

Expected: PASS。

### Task 7: 浏览器 E2E 与视觉验收基线

**目标：** 建立最小真实浏览器验收，覆盖深链 CTA、modal focus、toast live、移动首屏、卡片标签、popover、隐私文本。

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/playwright.config.js`
- Create: `frontend/e2e/global-setup.js`
- Create: `frontend/e2e/helpers.js`
- Create: `frontend/e2e/project-core.spec.js`
- Create: `api/management/commands/seed_e2e_data.py`
- Create: `scripts/qa_full.sh`
- Modify: `AGENTS.md`

- [ ] **Step 1: 安装 Playwright**

```bash
cd frontend
npm install --save-dev @playwright/test
```

`package.json` 增加：

```json
"test": "node --test src/*.test.js",
"test:e2e": "playwright test",
"test:e2e:headed": "playwright test --headed"
```

- [ ] **Step 2: Playwright 配置**

创建 `frontend/playwright.config.js`：

```js
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.OPENMEDAILAB_E2E_BASE_URL || "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.js",
  timeout: 30000,
  expect: { timeout: 5000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1000 } } },
    { name: "mobile-360", use: { viewport: { width: 360, height: 740 }, isMobile: true } },
    { name: "mobile-390", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } } },
    { name: "mobile-320", use: { viewport: { width: 320, height: 740 }, isMobile: true } }
  ],
  webServer: [
    {
      command: "OPENMEDAILAB_E2E=1 ../.venv/bin/python ../manage.py runserver 127.0.0.1:8000",
      url: "http://127.0.0.1:8000/api/meta/",
      cwd: ".",
      reuseExistingServer: true,
      timeout: 120000
    },
    {
      command: "npm run dev -- --host 127.0.0.1",
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120000
    }
  ]
});
```

- [ ] **Step 3: 固定 E2E seed**

创建 `api/management/commands/seed_e2e_data.py`，只允许 `OPENMEDAILAB_E2E=1` 时执行：

```python
class Command(BaseCommand):
    help = "Seed deterministic data for Playwright E2E."

    def handle(self, *args, **options):
        if os.environ.get("OPENMEDAILAB_E2E") != "1":
            raise CommandError("seed_e2e_data requires OPENMEDAILAB_E2E=1")
        # create users:
        # e2e_owner / e2e_participant / e2e_claimant / e2e_sponsor / platform_admin
        # password: StrongPass12345
        # create projects:
        # E2E_PUBLIC_WITH_RELATIONS: public, team_building, viewer has participant+approved sponsor
        # E2E_CLAIM_PENDING: public, open_recruiting, leader pending and paper_first_unit pending
        # E2E_CLAIM_OCCUPIED: public, open_recruiting, leader approved by another user
        # E2E_STAGE_BLOCKED: active or paused, cannot claim/sponsor
        # write fixture json to frontend/e2e/.state/fixture.json with project IDs.
```

`--reset` 只能删除或重建 `username` 以 `e2e_` 开头、`topic_id/title` 以 `E2E_` 标记的数据，禁止清空整库或删除人工审查账号、普通课题、审计历史。

创建 `frontend/e2e/global-setup.js`：

```js
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default async function globalSetup() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "../..");
  mkdirSync(path.join(root, "frontend/e2e/.state"), { recursive: true });
  execFileSync(path.join(root, ".venv/bin/python"), ["manage.py", "seed_e2e_data", "--reset"], {
    cwd: root,
    env: { ...process.env, OPENMEDAILAB_E2E: "1" },
    stdio: "inherit",
  });
}
```

创建 `frontend/e2e/helpers.js`：

```js
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

export function fixture() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(path.resolve(here, ".state/fixture.json"), "utf8"));
}

export async function loginAs(page, username, password = "StrongPass12345") {
  await page.goto("/#/login");
  await page.getByLabel(/用户名|账号/).fill(username);
  await page.getByLabel(/密码/).fill(password);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL(/#\/(dashboard|)$/);
}

export async function expectWithinViewport(page, locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

export function expectNoIntersection(a, b, margin = 0) {
  const separated = a.x + a.width + margin <= b.x
    || b.x + b.width + margin <= a.x
    || a.y + a.height + margin <= b.y
    || b.y + b.height + margin <= a.y;
  expect(separated).toBe(true);
}
```

- [ ] **Step 4: 给关键 UI 加稳定 test id**

在 `frontend/src/main.js` 和对应样式中补 `data-testid`，避免 E2E 依赖脆弱中文或 CSS 结构：

| UI | `data-testid` |
| --- | --- |
| 课题卡片 | `project-card` |
| 本人斜角标签 | `relation-corner-ribbon` |
| 本人次关系金色标签 | `my-relation-chip` |
| 课题编号标签 | `project-topic-chip` |
| 顶部阶段/状态标签行 | `project-meta-row` |
| 课题标题 | `project-title-link` |
| 课题卡顶部真实状态线元素；若继续用伪元素，则测试读取 `card::before` | `project-status-strip` |
| 资助 popover | `sponsor-popover` |
| 认领不可用提示 | `claim-reason-tooltip` |

- [ ] **Step 5: 编写 E2E 测试**

创建 `frontend/e2e/project-core.spec.js`：

```js
import { expect, test } from "@playwright/test";
import { expectNoIntersection, expectWithinViewport, fixture, loginAs } from "./helpers.js";

test("home page has no horizontal overflow and mobile first screen exposes title and status", async ({ page }) => {
  await page.goto("/#/");
  await page.getByTestId("project-card").first().waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("project-title-link").first()).toBeVisible();
  await expect(page.getByTestId("project-status-strip").first()).toBeVisible();
  const titleBox = await page.getByTestId("project-title-link").first().boundingBox();
  const stripBox = await page.getByTestId("project-status-strip").first().boundingBox();
  expect(titleBox.y).toBeLessThan(page.viewportSize().height);
  expect(stripBox.y).toBeLessThan(page.viewportSize().height);
});

test("relationship badges align near corner ribbon and hover strip turns gold", async ({ page }) => {
  const data = fixture();
  await loginAs(page, "e2e_participant");
  await page.goto(`/#/?topic_id=${data.projects.with_relations_topic_id}`);
  const card = page.getByTestId("project-card").filter({ hasText: data.projects.with_relations_title }).first();
  await card.waitFor();
  const ribbon = card.getByTestId("relation-corner-ribbon");
  const firstChip = card.getByTestId("my-relation-chip").first();
  const topicChip = card.getByTestId("project-topic-chip").first();
  const title = card.getByTestId("project-title-link");
  const ribbonBox = await ribbon.boundingBox();
  const firstChipBox = await firstChip.boundingBox();
  const topicChipBox = await topicChip.boundingBox();
  const titleBox = await title.boundingBox();
  expectNoIntersection(ribbonBox, firstChipBox);
  expectNoIntersection(firstChipBox, topicChipBox, 8);
  expectNoIntersection(topicChipBox, titleBox);
  expect(firstChipBox.x - ribbonBox.x - ribbonBox.width).toBeGreaterThanOrEqual(12);
  expect(firstChipBox.x - ribbonBox.x - ribbonBox.width).toBeLessThanOrEqual(28);
  expect(firstChipBox.x + firstChipBox.width).toBeLessThanOrEqual(topicChipBox.x - 8);
  expect(Math.abs(titleBox.x - topicChipBox.x)).toBeLessThanOrEqual(4);
  await card.hover();
  const stripColor = await card.evaluate((el) => {
    const strip = el.querySelector("[data-testid='project-status-strip']");
    const style = strip ? getComputedStyle(strip) : getComputedStyle(el, "::before");
    return `${style.backgroundColor} ${style.backgroundImage}`;
  });
  expect(stripColor).toMatch(/rgb\\((21[0-9]|22[0-9]|23[0-9]|24[0-9]),\\s*(15[0-9]|16[0-9]|17[0-9]|18[0-9]),\\s*(2[0-9]|3[0-9]|4[0-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9])\\)|#d4a017|#f4b400|gold/i);
});

test("project detail runs a real collaboration CTA flow", async ({ page }) => {
  const data = fixture();
  await page.goto(`/#/project/${data.projects.public_id}`);
  await page.getByRole("button", { name: /点赞/ }).click();
  await expect(page.getByRole("status")).toContainText(/请先登录|登录/);
  await loginAs(page, "e2e_participant");
  await page.goto(`/#/project/${data.projects.public_id}`);
  await page.getByRole("button", { name: /点赞/ }).click();
  await page.getByRole("button", { name: /关注/ }).click();
  await page.getByRole("button", { name: /参与/ }).click();
  const participationDialog = page.getByRole("dialog", { name: /参与|申请/ });
  await expect(participationDialog).toBeVisible();
  await participationDialog.getByLabel(/论文署名意向/).selectOption("contribution");
  await participationDialog.getByRole("button", { name: /确认参与/ }).click();
  await expect(page.getByRole("status")).toContainText(/参与成功|已参与|提交成功/);
  await expect(page.getByRole("button", { name: /取消参与|已参与/ })).toBeVisible();
  await page.getByRole("button", { name: /资助/ }).click();
  const popover = page.getByTestId("sponsor-popover");
  await expect(popover.getByLabel("资助劳务费")).toBeVisible();
  await expect(popover.getByLabel("资助算力")).toBeVisible();
  await popover.getByLabel("资助劳务费").check();
  await popover.getByLabel("资助算力").check();
  await expectWithinViewport(page, popover);
  await popover.getByRole("button", { name: /提交|确认资助/ }).click();
  await expect(page.getByRole("button", { name: /资助审批中|已资助|撤回资助/ })).toBeVisible();
});
```

强制断言不得删减：不硬编码项目 id；必须从 seed fixture 读取；必须覆盖访客登录提示、登录用户真实点赞/关注/参与/资助、本人关系标签 bounding box、hover 金色线、移动首屏标题和状态。

- [ ] **Step 6: 认领原因和 popover E2E**

补充同文件测试：

```js
test("disabled claim reason is visible on hover, focus, and mobile tap", async ({ page, isMobile }) => {
  const data = fixture();
  await loginAs(page, "e2e_claimant");
  await page.goto(`/#/project/${data.projects.claim_occupied_id}`);
  const leaderButton = page.getByRole("button", { name: /认领项目负责人|暂不认领|审批中/ }).first();
  await expect(leaderButton).toHaveAttribute("aria-disabled", "true");
  if (isMobile) {
    await leaderButton.tap();
    await expect(page.getByRole("status")).toContainText(/已有人认领|阶段|审批中|积分/);
  } else {
    await leaderButton.hover();
    const tooltip = page.getByTestId("claim-reason-tooltip");
    await expect(tooltip).toContainText(/已有人认领|阶段|审批中|积分/);
    await expectWithinViewport(page, tooltip);
    await leaderButton.focus();
    await expect(tooltip).toBeVisible();
  }
});

test("pending approval labels do not overflow", async ({ page }) => {
  const data = fixture();
  await loginAs(page, "e2e_claimant");
  await page.goto(`/#/project/${data.projects.claim_pending_id}`);
  for (const name of [/项目负责人审批中/, /第一单位认领审批中/]) {
    const button = page.getByRole("button", { name }).first();
    await expect(button).toBeVisible();
    const overflow = await button.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("secondary token sponsor flow is reachable and reviewable", async ({ page }) => {
  const data = fixture();
  await loginAs(page, "e2e_sponsor");
  await page.goto(`/#/project/${data.projects.public_id}`);
  await page.getByRole("button", { name: /资助/ }).click();
  const popover = page.getByTestId("sponsor-popover");
  await popover.getByRole("button", { name: /更多资助类型/ }).click();
  await popover.getByLabel("资助 token").check();
  await popover.getByRole("button", { name: /提交|确认资助/ }).click();
  await expect(page.getByRole("button", { name: /资助审批中|撤回资助/ })).toBeVisible();
  await page.goto("/#/dashboard");
  await expect(page.getByText(/资助 token|token/)).toBeVisible();
  await loginAs(page, "platform_admin");
  await page.goto("/#/admin");
  await page.getByRole("tab", { name: /审批|协作/ }).click();
  await expect(page.getByText(/资助 token|token/)).toBeVisible();
  await page.getByRole("row", { name: /e2e_sponsor|token|待审核|审批中/ }).getByRole("button", { name: /通过|批准/ }).click();
  await page.getByRole("dialog").getByLabel(/审核意见|备注/).fill("token 额度确认");
  await page.getByRole("dialog").getByRole("button", { name: /确认|提交/ }).click();
  await expect(page.getByRole("status")).toContainText(/已通过|审批成功/);
  await loginAs(page, "e2e_sponsor");
  await page.goto("/#/dashboard");
  await expect(page.getByText(/token 额度确认|已通过/)).toBeVisible();
  await page.getByRole("button", { name: /撤回资助 token|撤回资助/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /确认|撤回/ }).click();
  await expect(page.getByRole("status")).toContainText(/已撤回|撤回成功/);
});
```

- [ ] **Step 7: 统一 QA 脚本**

创建 `scripts/qa_full.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
.venv/bin/python manage.py check
.venv/bin/python manage.py test accounts api projects interactions credits
cd frontend
node --check src/main.js
node --test src/*.test.js
npm run build
npm run test:e2e
cd ..
git diff --check
python scripts/check_release_version.py
```

赋权：

```bash
chmod +x scripts/qa_full.sh
```

- [ ] **Step 8: 运行**

```bash
./scripts/qa_full.sh
```

Expected:

- Playwright 自动 seed 数据、启动 Django 后端、启动 Vite 前端，不依赖人工本地服务。
- `1440x1000`、`768x1000`、`390x844`、`360x740`、`320x740` 全部通过。
- 失败时保留 trace 和 screenshot。

### Task 8: 管理员任务管理 sponsor UID 与我的任务提示

**目标：** 管理员任务详情展示已获批资助 UID；用户我的任务禁用提示先解释参与/认领状态，纯资助才显示资助不产生提交权限。

**Files:**
- Modify: `api/ninja_api.py`
- Modify: `api/tests.py`
- Modify: `frontend/src/main.js`
- Modify: `frontend/src/uiPlacement.test.js`

- [ ] **Step 1: 写静态测试**

```js
test("admin task detail includes approved sponsor uid groups", () => {
  assert.match(mainSource, /group\\.type === "sponsor" && group\\.status === "approved"/);
  assert.match(mainSource, /已获批资助/);
});

test("task submit hint prioritizes participation and claim status over sponsor-only hint", () => {
  assert.match(mainSource, /function taskSubmitHint\\(task\\)[\\s\\S]*?nonSponsorRelations/);
});
```

- [ ] **Step 2: 后端 status-card 结构化字段**

改 `status_uid_groups_for_project()`，每个 group 必须带结构化字段：

```python
{
    "key": "sponsor:approved:compute",
    "type": "sponsor",
    "status": "approved",
    "status_label": "已通过",
    "subtype": "compute",
    "subtype_label": "算力",
    "uids": ["E00000013"],
}
```

验收口径：

- `status` 只能来自枚举值，不从中文 label 推断。
- sponsor 的 approved/pending/rejected/withdrawn 都可出现在详情结构中，但管理员任务管理只消费 `status === "approved"`。
- `/api/projects/{id}/status-card/` 测试覆盖 approved/pending/rejected sponsor，断言 pending/rejected 不进入已获批资助分组。

- [ ] **Step 3: 管理端 sponsor UID**

改 `fetchProjectApprovedInteractions()`：

```js
return (card.uid_groups?.groups || [])
  .filter((group) => ["interest", "claim", "sponsor"].includes(group.type) && group.status === "approved")
  .map((group) => ({
    label: group.type === "sponsor" ? "已获批资助" : group.label,
    items: (group.uids || []).map((uid) => ({
      id: `${group.key}-${uid}`,
      type: group.type,
      user: { uid },
      subtype_label: group.subtype_label || (group.type === "sponsor" ? "资助" : ""),
      status_label: "已通过"
    }))
  }));
```

- [ ] **Step 4: 写真实数据验收**

在 `api/tests.py` 增加：

```python
def test_status_card_structured_sponsor_groups_filter_approved_for_admin_task(self):
    pending = User.objects.create_user(username="pendingtaskfund", email="pendingtaskfund@example.com", password="StrongPass12345")
    approved = User.objects.create_user(username="approvedtaskfund", email="approvedtaskfund@example.com", password="StrongPass12345")
    rejected = User.objects.create_user(username="rejectedtaskfund", email="rejectedtaskfund@example.com", password="StrongPass12345")
    SponsorIntent.objects.create(user=pending, project=self.project, sponsor_type="compute", status=InteractionStatus.PENDING)
    SponsorIntent.objects.create(user=approved, project=self.project, sponsor_type="labor_fee", status=InteractionStatus.APPROVED)
    SponsorIntent.objects.create(user=rejected, project=self.project, sponsor_type="token", status=InteractionStatus.REJECTED)

    response = self.client.get(f"/api/projects/{self.project.pk}/status-card/")

    groups = response.json()["data"]["uid_groups"]["groups"]
    approved_groups = [group for group in groups if group["type"] == "sponsor" and group["status"] == "approved"]
    self.assertEqual(approved_groups[0]["uids"], [approved.profile.uid])
    self.assertTrue(all("status" in group and "subtype" in group for group in groups if group["type"] == "sponsor"))
```

前端 E2E 或静态测试断言：管理任务详情中只出现 approved sponsor UID，不出现 pending/rejected sponsor UID。

- [ ] **Step 5: 我的任务提示**

改 `taskSubmitHint()`：

```js
const nonSponsorRelations = (task?.relations || []).filter((relation) => relation.relation_type !== "sponsor");
if (!approvedTaskRelations(task).length) {
  if (nonSponsorRelations.some((relation) => relation.status === "pending")) return "参与或认领状态待确认，获批后可提交";
  if (nonSponsorRelations.some((relation) => relation.status === "rejected")) return "参与或认领未通过，不能提交";
  if (nonSponsorRelations.some((relation) => relation.status === "withdrawn")) return "参与或认领已撤回，不能提交";
  if (task?.relations?.some((relation) => relation.relation_type === "sponsor")) return "资助意向不产生任务结果提交权限";
  return "获批后可提交";
}
```

- [ ] **Step 6: 运行**

```bash
.venv/bin/python manage.py test api.tests.ProjectApiTests.test_status_card_structured_sponsor_groups_filter_approved_for_admin_task
node --test frontend/src/uiPlacement.test.js
npm run build
```

Expected: PASS。

### Task 9: 点赞排序后端化

**目标：** `sort=likes` 由后端在分页前按 `score_count` 排序。

**Files:**
- Modify: `api/ninja_api.py`
- Modify: `frontend/src/main.js`
- Modify: `api/tests.py`
- Modify: `frontend/src/uiPlacement.test.js`

- [ ] **Step 1: 写后端测试**

```python
def test_project_list_likes_sort_happens_before_pagination(self):
    low_like = Project.objects.create(topic_id=9911, title="低赞", summary="低赞", theme=self.theme, stage=ProjectStage.OPEN_RECRUITING, is_public=True)
    high_like = Project.objects.create(topic_id=9912, title="高赞", summary="高赞", theme=self.theme, stage=ProjectStage.OPEN_RECRUITING, is_public=True)
    for idx in range(3):
        user = User.objects.create_user(username=f"liker{idx}", email=f"liker{idx}@example.com", password="StrongPass12345")
        ProjectScore.objects.create(user=user, project=high_like, score=10)
    response = self.client.get("/api/projects/?sort=likes&page_size=1")
    self.assertEqual(response.status_code, 200)
    self.assertEqual(response.json()["data"]["results"][0]["id"], high_like.id)
```

- [ ] **Step 2: 后端 sort_map**

增加：

```python
"likes": ("-score_count", "-follow_count", "-interest_count", "topic_id"),
```

- [ ] **Step 3: 前端不再映射 likes**

改 `projectListRequestParams()`：

```js
function projectListRequestParams() {
  return { ...state.filters };
}
```

保留前端本地排序仅作为已加载数据的稳定二次排序，不得改变后端分页前排序结果，也不得覆盖本人关系优先级：

- API 层先按 `viewer_relation_priority` 排出 `我已认领 > 我已参与 > 我已资助 > 其他`。
- 当用户选择 `sort=likes` 时，在同一本人关系优先级内部按 `score_count` 排序。
- 前端只在同一页内做展示稳定化，不允许重新按当前页局部 likes 打乱服务端返回顺序。

- [ ] **Step 4: 运行**

```bash
.venv/bin/python manage.py test api.tests.ProjectApiTests.test_project_list_likes_sort_happens_before_pagination
node --test frontend/src/uiPlacement.test.js
```

Expected: PASS。

### Task 10: 移动端首页、联系人悬浮卡和 sponsor/claim popover 验收

**目标：** 320/360/390px 首屏露出首个课题标题和状态；本人关系标签与斜角标签距离贴近但不重叠；联系人悬浮卡不被裁切；sponsor 和 claim 提示完全在视口内。

**Files:**
- Modify: `frontend/src/main.js`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/uiPlacement.test.js`
- Modify: `frontend/e2e/project-core.spec.js`

- [ ] **Step 1: 移动端布局策略**

移动端 `max-width: 640px`：

```css
.topbar {
  gap: 8px;
}

.toolbar {
  gap: 10px;
}

.toolbar .filter-group.optional-mobile {
  display: none;
}

.topic-theme-strip.single-row {
  margin-top: 8px;
}
```

如主题 select 与主题卡条重复，则移动端隐藏 toolbar 内主题 select，保留主题卡条。

- [ ] **Step 2: 联系人 hover card 改 viewport 安全**

最小改法：允许 `.project-card` 对联系人卡不裁切会破坏斜角标签裁切；因此采用 fixed hover card 状态。新增 state：

```js
contactHoverCard: { visible: false, x: 0, y: 0, title: "", members: [] }
```

新增函数：

```js
function showTeamContactCard(event, role, project) {
  const rect = event.currentTarget.getBoundingClientRect();
  const members = teamContactMembers(project, role);
  state.contactHoverCard = {
    visible: true,
    x: Math.min(window.innerWidth - 320, Math.max(12, rect.left)),
    y: Math.min(window.innerHeight - 220, Math.max(12, rect.bottom + 8)),
    title: role.label,
    members
  };
}
```

模板把 hover card 放在 page 级 fixed 容器，设置：

```css
.floating-contact-card {
  position: fixed;
  z-index: 860;
  width: min(300px, calc(100vw - 24px));
  max-height: min(320px, calc(100dvh - 24px));
  overflow: auto;
}
```

- [ ] **Step 3: E2E 断言**

在 `frontend/e2e/project-core.spec.js` 增加：

```js
test("relationship label geometry matches product requirement", async ({ page }) => {
  const data = fixture();
  await loginAs(page, "e2e_participant");
  await page.goto(`/#/?topic_id=${data.projects.with_relations_topic_id}`);
  const card = page.getByTestId("project-card").filter({ hasText: data.projects.with_relations_title }).first();
  const ribbon = card.getByTestId("relation-corner-ribbon");
  const relationChip = card.getByTestId("my-relation-chip").first();
  const topicChip = card.getByTestId("project-topic-chip").first();
  const metaRow = card.getByTestId("project-meta-row");
  const title = card.getByTestId("project-title-link");
  for (const locator of [ribbon, relationChip, topicChip, metaRow, title]) await expect(locator).toBeVisible();
  const rb = await ribbon.boundingBox();
  const rel = await relationChip.boundingBox();
  const topic = await topicChip.boundingBox();
  const row = await metaRow.boundingBox();
  const titleBox = await title.boundingBox();
  const gap = rel.x - (rb.x + rb.width);
  expect(gap).toBeGreaterThanOrEqual(12);
  expect(gap).toBeLessThanOrEqual(28);
  expect(rel.x + rel.width).toBeLessThanOrEqual(topic.x - 8);
  expect(Math.abs(titleBox.x - topic.x)).toBeLessThanOrEqual(4);
  expect(row.y).toBeGreaterThanOrEqual(rb.y + rb.height * 0.35);
  await card.hover();
  const stripColor = await card.evaluate((el) => {
    const strip = el.querySelector("[data-testid='project-status-strip']");
    const style = strip ? getComputedStyle(strip) : getComputedStyle(el, "::before");
    return `${style.backgroundColor} ${style.backgroundImage}`;
  });
  expect(stripColor).toMatch(/rgb\\((21[0-9]|22[0-9]|23[0-9]|24[0-9]),\\s*(15[0-9]|16[0-9]|17[0-9]|18[0-9]),\\s*(2[0-9]|3[0-9]|4[0-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9])\\)|#d4a017|#f4b400|gold/i);
});

test("floating cards, claim tooltip and sponsor popover stay within viewport", async ({ page }) => {
  const data = fixture();
  await loginAs(page, "e2e_participant");
  await page.goto(`/#/?topic_id=${data.projects.with_relations_topic_id}`);
  await page.getByTestId("project-card").first().waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: /资助/ }).first().click();
  const popover = page.getByTestId("sponsor-popover");
  await expectWithinViewport(page, popover);
  const sponsorButton = page.getByRole("button", { name: /资助/ }).first();
  const buttonBox = await sponsorButton.boundingBox();
  const popoverBox = await popover.boundingBox();
  expect(Math.abs(popoverBox.y - (buttonBox.y + buttonBox.height))).toBeLessThanOrEqual(24);
  const checkboxBoxes = await popover.getByRole("checkbox").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(Math.min(...checkboxBoxes)).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await sponsorButton.click();
  await expect(popover).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(popover).toBeHidden();
});
```

必须保留这些断言，不允许用截图人工目测替代：

- 斜角标签、金色小标签、课题编号标签、标题 bounding box 不相交。
- 斜角标签右缘到第一个金色小标签间距为 `12px` 到 `28px`，约等于一个汉字宽度。
- 课题编号标签与标题左边缘误差不超过 `4px`。
- 本人相关课题 hover 顶线使用金色，不再使用绿色。
- 审批中按钮 `scrollWidth - clientWidth <= 1`。
- sponsor popover 与按钮距离不超过 `24px`，checkbox 触控高度不低于 `44px`，Escape 和外部点击可关闭。
- claim tooltip 桌面 hover/focus 出现且在 viewport 内，移动端 tap 转为 toast。

- [ ] **Step 4: 运行**

```bash
node --test frontend/src/uiPlacement.test.js
npm run test:e2e
npm run build
```

Expected: PASS；320/360/390px 首屏均可见首个课题标题和状态。

### Task 11: PDF 上传签名、大小和失败审计

**目标：** 课题主 PDF、进度 PDF、主题数据集 PDF 与任务结果 PDF 一样校验大小和 `%PDF-` 签名；非法上传写 failed audit。

**Files:**
- Modify: `api/ninja_api.py`
- Modify: `api/tests.py`
- Modify: `frontend/src/main.js`
- Modify: `frontend/e2e/project-core.spec.js`
- Modify: `AGENTS.md`

- [ ] **Step 1: 提取统一 PDF 校验函数**

在 `api/ninja_api.py` 增加：

```python
PDF_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

def validate_uploaded_pdf(uploaded):
    file_name = sanitize_file_name(uploaded.name)
    if not file_name or Path(file_name).suffix.lower() != ".pdf":
        return "", fail("Only PDF files are allowed.", status=422, code="validation_error")
    if getattr(uploaded, "size", 0) > PDF_DOCUMENT_MAX_BYTES:
        return "", fail("PDF 文件不能超过 20MB。", status=422, code="validation_error")
    if not uploaded_file_has_pdf_signature(uploaded):
        return "", fail("PDF 文件格式无法识别。", status=422, code="validation_error")
    return file_name, None
```

- [ ] **Step 2: 写测试**

增加主题 PDF、课题 PDF 非 PDF 内容测试：

```python
def test_theme_detail_pdf_rejects_fake_pdf_and_writes_failed_audit(self):
    self.login_platform_admin()
    theme_file = ThemeFile.objects.create(theme=self.theme, title="数据集说明", path="media/theme-datasets/a.pdf")
    fake = SimpleUploadedFile("fake.pdf", b"not a pdf", content_type="application/pdf")
    response = self.client.post(f"/api/admin/theme-files/{theme_file.pk}/detail-pdf/", {"file": fake})
    self.assertEqual(response.status_code, 422)
    self.assertTrue(AuditLog.objects.filter(action="theme_file.detail_pdf_upload", status="failed").exists())
```

- [ ] **Step 3: 接入上传接口**

在主题 PDF、管理员课题 PDF、用户课题 PDF、进度 PDF 上传入口统一调用 `validate_uploaded_pdf(uploaded)`。

失败审计示例：

```python
if error:
    audit(request.user, "theme_file.detail_pdf_upload", "ThemeFile", file.id, status="failed", error_code=error[1]["error"]["code"], error_message=error[1]["error"]["message"])
    return error
```

- [ ] **Step 4: 运行**

```bash
.venv/bin/python manage.py test api projects
npm run test:e2e -- project-core.spec.js --grep "invalid pdf upload"
```

Expected:

- 非 PDF 内容全部 422，失败审计存在。
- 前端上传假 PDF 时展示可理解提示：`PDF 文件格式无法识别` 或 `只能上传 PDF 文件`，不能只显示“上传失败”。
- toast 或 inline error 使用 `role="alert"` 或 `role="status"` 可被读屏读取。

### Task 12: 阶段变更、积分扣返和交互提交事务硬化

**目标：** 阶段变更、积分扣返、审计一致；参与/认领/资助在锁内重检阶段、席位和积分。

**Files:**
- Modify: `api/ninja_api.py`
- Modify: `api/tests.py`

- [ ] **Step 1: 写事务测试**

用 mock 让扣分抛异常，断言阶段回滚：

```python
def test_project_stage_rolls_back_when_credit_charge_fails(self):
    self.login_platform_admin()
    with mock.patch("api.ninja_api.charge_project_participation_credits_once", side_effect=RuntimeError("charge failed")):
        response = self.patch_json(f"/api/admin/projects/{self.project.pk}/", {"stage": "active", "title": self.project.title, "summary": self.project.summary})
    self.project.refresh_from_db()
    self.assertNotEqual(self.project.stage, ProjectStage.ACTIVE)
    self.assertGreaterEqual(response.status_code, 400)
```

- [ ] **Step 2: 重构 admin_project_update 事务**

把 `update_project()`、积分扣返、审计置于一个 `transaction.atomic()`。如果 `update_project()` 内部已保存，需要保证在 outer atomic 中执行。

- [ ] **Step 3: 交互锁内重检**

interest/claim/sponsor 写入统一模式：

```python
with transaction.atomic():
    project = Project.objects.select_for_update().get(pk=project.pk)
    profile = UserProfile.objects.select_for_update().get(user=request.user)
    if project.stage not in RECRUITING_PROJECT_STAGES:
        return fail("Project is not recruiting.", status=422, code="project_not_recruiting")
    if needs_credit and not has_required_participation_credits(profile=profile, project=project):
        return fail("参与课题需要50积分，当前积分不足。", status=422, code="insufficient_credits")
```

实现要求：

- `has_required_participation_credits()` 接受锁内 `profile` 或在函数内重新 `select_for_update()`，不能锁了 `UserProfile` 后继续读旧的 `request.user.profile` 缓存。
- claim 席位检查必须在同一个事务内完成。
- sponsor 重复提交必须对同一 `user/project/sponsor_type` 行 `select_for_update()`。

- [ ] **Step 4: 写并发测试**

使用 `TransactionTestCase` 或项目当前等价并发测试工具覆盖：

| 测试 | 断言 |
| --- | --- |
| `test_concurrent_leader_claim_allows_only_one_active_claim` | 两个用户同时认领项目负责人，最终只有一个 pending/approved active row |
| `test_concurrent_paper_first_unit_claim_allows_only_one_active_claim` | 两个用户同时认领第一单位，最终只有一个 pending/approved active row |
| `test_concurrent_sponsor_resubmit_does_not_duplicate_active_intent` | 同一用户并发提交同一 sponsor type，只保留一行 active intent |
| `test_stage_change_blocks_in_flight_interaction_submit` | 管理员把课题改为 active/paused 的同时用户提交参与/认领，最终要么提交先成功且阶段一致，要么返回 `project_not_recruiting`，不出现成功提交到不可招募阶段 |
| `test_participation_credit_precheck_uses_locked_profile_balance` | 积分刚好 50 的用户并发提交两次，最多一次通过 |

- [ ] **Step 5: 运行**

```bash
.venv/bin/python manage.py test api
```

Expected: 阶段回滚、并发 claim、并发 sponsor、阶段切换、积分预占测试全部通过；没有 IntegrityError 或数据库异常原样返回给用户。

### Task 13: API 错误契约与失败审计统一

**目标：** 明确保留 `error.details` 还是切到 `errors`。本计划选择向后兼容：继续返回 `error.details`，同时新增顶层 `errors`，更新 AGENTS 为双写过渡期。

**Files:**
- Modify: `api/ninja_api.py`
- Modify: `frontend/src/api.js`
- Modify: `api/tests.py`
- Modify: `frontend/src/api.test.js`
- Modify: `AGENTS.md`

- [ ] **Step 1: 错误结构测试**

```python
def test_validation_error_exposes_details_and_errors_alias(self):
    response = self.post_json("/api/auth/register/", {"username": "", "email": "bad", "password1": "x", "password2": "y"})
    self.assertEqual(response.status_code, 422)
    body = response.json()
    self.assertIn("details", body["error"])
    self.assertIn("errors", body)
    self.assertEqual(body["errors"], body["error"]["details"])
```

- [ ] **Step 2: ErrorEnvelope schema 和 error_payload 双写**

同步更新 `ErrorEnvelope`，让 OpenAPI/schema 与实际响应一致：

```python
class ErrorEnvelope(Schema):
    ok: bool = False
    request_id: str | None = None
    error: ErrorDetail
    errors: Any | None = None
```

`ErrorDetail` 继续保留 `details`，用于向后兼容。

```python
def error_payload(message, code="bad_request", errors=None):
    request_id = current_request_id()
    payload = {"ok": False, "request_id": request_id, "error": {"code": code, "message": message, "request_id": request_id}}
    if errors is not None:
        payload["error"]["details"] = errors
        payload["errors"] = errors
    return payload
```

- [ ] **Step 3: 前端 ApiError alias**

在 `ApiError` constructor 中增加：

```js
this.errors = payload?.errors || payload?.error?.details || {};
```

逐步把 `error.errors` 读取改为 `error.errors || error.payload?.error?.details`。

- [ ] **Step 4: 失败审计代表路径**

为以下路径补 failed audit。每个路径至少一条测试断言 `AuditLog.status == "failed"`，并断言 `request_id`、`error_code`、`error_message` 非空。

| 路径 | 期望 |
| --- | --- |
| 非法审批类型 | `400/422 validation_error`，写 failed audit |
| 普通用户访问 admin 写接口 | `403 permission_denied`，写 failed audit |
| 无法招募阶段参与/认领/资助 | `422 project_not_recruiting`，写 failed audit |
| 积分不足 | `422 insufficient_credits`，写 failed audit |
| claim slot occupied | `409 claim_slot_occupied`，写 failed audit |
| pending review-required claim withdraw | `422 claim_pending_cannot_withdraw`，写 failed audit |
| 重复/并发 sponsor 冲突 | 用户收到稳定错误或幂等成功，内部冲突写 failed audit 或 conflict audit |
| IntegrityError 兜底 | 不向用户暴露数据库异常原文，映射为稳定错误码并写 failed audit |
| 非法 PDF | `422 validation_error`，写 failed audit |

失败审计不得记录密码、密钥、完整文件内容。

- [ ] **Step 5: 运行**

```bash
.venv/bin/python manage.py test api
node --test frontend/src/api.test.js frontend/src/uiPlacement.test.js
```

Expected: PASS。

### Task 14: 备份恢复负保护回归

**目标：** 内容备份恢复不覆盖用户、协作关系、任务结果、积分、审计日志，并断言导出/恢复审计。

**Files:**
- Modify: `api/tests.py`
- Optionally Modify: `api/ninja_api.py` if tests expose bug

- [ ] **Step 1: 扩展测试 fixture**

在 `test_admin_content_backup_exports_and_restores_projects_themes_and_pdfs` 中增加：

```python
user_count = User.objects.count()
interest = ProjectInterest.objects.create(user=participant, project=self.project, role="学生", status=InteractionStatus.APPROVED)
sponsor = SponsorIntent.objects.create(user=participant, project=self.project, sponsor_type="compute", status=InteractionStatus.APPROVED)
contribution = Contribution.objects.create(user=participant, project=self.project, title="结果", result_type="stage")
ledger = CreditLedger.objects.create(user=participant, action_type=CreditLedger.ActionType.TRANSFER_IN, amount=1, balance_after=101)
audit_before = AuditLog.objects.count()
```

恢复后断言：

```python
self.assertEqual(User.objects.count(), user_count)
self.assertTrue(ProjectInterest.objects.filter(pk=interest.pk).exists())
self.assertTrue(SponsorIntent.objects.filter(pk=sponsor.pk).exists())
self.assertTrue(Contribution.objects.filter(pk=contribution.pk).exists())
self.assertTrue(CreditLedger.objects.filter(pk=ledger.pk).exists())
self.assertGreater(AuditLog.objects.count(), audit_before)
self.assertTrue(AuditLog.objects.filter(action="content_backup.export").exists())
self.assertTrue(AuditLog.objects.filter(action="content_backup.restore").exists())
```

- [ ] **Step 2: 运行**

```bash
.venv/bin/python manage.py test api.tests.ProjectApiTests.test_admin_content_backup_exports_and_restores_projects_themes_and_pdfs
```

Expected: PASS。

### Task 15: 文档、版本和旧验收文档治理

**目标：** 文档与实现规则一致，旧文档不再误导后续验收。

**Files:**
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`
- Modify: `VERSION`
- Modify: `frontend/package.json`
- Modify: `docs/user-admin-workspace-execution-and-acceptance.md`

- [ ] **Step 1: 版本策略**

本轮包含用户可感知功能、API 字段、数据库迁移和验收体系，版本升级到 `0.14.0`。这是包含产品行为和数据模型变化的小版本发布，不是普通补丁版本。

- [ ] **Step 2: 更新 AGENTS**

同步以下规则：

- 匿名只显示 UID。
- 联系方式展示范围属于产品确认后执行的独立隐私策略；未确认前 P1 只收紧匿名泄露。
- 详情页具备核心协作 CTA。
- sponsor 审核字段返回申请人。
- sponsor count 只统计 approved。
- sponsor 主 popover 只展示劳务费和算力两个近距 checkbox；token 通过更多资助类型入口可达。
- status-card uid_groups 返回结构化 `status/subtype/subtype_label`，前端不得靠中文 label 推断状态。
- pending review-required claim 不可撤回。
- 项目负责人和第一单位认领席位由 pending/approved 占用，rejected/withdrawn 释放。
- `sort=likes` 后端分页前排序。
- PDF 签名/大小校验。
- QA 必跑包含 Playwright E2E。
- 错误结构双写 `error.details` 和顶层 `errors`。

- [ ] **Step 3: 标记旧文档**

在 `docs/user-admin-workspace-execution-and-acceptance.md` 文件顶部添加：

```markdown
> 历史归档说明：本文档记录旧版用户/管理员工作台闭环，其中“管理员创建任务、贡献审核、审核发奖励”等内容已不再是当前主流程。当前有效规则以根目录 `AGENTS.md` 为准。
```

- [ ] **Step 4: 更新 CHANGELOG**

新增 `0.14.0`：

```markdown
## 0.14.0 - 2026-06-19

### 修复
- 收紧匿名课题公开信息，只展示 UID。
- 课题详情页补齐协作操作入口。
- 资助审批意见返回申请人，资助统计只统计已通过记录。
- 统一认领审批中和撤回状态机。
- 修复点赞排序分页前口径。
- 统一 PDF 上传格式校验和失败审计。

### 体验
- 增加 modal 焦点管理和 toast 读屏提示。
- 优化移动端首屏、联系人悬浮卡和资助/认领提示验收。

### 验收
- 新增 Playwright 浏览器验收和统一 QA 脚本。
```

- [ ] **Step 5: 运行文档校验**

```bash
git diff --check
rg -n 'TO[D]O|TB[D]|FIX[M]E|待[定]|不确[定]' AGENTS.md docs CHANGELOG.md
python scripts/check_release_version.py
```

Expected: 无占位词；版本一致。

## 4. 全量验收矩阵

### 4.1 自动化命令

```bash
.venv/bin/python manage.py check
.venv/bin/python manage.py makemigrations --check --dry-run
.venv/bin/python manage.py test accounts api projects interactions credits
cd frontend && node --check src/main.js
cd frontend && node --test src/*.test.js
cd frontend && npm run build
cd frontend && npm run test:e2e
git diff --check
python scripts/check_release_version.py
```

### 4.2 浏览器验收路径

| 路径 | 角色 | 验收 |
| --- | --- | --- |
| `#/` | 访客 | 无横向滚动；首屏露出课题；创建者只 UID；主题栏可用 |
| `#/project/{id}` | 访客 | 有协作 CTA；点击需登录提示；PDF 可看 |
| `#/project/{id}` | 登录用户 | 可点赞、关注、参与、认领、资助；不可认领原因靠近按钮 |
| `#/dashboard` | 登录用户 | sponsor 审批意见可见；任务提示正确；联系方式范围仅在产品确认方案 A 后出现 |
| `#/admin` interactions | 管理员 | 可审批 claim/sponsor；审核意见写入并返回申请人 |
| `#/admin` task management | 管理员 | 已通过参与/认领 UID 和已通过 sponsor UID 可见 |
| `#/faq` | 访客 | 二维码按已有图片展示；FAQ 与资助入口一致 |

### 4.3 Viewport 验收

必须覆盖：`1440x1000`、`768x1000`、`390x844`、`360x740`、`320x740`。

每个 viewport 断言：

- `document.documentElement.scrollWidth <= window.innerWidth + 1`
- `.project-card` 第一个卡片在移动端首屏至少露出标题和顶部状态线。
- 有本人关系卡片的斜角标签、金色小标签、课题编号、标题不相交。
- 斜角标签右缘到第一个金色小标签间距为 `12px` 到 `28px`；课题编号标签与标题左边缘误差不超过 `4px`。
- 本人相关课题 hover 后顶部状态线为金色。
- 审批中按钮 `scrollWidth - clientWidth <= 1`。
- `sponsor-popover` 和 `claim-reason-tooltip` 完全在 viewport 内，且 sponsor popover 距触发按钮不超过 `24px`。
- modal 打开后 activeElement 位于 modal 内。

## 5. 问题覆盖映射

| 审查问题 | 覆盖任务 |
| --- | --- |
| 匿名访客看到创建者姓名/昵称 | Task 1 |
| 详情页缺少核心协作 CTA | Task 5 |
| 资助审批意见不可见 | Task 3 |
| sponsor count 统计 pending/rejected | Task 3 |
| pending 认领撤回前后端不一致 | Task 4 |
| 一个课题只能一个负责人认领、一个第一单位认领 | Task 4、Task 12 |
| 斜角标签和普通标签距离过远、标题行未对齐 | Task 7、Task 10 |
| 本人相关课题 hover 顶线仍为绿色 | Task 7、Task 10 |
| 审批中按钮文字溢出 | Task 7、Task 10 |
| 不可认领原因缺鼠标旁提示 | Task 5、Task 7、Task 10 |
| modal/toast 无障碍不足 | Task 6 |
| 缺真实浏览器 E2E | Task 7 |
| 管理任务详情缺 sponsor UID | Task 8 |
| status-card 靠中文 label 过滤状态 | Task 8 |
| token 资助入口不可达 | Task 3 |
| 重复 sponsor 回退 pending | Task 3 |
| 点赞排序不是全局排序 | Task 9 |
| 移动首页首屏内容下沉 | Task 10 |
| 联系人悬浮卡被裁切 | Task 10 |
| PDF 上传校验不一致 | Task 11 |
| 阶段变更和积分事务 | Task 12 |
| 交互提交并发窗口 | Task 12 |
| 失败审计覆盖不完整 | Task 11、Task 13 |
| 错误结构文档漂移 | Task 13 |
| 备份恢复负保护不足 | Task 14 |
| 旧验收文档冲突 | Task 15 |
| 图标 aria-hidden、任务提示、归档确认、legacy claim | Task 6、Task 8、Task 15 |
| 联系方式展示范围属于新增产品策略 | Task 2 |

## 6. 多 agent 审核记录

本计划生成后必须由三个只读 reviewer 审核：

| Reviewer | 审核范围 | 必须回答 |
| --- | --- | --- |
| 产品 reviewer | 是否覆盖所有 P1/P2/P3；是否有规则冲突 | 是否可执行、是否有遗漏、优先级是否正确 |
| 后端 reviewer | 数据模型、迁移、API、事务、审计、测试 | 是否有破坏现有生命周期或权限 |
| 前端/QA reviewer | UI、无障碍、移动端、E2E、验收命令 | 是否可真实浏览器验收、是否有不可测标准 |

审核后若有问题，直接修订本计划并在本节追加结论。

### 6.1 第一轮只读审核结论

| Reviewer | 结论 | P1 问题摘要 | 本计划修订 |
| --- | --- | --- | --- |
| 产品 reviewer | 暂不通过 | 关系标签/hover/移动端验收不够硬；认领席位唯一性没有落到并发和数据约束；不可操作原因提示不闭环；资助 token 和审批状态链路偏弱；联系方式范围是产品策略不是 P1 bug | Task 2 改为产品门禁；Task 3 补 sponsor 全链路和 token 二级入口；Task 4 补席位唯一性、并发、admin 审批冲突；Task 7/10 补 fixture 和 bounding-box 断言 |
| 后端 reviewer | 暂不通过 | status-card 缺结构化字段；admin interaction payload 漏 sponsor 审批字段；事务并发测试不足；withdraw response schema 漏 422；失败审计和 ErrorEnvelope schema 不完整 | Task 3 补 `interaction_payload()`；Task 4 补 response schema 和 failed audit；Task 8 补 `status/subtype/subtype_label`；Task 12 补并发矩阵；Task 13 补 schema 和失败审计矩阵 |
| 前端/QA reviewer | 暂不通过 | Playwright 服务编排不足且无 fixture；截图关键布局没有真实断言；modal/toast、审批中按钮、claim tooltip、sponsor popover、移动首屏验收过弱 | Task 6 补真实无障碍 E2E；Task 7 重写后端+前端 webServer、seed fixture、真实 CTA 流；Task 10 补标签几何、popover、tooltip、按钮溢出断言 |

### 6.2 修订后计划状态

上述 P1 已全部吸收为可执行步骤和可验收断言。本计划进入第二轮复核前的状态为：允许执行，但执行者必须逐项勾选任务并运行 `./scripts/qa_full.sh`；若第二轮 reviewer 仍发现 P1，继续修订本计划后再进入代码实现。

### 6.3 第二轮与第三轮复核结论

| Reviewer | 第二/三轮问题 | 修订结果 |
| --- | --- | --- |
| 后端 reviewer | 第二轮建议通过，仅提示 withdraw schema、sponsor review 字段契约、status-card 多余字段概念 | 已改为 `Envelope` 并补 `401`；明确 sponsor review 顶层和 `detail` 双返回；移除多余字段 |
| 产品 reviewer | 第二轮发现不可操作原因提示仍依赖原生 disabled；第三轮提示 token 审批/撤回 E2E 和 hover 断言需补强 | 认领按钮改为 `aria-disabled` + 事件处理；补 token 提交、审批、dashboard 可见、撤回；统一 hover 金色线严格断言 |
| 前端/QA reviewer | 第二轮发现详情 CTA 未完整提交参与/资助；第三轮发现参与 modal E2E 字段不符合现有页面 | 补参与 modal `论文署名意向` + `确认参与`；补资助提交和状态刷新；补 popover Escape/外部点击、seed reset 命名空间约束 |

### 6.4 最终审核状态

三位 reviewer 最终均建议通过计划审核：

- 产品 reviewer：建议通过。
- 后端 reviewer：P1/P2/P3 清零，建议通过。
- 前端/QA reviewer：第三轮 P1 已修，建议通过。

本计划可进入代码执行阶段。执行阶段仍必须按任务逐项勾选、先测后改，并以 `./scripts/qa_full.sh` 和浏览器 E2E 作为最终验收门禁。
