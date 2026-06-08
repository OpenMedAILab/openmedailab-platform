# OpenMedAILab 用户注册登录最终规格与交付说明

版本：v1.1
日期：2026-06-08
分支：`codex/user-auth-default-password-flow`

## 1. 目标

本阶段目标是在保留现有核心 API 的前提下，降低账号体系复杂度，完善用户注册、登录、唯一 UID、唯一管理员、管理员恢复系统默认密码和强制改密流程。

最终规则：

- 保留注册、登录、退出、当前用户、资料、管理员用户管理和强制改密 API。
- 不再实现邮箱验证。
- 不再提供邮箱找回密码或邮箱重置密码 API。
- 用户忘记密码后只能联系系统管理员。
- 管理员可把用户密码恢复为后端配置的系统统一默认密码。
- 用户使用系统统一默认密码登录后，必须修改新密码并重新登录后才能正常使用系统。
- 平台管理员账户唯一，固定通过开发和管理命令维护，不提供公开创建接口。

## 2. 保留的 API

```text
POST /api/auth/register/
POST /api/auth/login/
POST /api/auth/logout/
GET  /api/me/
GET  /api/me/profile/
PATCH /api/me/profile/
PUT  /api/me/profile/
POST /api/auth/password/change-required/
GET  /api/admin/users/
POST /api/admin/users/{uid}/reset-password/
```

不得新增：

- 邮箱验证 API。
- 邮箱重置密码 API。
- 查询默认密码明文 API。
- `reset-password/delivered` API。
- 创建管理员的 HTTP API。
- 单独切换“已告知用户”的 API。

## 3. 注册与 UID

注册 API 继续使用：

```text
POST /api/auth/register/
```

请求字段保持：

- `username`
- `email`
- `display_name`
- `role_type`
- `password1`
- `password2`

规则：

- 邮箱必填。
- 邮箱大小写不敏感唯一。
- 邮箱统一归一化为小写。
- 注册写入必须事务化，用户、profile、初始积分流水要么全部成功，要么全部回滚。
- 注册失败必须返回字段级 `error.details`。
- 每个用户注册后有唯一 `profile.uid`。
- UID 按注册身份前缀生成，注册后不随资料身份修改而改变。

UID 前缀：

```text
student=S
doctor=D
teacher=T
ai_engineer=E
statistician=M
sponsor=F
other=U
platform admin=ADM00000001
```

## 4. 邮箱策略

最终不做邮箱验证闭环。

保留：

- `User.email`
- `UserProfile.contact_email`
- `UserProfile.email_normalized`

移除：

- `UserProfile.email_verified_at`
- `AccountToken`
- `accounts/tokens.py`
- `profile.email_verified`
- `profile.email_verified_at`

资料更新规则：

- 用户通过 `GET/PATCH/PUT /api/me/profile/` 修改 `contact_email` 时，必须同步更新 `User.email`。
- `contact_email`、`User.email`、`email_normalized` 必须保持一致。
- 继续保证邮箱大小写不敏感唯一。

## 5. 密码恢复与强制改密

平台不发送邮箱重置链接。

管理员恢复密码复用现有接口：

```text
POST /api/admin/users/{uid}/reset-password/
```

规则：

- 仅唯一平台管理员可访问。
- 管理员不能恢复自己的密码。
- 恢复后的密码来自后端配置 `OPENMEDAILAB_DEFAULT_PASSWORD`。
- 所有被恢复用户使用同一个系统默认密码。
- 默认密码不得包含用户名规则。
- 默认密码不得包含随机数规则。
- 默认密码配置为空时，接口返回 `422 default_password_not_configured`。
- 默认密码必须通过 Django 密码校验器。
- 接口只在当次响应返回 `default_password`，用户列表不得常驻展示明文默认密码。
- 管理员线下告知用户默认密码。

用户使用系统默认密码登录后：

- `profile.must_change_password=true`。
- 业务 API 返回 `403 password_change_required`。
- 用户只能访问 `/api/me/`、退出和强制改密接口。
- 用户必须调用：

```text
POST /api/auth/password/change-required/
```

强制改密规则：

- 新密码不能等于系统默认密码。
- 新密码必须通过 Django 密码校验器。
- 两次密码不一致返回字段级错误。
- 修改成功后清除 `must_change_password`。
- 修改成功后自动退出登录。
- 默认密码失效，新密码可重新登录。

