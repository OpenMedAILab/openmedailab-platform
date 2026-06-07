# OpenMedAILab 用户注册完善规格文档

版本：v1.0  
日期：2026-06-08  
分支：`codex/user-registration-improvements`

## 1. 目标

本阶段目标是在不破坏现有 API 的前提下，完善用户注册、邮箱、密码重置、唯一 UID、唯一管理员账户和注册测试覆盖。

核心目标：

- 保留现有注册 API 路径和主要请求字段。
- 修复前端注册错误提示过于泛化的问题。
- 提升注册页表单体验。
- 为每个用户生成唯一平台 UID，并按身份前缀区分。
- 保证邮箱唯一，并设计邮箱验证流程。
- 增加管理员恢复默认密码与强制改密流程。
- 保证注册写入事务化。
- 补齐注册失败路径测试。
- 清理旧 API view，避免维护误改。
- 保留一个唯一管理员账户，用于后台审核、项目更新和后续任务管理。

## 2. 兼容性原则

必须保持现有 API 不变：

```text
POST /api/auth/register/
POST /api/auth/login/
POST /api/auth/logout/
GET  /api/me/
GET  /api/me/profile/
PATCH /api/me/profile/
PUT /api/me/profile/
```

允许增强：

- `POST /api/auth/register/` 继续使用现有路径。
- `username`、`email`、`display_name`、`role_type`、`password1`、`password2` 字段继续保留。
- `email` 从业务规则上变为必填且唯一。
- 返回的 `data.profile` 可以新增字段，例如 `uid`、`email_verified`、`email_verified_at`。
- 错误仍使用现有 envelope：

```json
{
  "ok": false,
  "error": {
    "code": "validation_error",
    "message": "Registration failed.",
    "details": {}
  }
}
```

新增必要 API：

```text
POST /api/auth/email-verification/request/
POST /api/auth/email-verification/confirm/
POST /api/auth/password-reset/request/
POST /api/auth/password-reset/confirm/
POST /api/auth/password/change-required/
GET  /api/admin/users/
POST /api/admin/users/{uid}/reset-password/
```

## 3. 当前问题与修复要求

### 3.1 前端错误提示太弱

现状：

- 后端已经返回字段级错误 `error.details`。
- 前端只读取 `error.message`，用户通常只看到 `Registration failed.`。

修复要求：

- 前端注册页必须解析 `error.payload.error.details`。
- 每个字段下展示对应错误。
- 顶部或 toast 可以保留总体提示，但不能替代字段级错误。
- 支持字段：
  - `username`
  - `email`
  - `display_name`
  - `role_type`
  - `password1`
  - `password2`
  - `__all__`

示例：

```json
{
  "username": [
    {
      "message": "已存在一位使用该名字的用户。",
      "code": "unique"
    }
  ]
}
```

前端显示：

```text
用户名
已存在一位使用该名字的用户。
```

### 3.2 注册页表单体验不完整

现状：

- 注册页主要依赖 placeholder。
- 没有显式 label。
- 没有 required 标识。
- 没有字段级错误容器。
- 没有密码规则说明。
- 没有提交中状态。
- 没有防重复点击。

修复要求：

- 每个输入项必须有可见 label。
- 必填项必须有明确标记。
- 字段错误必须靠近对应输入项。
- 错误字段必须设置 `aria-invalid="true"`。
- 错误文案必须通过 `aria-describedby` 关联。
- 提交时按钮 disabled，并显示“正在创建...”。
- 提交过程中禁止重复提交。
- 密码字段下展示规则：
  - 至少 8 位。
  - 不能过于常见。
  - 不能全数字。
  - 两次输入必须一致。

### 3.3 用户 UID 设计

现状：

- 用户有数据库主键 `User.id`。
- 用户有 `username`。
- 没有平台公开 UID。

修复要求：

- 在 `UserProfile` 增加唯一字段 `uid`。
- UID 用于平台展示、后续任务管理、审核、协作记录追踪。
- UID 不能替代数据库主键。
- UID 不能替代登录用户名。
- UID 注册后不可变。
- 用户后续修改身份时，UID 不变化。

