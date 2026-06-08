# 用户注册登录与管理员默认密码恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于最新 `dev` 分支，移除不需要的邮箱验证/邮箱重置复杂度，把管理员恢复密码改为系统统一默认密码，并保留已合入的注册、UID、唯一管理员、管理员用户管理和强制改密能力。

**Architecture:** 复用最新 `dev` 已有认证接口、管理员用户接口、强制改密接口、RBAC 和前端管理页；本轮不新增任何 HTTP API。只调整已有接口行为、删除不再需要的邮箱相关接口和模型，并补齐测试与文档。

**Tech Stack:** Django 5.2、Django Ninja、Django session auth、Vue 3、Vite、Node test、Playwright E2E。

---

文档日期：2026-06-08

## 1. 最新 dev 核对结论

本地 `dev` 已快进到：

```text
a523595 Merge pull request #3 from OpenMedAILab/codex/user-registration-improvements
```

之前 PR 的注册优化已经合入。当前代码不是旧基线，不能再按“缺少 UID、管理员用户 API、强制改密 API”来规划。

## 2. 当前代码已经具备的能力

### 2.1 账号与注册

当前已具备：

- `UserProfile.uid`
- `UserProfile.email_normalized`
- `UserProfile.must_change_password`
- 注册邮箱必填。
- 注册邮箱大小写不敏感唯一。
- 注册成功事务化写入用户、资料和初始积分。
- UID 按身份前缀生成。

相关文件：

- `accounts/models.py`
- `accounts/forms.py`
- `accounts/services.py`
- `api/ninja_api.py`
- `api/serializers.py`

### 2.2 唯一平台管理员

当前已具备：

- `PLATFORM_ADMIN_UID = "ADM00000001"`
- `platform_admin_username()`
- `is_platform_admin_user(user)`
- `ensure_platform_admin` 管理命令。
- `api/rbac.py` 只把唯一平台管理员识别为 admin。
- `manage_users` capability 已存在。

相关文件：

- `accounts/models.py`
- `accounts/management/commands/ensure_platform_admin.py`
- `api/rbac.py`
- `accounts/tests.py`

### 2.3 管理员用户管理与强制改密

当前已具备：

- `GET /api/admin/users/`
- `POST /api/admin/users/{uid}/reset-password/`
- `POST /api/auth/password/change-required/`
- `PasswordChangeRequiredMiddleware`
- 前端“用户管理”tab。
- 前端强制改密页。
- 前端退出 CSRF 兜底。

相关文件：

- `api/ninja_api.py`
- `api/middleware.py`
- `frontend/src/api.js`
- `frontend/src/main.js`
- `frontend/src/api.test.js`

## 3. 执行前差异与处理结果

| 需求 | 执行前代码 | 本轮处理 |
| --- | --- | --- |
| 不需要邮箱验证 | 仍有 `/api/auth/email-verification/request/` 和 `/confirm/`，仍有 `AccountToken`、`email_verified_at`、前端 API 方法和测试 | 删除邮箱验证逻辑，前端不调用，OpenAPI 不展示 |
| 不做邮箱重置密码 | 仍有 `/api/auth/password-reset/request/` 和 `/confirm/`，虽然只返回联系管理员/disabled | 不再保留 API 级邮箱重置流程；保留前端静态“联系管理员”说明即可 |
| 默认密码全局统一 | `accounts/services.py` 当前 `generate_default_password(username)` 返回 `用户名 + 6 位随机数` | 改为后端配置 `OPENMEDAILAB_DEFAULT_PASSWORD` |
| 默认密码不含用户名/随机数 | 当前测试断言 `^username\d{6}$` | 更新测试，断言不同用户恢复后得到同一个系统默认密码 |
| 管理员侧状态展示 | 当前只显示 `must_change_password ? 待修改默认密码 : 正常` | 保留这个低复杂度状态，不新增“已告知”等接口 |
| 邮箱修改同步 | 当前 `UserProfileForm.clean_contact_email()` 校验唯一，但保存后未同步 `User.email` 和 `email_normalized` | 在 `UserProfileForm.save()` 中同步 |
| 旧 HTML 账号入口 | `/accounts/login/`、`/accounts/register/`、`/accounts/profile/` 仍渲染 Django 模板 | 软移除并重定向到 Vue hash 页面 |
| 文档 | README 和旧 spec 仍描述邮箱验证、随机默认密码 | 更新文档到最终规则 |

## 4. 接口复用与新增边界

### 4.1 必须复用的现有 API

本轮执行只使用当前已有 API：