## 6. 唯一管理员

平台管理员账户唯一：

- 用户名默认：`platform_admin`
- UID 固定：`ADM00000001`
- 必须是 `is_staff=true` 且 `is_superuser=true`
- 只能通过管理命令创建或修复
- 公共注册不能创建管理员
- HTTP API 不提供管理员创建入口

管理命令：

```bash
conda run -n openmedailab python manage.py ensure_platform_admin --username platform_admin --email admin@example.com --password '<strong-password>'
```

如果数据库里已经存在其他 staff/superuser，命令必须失败，避免出现第二个平台管理员。

## 7. 前端要求

注册页：

- 展示 label、必填标识、密码提示。
- 展示字段级错误。
- 提交中状态不能重复提交。
- 成功注册后继续自动登录。

忘记密码页：

- 只提示联系系统管理员。
- 不展示邮箱重置表单。
- 不调用邮箱重置 API。

管理员用户管理页：

- 可按 UID、用户名、邮箱或昵称搜索用户。
- 按钮文案为“恢复为系统默认密码”。
- 成功提示为“已恢复为系统统一默认密码，请线下告知用户。”
- 当次响应可展示并复制默认密码。
- 用户列表只展示状态，不常驻展示明文默认密码。
- `must_change_password=true` 展示为“待修改默认密码”。
- `must_change_password=false` 展示为“正常”。

强制改密页：

- 用户使用系统默认密码登录后自动进入。
- 明确提示不能继续使用系统默认密码。
- 修改成功后提示重新登录。

## 8. 旧 HTML 入口

产品只走 Vue 前端，旧 Django HTML 入口软移除：

- `/accounts/login/` 重定向到 `/#/login`
- `/accounts/register/` 重定向到 `/#/register`
- `/accounts/profile/` 重定向到 `/#/dashboard`

继续保留 URL name，避免内部反向解析破坏。

## 9. 严格验收标准

API 文档必须看到：

```text
POST /api/auth/register/
POST /api/auth/login/
POST /api/auth/logout/
POST /api/auth/password/change-required/
GET  /api/admin/users/
POST /api/admin/users/{uid}/reset-password/
```

API 文档不得看到：

```text
POST /api/auth/email-verification/request/
POST /api/auth/email-verification/confirm/
POST /api/auth/password-reset/request/
POST /api/auth/password-reset/confirm/
reset-password/delivered
```

后端验收：

- 注册邮箱为空返回字段级错误。
- 重复邮箱大小写不同也返回字段级错误。
- 注册成功返回 UID。
- 修改资料邮箱后，`User.email`、`profile.contact_email`、`profile.email_normalized` 一致。
- 唯一平台管理员 UID 为 `ADM00000001`。
- 普通用户访问管理员用户管理 API 返回 403。
- 平台管理员恢复自己的密码时返回 `422 self_reset_forbidden`。
- `OPENMEDAILAB_DEFAULT_PASSWORD` 为空时，管理员恢复默认密码失败。
- 管理员恢复两个不同用户时，两者得到同一个系统默认密码。
- 恢复响应中的 `default_password` 不包含用户名，不包含随机数。
- 系统默认密码登录后必须强制改密。
- 新密码等于系统默认密码时返回字段级错误。
- 强制改密成功后自动退出。
- 默认密码不能再次登录，新密码可以登录。

前端验收：

- 注册错误提示清晰。
- 登录和退出正常。
- 忘记密码页不调用邮箱 API。
- 管理员能搜索用户并恢复为系统统一默认密码。
- 管理员自己那一行不得出现可点击的恢复密码危险操作。
- 恢复成功当次可以复制默认密码。
- 刷新用户列表后不展示明文默认密码。
- 用户使用系统默认密码登录后进入强制改密页。
- 强制改密前不能使用业务功能。
- 改密成功后必须重新登录。

## 10. 必跑命令

```bash
conda run -n openmedailab python manage.py check
conda run -n openmedailab python manage.py makemigrations --check --dry-run
conda run -n openmedailab python manage.py test --verbosity 2
/Applications/Codex.app/Contents/Resources/node --test frontend/src/api.test.js
cd frontend && npm run build
```