推荐 UID 规则：

```text
学生 student:        S00000001
医生 doctor:         D00000002
老师 teacher:        T00000003
AI 工程师:           E00000004
医学统计:            M00000005
资助者 sponsor:      F00000006
其他 other:          U00000007
唯一管理员:          ADM00000001
```

前缀规则：

| role_type | 身份 | UID 前缀 |
| --- | --- | --- |
| `student` | 学生 | `S` |
| `doctor` | 医生 | `D` |
| `teacher` | 老师 | `T` |
| `ai_engineer` | AI 工程师 | `E` |
| `statistician` | 医学统计 | `M` |
| `sponsor` | 资助者 | `F` |
| `other` | 其他 | `U` |
| platform admin | 唯一管理员 | `ADM` |

编号规则：

- 普通用户使用 `User.id` 左侧补零到 8 位。
- 例如 `User.id = 25` 且身份为学生，则 UID 为 `S00000025`。
- 唯一管理员使用 `ADM00000001`。
- UID 必须数据库唯一。

### 3.4 邮箱唯一性与邮箱验证

现状：

- `email` 是可选字段。
- 不保证唯一。
- 没有邮箱验证。

修复要求：

- 注册时邮箱必填。
- 邮箱大小写不敏感唯一。
- 建议新增 `email_normalized` 字段存储小写邮箱。
- `email_normalized` 必须有唯一约束。
- 用户保存时自动归一化：

```text
Wang@example.COM -> wang@example.com
```

邮箱验证复杂度评估：

- 开发环境：低复杂度。可以使用 console email backend，将邮件打印到终端或日志。
- 生产环境：中等复杂度。需要 SMTP 或第三方邮件服务、邮件模板、发送失败处理、token 过期和重发限制。

新增邮箱验证 API：

```text
POST /api/auth/email-verification/request/
POST /api/auth/email-verification/confirm/
```

请求验证码：

```json
{}
```

说明：

- 必须登录。
- 对当前登录用户发送验证邮件。
- 如果邮箱已验证，返回 `ok: true`，并提示无需重复验证。
- 同一用户短时间内重复请求应限流。

确认邮箱：

```json
{
  "token": "..."
}
```

成功返回：

```json
{
  "ok": true,
  "data": {
    "email_verified": true,
    "email_verified_at": "2026-06-08T00:00:00+08:00"
  }
}
```

### 3.5 管理员恢复默认密码与强制改密

现状：

- 不再允许通过邮箱发送密码重置链接。
- 用户忘记密码后必须联系系统管理员。

修复要求：

- 保留旧邮箱重置 API 路径，但不再生成 token、不发送邮件、不返回 UID。
- 管理员通过用户 UID 将密码恢复为默认密码。
- 默认密码格式为 `username + 6 位随机数`，例如 `alice483920`。
- 用户使用默认密码登录后，系统必须强制要求修改新密码。
- 修改新密码成功后，系统必须退出登录，用户必须用新密码重新登录后才能使用系统。

保留兼容 API：

```text
POST /api/auth/password-reset/request/
POST /api/auth/password-reset/confirm/
```

`POST /api/auth/password-reset/request/` 返回：

```json
{
  "ok": true,
  "data": {
    "message": "密码重置请联系系统管理员。系统管理员会恢复默认密码并要求你首次登录后修改密码。"
  }
}
```

`POST /api/auth/password-reset/confirm/` 返回 `400 password_reset_disabled`。

新增管理员 API：

```text
GET  /api/admin/users/
POST /api/admin/users/{uid}/reset-password/
```

管理员重置成功返回：

```json
{
  "ok": true,
  "data": {
    "user": {},
    "default_password": "alice483920"
  }
}
```

新增用户强制改密 API：

```text
POST /api/auth/password/change-required/
```

请求：

```json
{
  "password1": "StrongPass12345",
  "password2": "StrongPass12345"
}
```