| 功能 | 现有接口 | 本轮处理 |
| --- | --- | --- |
| 注册 | `POST /api/auth/register/` | 保持路径不变 |
| 登录 | `POST /api/auth/login/` | 保持路径不变 |
| 退出 | `POST /api/auth/logout/` | 保持路径不变 |
| 当前用户 | `GET /api/me/` | 保持路径不变 |
| 用户资料 | `GET/PATCH/PUT /api/me/profile/` | 保持路径不变，补邮箱同步 |
| 强制改密 | `POST /api/auth/password/change-required/` | 保持路径不变，改成对比系统统一默认密码 |
| 管理员用户列表 | `GET /api/admin/users/` | 保持路径不变 |
| 管理员恢复默认密码 | `POST /api/admin/users/{uid}/reset-password/` | 保持路径不变，改为系统统一默认密码 |

### 4.2 本轮不新增任何 HTTP API

不得新增：

- 邮箱验证接口。
- 邮箱重置密码接口。
- `reset-password/delivered` 接口。
- 查询默认密码明文接口。
- 创建管理员的 HTTP API。
- 单独切换用户默认密码状态的接口。

### 4.3 已移除的冗余接口

执行前代码中以下接口与最终需求不一致，本轮已按要求移除：

```text
POST /api/auth/email-verification/request/
POST /api/auth/email-verification/confirm/
POST /api/auth/password-reset/request/
POST /api/auth/password-reset/confirm/
```

执行结果：

- 已从前端 API 封装中删除调用方法。
- 已从 `api/ninja_api.py` 删除接口定义，没有保留 disabled 版本。
- 已从 README 和交接文档中删除这些 API。
- 前端保留静态“忘记密码”页面，页面只提示联系管理员，不调用 API。

验收以 API 文档为准：最终 `/api/docs` 不应展示这些接口。

## 5. 数据模型调整

### 5.1 保留字段

继续保留：

- `UserProfile.uid`
- `UserProfile.email_normalized`
- `UserProfile.must_change_password`

### 5.2 移除邮箱验证字段和 token

最终不需要：

- `UserProfile.email_verified_at`
- `AccountToken`
- `accounts/tokens.py`

执行方式：

- 新增 migration 删除 `email_verified_at` 字段。
- 新增 migration 删除 `AccountToken` 模型。
- 删除 `accounts/tokens.py`。
- 删除 `api/serializers.py` 中 `email_verified` 和 `email_verified_at` 返回字段。
- 删除 `accounts/admin.py` 中 `email_verified_at` 的展示和筛选。
- 删除相关 tests。

如果担心已有环境存在历史 token 数据，迁移前确认这些 token 不再被任何业务使用。当前最终需求中没有任何流程依赖 token。

### 5.3 不新增默认密码状态字段

为了避免额外复杂度，本轮不新增：

- `default_password_set_at`
- `default_password_first_login_at`
- `default_password_delivered_at`
- `default_password_expires_at`

管理员侧状态复用现有 `must_change_password`：

- `must_change_password=false`：正常。
- `must_change_password=true`：待用户修改默认密码。

这是当前需求所需的最小状态。

## 6. 系统统一默认密码方案

### 6.1 后端配置

在 `config/settings.py` 增加：

```python
OPENMEDAILAB_DEFAULT_PASSWORD = os.getenv("OPENMEDAILAB_DEFAULT_PASSWORD", "")
```

规则：

- 默认密码必须来自后端配置。
- 前端不得写死默认密码。
- 配置为空时，管理员恢复默认密码返回错误。
- 默认密码必须通过 Django 密码强度校验。

### 6.2 修改账号服务

修改 `accounts/services.py`：

- 删除 `generate_default_password(username)`。
- 增加 `get_system_default_password()`。
- 修改 `reset_user_to_default_password(user)`：
  - 读取 `OPENMEDAILAB_DEFAULT_PASSWORD`。
  - 使用同一个默认密码设置所有被恢复账号。
  - 设置 `profile.must_change_password=True`。
  - 返回系统统一默认密码，仅用于本次响应展示。

### 6.3 修改强制改密

修改 `POST /api/auth/password/change-required/`：

- 新密码不能等于系统统一默认密码。
- 保留现有“修改成功后 logout”行为。
- 保留现有 `password_change_not_required` 行为。

## 7. 邮箱唯一与同步

当前注册邮箱唯一已基本满足，但资料更新仍需补同步。

修改 `accounts/forms.py` 的 `UserProfileForm.save()`：