成功后：

- 清除 `must_change_password`。
- 自动退出登录。
- 默认密码不能再登录。
- 新密码可以重新登录。

失败情况：

- 密码过弱。
- 两次密码不一致。
- 新密码与默认密码相同。
- 未登录用户访问返回 401。
- 非管理员访问管理员重置接口返回 403。

### 3.6 注册写入事务化

现状：

- 注册流程先创建用户，再写积分流水。
- 如果中间失败，可能出现用户已创建但积分流水缺失。

修复要求：

- 注册 API 必须使用 `transaction.atomic()`。
- 以下操作必须在同一个事务中完成：
  - 创建 `User`。
  - 创建或更新 `UserProfile`。
  - 生成并保存 UID。
  - 写入 `CreditLedger` 注册奖励。
- 登录操作应在事务成功后执行。

事务成功后必须满足：

```text
auth_user 存在
accounts_userprofile 存在
accounts_userprofile.uid 存在且唯一
credits_creditledger 中存在 register_bonus
```

事务失败后必须满足：

```text
auth_user 不残留
accounts_userprofile 不残留
credits_creditledger 不残留
```

### 3.7 测试覆盖不足

现状：

- 已覆盖成功注册、初始积分、后续互动、dashboard。
- 缺少失败路径测试。

必须新增测试：

- 重复用户名返回 422。
- 重复邮箱返回 422。
- 邮箱大小写不敏感唯一。
- 弱密码返回 422。
- 两次密码不一致返回 422。
- 邮箱格式非法返回 422。
- 身份非法返回 422。
- 注册成功生成 UID。
- 不同身份 UID 前缀正确。
- 修改身份后 UID 不变化。
- 唯一管理员 UID 为 `ADM00000001`。
- 公共注册不能创建管理员。
- 注册事务失败会回滚。
- 重复点击或重复请求不会产生重复积分流水。
- 邮箱验证请求成功。
- 邮箱验证确认成功。
- 邮箱验证无效 token 返回 422。
- 密码重置申请不生成邮箱 token。
- 管理员可按 UID 恢复默认密码。
- 默认密码登录后必须改密。
- 改密成功后必须重新登录。

测试命令：

```bash
conda run -n openmedailab python manage.py test accounts api --verbosity 2
```

必须通过全部测试。

### 3.8 清理旧 API view

现状：

- 当前 API 路由实际挂载 `api/ninja_api.py`。
- `api/views.py` 中仍保留旧注册逻辑。
- 后续维护容易改错文件。

修复要求：

- 删除 `api/views.py` 中未使用的旧注册、登录、资料接口逻辑，或改为明确的兼容说明文件。
- `api/urls.py` 必须继续只挂 `ninja_api.py`。
- README 中说明当前 API 唯一实现入口是 `api/ninja_api.py`。

验收要求：

- 搜索 `def register` 时，不能出现多个可调用 API 注册实现。
- `api/views.py` 不再包含容易误改的旧业务逻辑。

## 4. 唯一管理员账户设计

### 4.1 管理员账户定位

系统必须保留一个唯一管理员账户。该账户用于：

- 后台审核用户身份。
- 后台审核参与意向、认领意向、资助意向。
- 更新项目状态。
- 更新课题内容。
- 管理已经在进行的任务。
- 管理后续贡献审核和积分调整。
- 执行项目归档、恢复、异常处理。

该账户不通过普通注册页面创建。

### 4.2 唯一性规则

必须保证系统中只有一个平台管理员账户。

管理员定义：

```text
is_staff = true
is_superuser = true
```

唯一管理员推荐配置：

```text
username = platform_admin
uid = ADM00000001
```

可以通过环境变量覆盖：

```text
OPENMEDAILAB_PLATFORM_ADMIN_USERNAME=platform_admin
OPENMEDAILAB_PLATFORM_ADMIN_EMAIL=admin@example.com
```

但无论配置为何，系统中只能有一个平台管理员。