- 如果 `contact_email` 修改：
  - 同步 `self.instance.user.email`。
  - 同步 `self.instance.email_normalized`。
  - 保存 user 和 profile。
- 继续保留大小写不敏感唯一检查。

不新增邮箱验证状态。

## 8. 管理员侧前端调整

当前已有用户管理 tab 和恢复默认密码按钮。

本轮只调整文案和状态：

- 按钮文案：`恢复为系统默认密码`。
- 成功提示：`已恢复为系统统一默认密码，请线下告知用户。`
- 当次响应区域可显示 `default_password` 和复制按钮。
- 用户列表不常驻展示明文默认密码。
- 列表状态继续使用：
  - `must_change_password=true`：`待修改默认密码`
  - `must_change_password=false`：`正常`
- 不新增“已告知”按钮。
- 不新增“默认密码状态切换”接口。

## 9. 旧 HTML 账号入口

执行前最新 `dev` 仍保留旧 HTML 账号入口：

- `/accounts/login/`
- `/accounts/register/`
- `/accounts/profile/`

本轮需要软移除，避免维护两套注册/登录/资料页面：

- 保留 `login`、`register`、`profile` URL name，避免 `login_required` 和模板反向解析破坏。
- `/accounts/login/` 重定向到 `/#/login`。
- `/accounts/register/` 重定向到 `/#/register`。
- `/accounts/profile/` 重定向到 `/#/dashboard`。
- 不再渲染 `templates/accounts/login.html`、`register.html`、`profile.html`。

## 10. 测试更新计划

### 10.1 后端测试

更新 `api/tests.py`：

- 删除邮箱验证成功路径测试。
- 删除邮箱 token 测试。
- 删除邮箱重置 API 出现在 OpenAPI 的断言。
- 删除随机默认密码正则断言。
- 新增系统统一默认密码测试：
  - 设置 `OPENMEDAILAB_DEFAULT_PASSWORD`。
  - 管理员恢复两个不同用户。
  - 两个用户都能用同一个默认密码登录。
  - 响应中的默认密码不包含用户名和随机数。
  - 默认密码配置为空时恢复失败。
- 新增强制改密测试：
  - 新密码等于系统统一默认密码时失败。
  - 修改成功后默认密码失效，新密码可登录。
- 新增邮箱资料同步测试：
  - `PATCH /api/me/profile/` 修改 `contact_email` 后，`User.email`、`profile.contact_email`、`profile.email_normalized` 一致。

更新 `accounts/tests.py`：

- 保留唯一管理员测试。
- 如删除 `AccountToken`，确认无 token 测试残留。

### 10.2 前端测试

更新 `frontend/src/api.test.js`：

- 保留 CSRF 重试和退出兜底。
- 删除邮箱验证和邮箱重置 API 方法相关引用。
- 如新增复制按钮逻辑，可补简单单测。

新增或更新 Playwright E2E：

- 注册失败提示。
- 登录/退出。
- 管理员用户管理。
- 恢复为系统统一默认密码。
- 用户用系统统一默认密码登录后进入强制改密页。
- 强制改密后默认密码失效，新密码可用。
- 用户列表不常驻展示明文默认密码。

## 11. 执行步骤

- [x] **Step 1: 移除邮箱验证和邮箱重置 API**

  修改 `api/ninja_api.py`、`frontend/src/api.js`、`api/tests.py`、README 和相关 docs，删除邮箱验证/邮箱重置接口。最终 `/api/docs` 不展示这些接口。

- [x] **Step 2: 移除邮箱验证模型复杂度**

  修改 `accounts/models.py`，删除 `email_verified_at` 和 `AccountToken`。同步清理 `accounts/admin.py`、`accounts/tokens.py`、`api/serializers.py` 和测试。新增 migration 删除字段和模型。

- [x] **Step 3: 改为系统统一默认密码**

  修改 `config/settings.py` 和 `accounts/services.py`，用 `OPENMEDAILAB_DEFAULT_PASSWORD` 替代 `用户名 + 随机数`。

- [x] **Step 4: 更新恢复默认密码 API 行为**

  复用 `POST /api/admin/users/{uid}/reset-password/`，保持路径不变。返回系统统一默认密码，不新增其他接口。

- [x] **Step 5: 更新强制改密校验**

  复用 `POST /api/auth/password/change-required/`，禁止新密码等于系统统一默认密码。

- [x] **Step 6: 修复资料邮箱同步**

  修改 `UserProfileForm.save()`，同步 `User.email`、`contact_email`、`email_normalized`。

- [x] **Step 7: 更新前端文案和管理页状态**

  修改 `frontend/src/main.js` 和必要 CSS。保留用户管理 tab，不新增已告知逻辑。

- [x] **Step 8: 更新测试和文档**

  更新后端测试、前端测试、README、`docs/user-registration-improvement-spec.md` 或新增交接说明。

## 12. 严格验收标准

### 12.1 禁止项

以下任一项出现即验收失败：

- `/api/docs` 展示邮箱验证接口。
- `/api/docs` 展示邮箱重置请求或确认接口。
- 新增 `reset-password/delivered` 接口。
- 新增查询默认密码明文接口。
- 前端写死系统统一默认密码。
- 管理员用户列表常驻展示明文默认密码。
- 默认密码包含用户名。
- 默认密码包含随机数。
- 不同用户恢复出不同默认密码。
- 普通用户获得管理员能力。
- 出现第二个平台管理员。

### 12.2 后端命令验收

必须通过：

```bash
conda run -n openmedailab python manage.py check
conda run -n openmedailab python manage.py makemigrations --check --dry-run
conda run -n openmedailab python manage.py test --verbosity 2
```

### 12.3 API 文档验收

访问：

```text
http://127.0.0.1:8000/api/docs
```

必须看到：

- `POST /api/auth/register/`
- `POST /api/auth/login/`
- `POST /api/auth/logout/`
- `POST /api/auth/password/change-required/`
- `GET /api/admin/users/`
- `POST /api/admin/users/{uid}/reset-password/`

不得看到：

- `POST /api/auth/email-verification/request/`
- `POST /api/auth/email-verification/confirm/`
- `POST /api/auth/password-reset/request/`
- `POST /api/auth/password-reset/confirm/`
- `reset-password/delivered`

### 12.4 后端行为验收

必须满足：

- 注册邮箱为空返回字段级错误。
- 重复邮箱大小写不同也返回字段级错误。
- 注册成功返回 UID。
- 修改资料邮箱后，`User.email`、`profile.contact_email`、`profile.email_normalized` 一致。
- `ensure_platform_admin` 创建的管理员 UID 为 `ADM00000001`。
- 系统中存在其他 staff/superuser 时，`ensure_platform_admin` 失败。
- 普通用户访问 `GET /api/admin/users/` 返回 403。
- 唯一平台管理员访问 `GET /api/admin/users/` 返回 200。
- 唯一平台管理员不能通过 `POST /api/admin/users/{uid}/reset-password/` 恢复自己的密码。
- `OPENMEDAILAB_DEFAULT_PASSWORD` 为空时，管理员恢复默认密码失败。
- 管理员恢复两个不同用户时，两者可用同一个系统统一默认密码登录。
- 恢复响应中的 `default_password` 不包含用户名，不包含随机数。
- 用户用系统统一默认密码登录后，`profile.must_change_password=true`。
- 默认密码登录后访问业务 API 返回 `403 password_change_required`。
- 强制改密时，新密码等于系统统一默认密码返回字段级错误。
- 强制改密成功后自动退出。
- 默认密码不能再次登录。
- 新密码可以登录并正常访问业务 API。

### 12.5 前端验收

必须通过：

```bash
cd frontend
npm run build
```

如果配置 Playwright：

```bash
cd frontend
npm run test:e2e
```

当前已有 Node API 单测也必须通过：

```bash
/Applications/Codex.app/Contents/Resources/node --test frontend/src/api.test.js
```

浏览器手动确认：

- 注册页错误提示正常。
- 登录和退出正常。
- 登录页“忘记密码”只提示联系管理员，不调用邮箱 API。
- 管理员能搜索用户并恢复为系统统一默认密码。
- 管理员自己那一行显示当前管理员状态，不显示可点击的恢复密码危险操作。
- 恢复成功当次可以复制默认密码。
- 刷新用户列表后不展示明文默认密码。
- 用户用系统统一默认密码登录后进入强制改密页。
- 强制改密前不能使用业务功能。
- 新密码不能等于系统统一默认密码。
- 改密成功后必须重新登录。
- 旧默认密码失效，新密码可用。

## 13. 交付清单

完成后应提交：

- 邮箱验证/邮箱重置 API 移除。
- `AccountToken` 和 `email_verified_at` 移除迁移。
- 系统统一默认密码配置和服务。
- 现有管理员恢复默认密码 API 行为更新。
- 现有强制改密 API 校验更新。
- 资料邮箱同步修复。
- 前端文案和管理页状态更新。
- 后端测试更新。
- 前端测试更新。
- README 和交接文档更新。