### 4.3 创建和维护方式

建议新增管理命令：

```bash
conda run -n openmedailab python manage.py ensure_platform_admin
```

命令职责：

- 如果唯一管理员不存在，则创建。
- 如果唯一管理员存在，则更新其 email、profile、uid。
- 如果发现多个 `is_staff` 或 `is_superuser` 用户，则报错并拒绝静默处理。
- 管理员 UID 固定为 `ADM00000001`。

### 4.4 公共注册限制

公共注册 API 必须禁止创建管理员。

要求：

- `POST /api/auth/register/` 不能接受 admin 身份。
- `role_type` 只能取现有普通身份：
  - `doctor`
  - `student`
  - `teacher`
  - `ai_engineer`
  - `statistician`
  - `sponsor`
  - `other`
- 普通注册用户的 `is_staff` 必须是 `false`。
- 普通注册用户的 `is_superuser` 必须是 `false`。

### 4.5 管理员验收标准

必须满足：

- 系统初始化后存在且仅存在一个平台管理员。
- 管理员 UID 为 `ADM00000001`。
- 管理员可以登录 Django Admin。
- 管理员可以访问前端管理页。
- 管理员可以更新主题、主题文件、项目。
- 管理员可以执行后续任务管理和审核入口。
- 普通注册不能创建第二个管理员。
- 任何试图创建第二个 `is_staff` 或 `is_superuser` 用户的路径必须被测试覆盖或明确禁止。

## 5. 数据模型修复清单

### 5.1 UserProfile 增加字段

建议在 `accounts.UserProfile` 增加：

```text
uid: unique, indexed, not null after migration
email_normalized: unique, indexed
email_verified_at: nullable datetime
must_change_password: boolean
```

字段含义：

- `uid`：平台唯一用户编号。
- `email_normalized`：小写邮箱，用于唯一性校验。
- `email_verified_at`：邮箱验证时间。
- `must_change_password`：管理员恢复默认密码后，用户必须改密的状态标记。

### 5.2 新增 Token 模型

建议新增邮箱验证 token 模型，或使用 Django 自带 token 机制。密码恢复不使用 token，由管理员恢复默认密码。

如果自定义模型，建议字段：

```text
user
token_hash
purpose
expires_at
used_at
created_at
```

`purpose` 可取：

```text
email_verification
```

要求：

- 数据库存 token hash，不存明文 token。
- token 有过期时间。
- token 使用后必须失效。

## 6. 前端修复清单

必须修改 `frontend/src/main.js` 和必要的样式文件。

注册页需要新增状态：

```text
registerSubmitting
registerErrors
```

错误格式建议：

```js
{
  username: ["已存在一位使用该名字的用户。"],
  email: ["该邮箱已经注册。"],
  password2: ["输入的两个密码不一致。"]
}
```

注册提交流程：

```text
点击创建账号
  -> 清空旧错误
  -> 设置 registerSubmitting = true
  -> 调用 api.register
  -> 成功：进入 dashboard
  -> 失败：解析 details 并展示字段错误
  -> finally：registerSubmitting = false
```

## 7. 后端 API 修复清单

必须修改 `api/ninja_api.py`。

注册 API 修复：

- email 必填。
- email 归一化。
- email 唯一校验。
- transaction.atomic。
- UID 生成。
- 注册奖励流水事务化。
- 保持原接口路径不变。

新增 API：

- `POST /api/auth/email-verification/request/`
- `POST /api/auth/email-verification/confirm/`
- `POST /api/auth/password-reset/request/`
- `POST /api/auth/password-reset/confirm/`
- `POST /api/auth/password/change-required/`
- `GET /api/admin/users/`
- `POST /api/admin/users/{uid}/reset-password/`

## 8. 文档修复清单

必须更新 README 或 API 文档，说明：

- 注册接口。
- UID 规则。
- 邮箱唯一规则。
- 邮箱验证接口。
- 管理员恢复默认密码接口。
- 强制改密接口。
- 唯一管理员账户规则。
- 当前 API 实现入口是 `api/ninja_api.py`。

## 9. 严格验收标准

### 9.1 API 兼容验收

- `POST /api/auth/register/` 路径不变。
- 原有请求字段继续可用。
- envelope 格式不变。
- 原有登录、退出、个人资料 API 不变。
- Swagger 中 Auth/Me 接口正常显示。

### 9.2 注册成功验收

- 用户注册成功返回 201。
- 返回 `data.profile.uid`。
- 返回 `data.profile.email_verified`。
- 数据库写入 `auth_user`。
- 数据库写入 `accounts_userprofile`。
- 数据库写入 `credits_creditledger` 注册奖励。
- 注册后自动登录。
- 注册后访问 `/api/me/dashboard/` 返回 200。

### 9.3 注册失败验收

以下场景全部返回 422，并带字段级 `details`：

- 重复用户名。
- 重复邮箱。
- 邮箱大小写重复。
- 邮箱格式非法。
- 弱密码。
- 两次密码不一致。
- 身份非法。
- 缺少邮箱。
- 缺少密码。

### 9.4 前端体验验收

- 注册页每个字段有 label。
- 必填字段有标记。
- 字段错误显示在对应字段下。
- 错误字段设置 `aria-invalid`。
- 提交中按钮 disabled。
- 连续点击不会重复提交。
- 成功后进入 dashboard。
- 失败后停留在注册页并展示具体错误。
- 浏览器控制台无错误。

### 9.5 UID 验收

- 每个用户 UID 唯一。
- UID 前缀符合身份。
- UID 注册后不可变。
- 修改资料中的身份不会改变 UID。
- `/api/me/` 返回 UID。
- `/api/me/profile/` 返回 UID。
- 管理员 UID 固定为 `ADM00000001`。

### 9.6 邮箱验证验收

- 登录用户可请求邮箱验证。
- 已验证邮箱重复请求返回成功但不重复改变状态。
- 有效 token 可完成验证。
- 无效 token 返回 422。
- 过期 token 返回 422。
- 验证成功后 `email_verified_at` 有值。

### 9.7 密码重置验收

- 普通用户不能通过邮箱获得重置链接或 token。
- `POST /api/auth/password-reset/request/` 只提示联系系统管理员。
- `POST /api/auth/password-reset/confirm/` 返回 `400 password_reset_disabled`。
- 管理员可通过 `POST /api/admin/users/{uid}/reset-password/` 生成默认密码。
- 默认密码格式为 `username + 6 位随机数`。
- 管理员重置后用户 `must_change_password=true`。
- 用户使用默认密码登录后不能访问业务 API。
- 用户只能访问 `/api/me/`、退出登录和强制改密接口。
- 用户改密成功后自动退出登录。
- 默认密码不能再登录，新密码可以登录。
- 弱密码、两次密码不一致、继续使用默认密码都返回字段级错误。

### 9.8 事务验收

- 模拟 UID 保存失败时，用户不残留。
- 模拟积分流水创建失败时，用户不残留。
- 注册成功时用户、profile、ledger 三者一致。
- 重复提交不能产生重复 ledger。

### 9.9 唯一管理员验收

- 系统中仅有一个 `is_staff=true` 且 `is_superuser=true` 的平台管理员。
- 管理员 UID 是 `ADM00000001`。
- 公共注册不能创建管理员。
- 管理命令可创建或校正唯一管理员。
- 如果数据库出现多个管理员，管理命令必须报错。
- 管理员可访问 Django Admin。
- 管理员可访问前端管理页。
- 管理员可用于后续审核、项目更新、任务管理。

### 9.10 测试验收

必须通过：

```bash
conda run -n openmedailab python manage.py test accounts api --verbosity 2
```

必须新增失败路径测试，并覆盖：

- 注册成功。
- 注册失败。
- UID。
- 邮箱唯一。
- 邮箱验证。
- 管理员恢复默认密码。
- 默认密码登录后的强制改密。
- 注册事务。
- 唯一管理员。
- 旧 API view 清理。

## 10. 不在本阶段实现的内容

以下内容不在本阶段强制实现：

- 第三方 OAuth 登录。
- 手机号登录。
- 短信验证码。
- 复杂实名认证。
- 多管理员权限分级。
- 积分商城。
- 完整任务市场。

## 11. 完成定义

本阶段完成时必须满足：

- 文档中所有“必须”项已实现。
- 现有 API 未被破坏。
- 新增 API 已进入 Swagger。
- 前端注册页可用且错误清晰。
- 邮箱唯一和 UID 唯一有数据库约束。
- 唯一管理员账户存在且不可通过公共注册创建。
- 注册、邮箱验证、管理员恢复默认密码、强制改密和管理员相关测试全部通过。

## 12. 本分支交付状态

本分支已完成本规格文档要求的注册、UID、邮箱、管理员恢复默认密码、强制改密、唯一管理员和测试覆盖工作，并额外修复了登录后退出按钮在 CSRF token 轮换或服务端会话已失效时可能无响应的问题。

已交付内容：

- 保留原有注册、登录、退出、个人资料和业务 API 路径。
- 注册页展示可见 label、必填标识、密码提示、提交中状态和字段级错误。
- 注册 API 返回字段级 `error.details`，前端按字段展示错误。
- `UserProfile.uid` 唯一且有身份前缀，注册后不随身份变更而改变。
- 邮箱注册必填，大小写不敏感唯一，`email_normalized` 有唯一约束。
- 邮箱验证 API 已加入 OpenAPI 文档。
- 邮箱密码重置链接流程已禁用，用户只能联系系统管理员恢复默认密码。
- 管理员可通过 UID 恢复默认密码，默认密码为 `username + 6 位随机数`。
- 默认密码登录后只能访问 `/api/me/`、退出和强制改密接口；改密成功后自动退出。
- 平台管理员通过 `ensure_platform_admin` 创建或修复，固定 UID 为 `ADM00000001`。
- 删除旧 `api/views.py`，避免维护者误改非实际 API 入口。
- 注册写入通过 `transaction.atomic()` 保证用户、profile 和注册奖励流水一致。
- 前端 API 客户端在 CSRF 失败时刷新 token 并重试一次 unsafe 请求；退出接口遇到 401 时视为已退出，避免界面卡住。

浏览器验收已覆盖：

- 游客态入口、注册页字段、空表单错误、非法邮箱、弱密码、密码不一致。
- 成功注册后自动登录 dashboard，随后退出回到游客态且控制台无新增错误。
- 重复邮箱大小写不敏感报错。
- 找回密码页只提示联系系统管理员，不提供邮箱重置表单。
- 管理员可进入前端管理页，并在用户管理中搜索用户。
- 默认密码登录后强制进入改密页，业务页访问会被拉回改密页。
- 强制改密字段错误、成功改密后自动退出、默认密码失效、新密码可登录。
- `/api/docs` 中可见注册、退出、邮箱验证、密码重置禁用、强制改密和管理员用户 API。

命令验收已覆盖：

```bash
/Applications/Codex.app/Contents/Resources/node --test frontend/src/api.test.js
/Applications/Codex.app/Contents/Resources/node --check frontend/src/api.js
/Applications/Codex.app/Contents/Resources/node --check frontend/src/main.js
conda run -n openmedailab python manage.py check
conda run -n openmedailab python manage.py makemigrations --check --dry-run
conda run -n openmedailab python manage.py test --verbosity 2
git diff --check
```

验收结果：

- 前端 API 客户端测试 2 项通过。
- Django 测试 23 项通过。
- migration 检查无新增变更。
- 系统检查无错误。
- diff 空白检查无输出。

本地验收时发现一条旧版密码重置 token 残留数据，属于旧流程历史数据；当前新接口不会再生成 `password_reset` token，`POST /api/auth/password-reset/confirm/` 固定返回 `password_reset_disabled`。
