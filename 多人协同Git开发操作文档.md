# OpenMedAILab 多人协同 Git 开发操作文档

本文档用于 OpenMedAILab 项目多人协同开发。协作目标是：每个人在自己的功能分支开发，完成后通过 GitHub Pull Request 合并到 `dev`，稳定后再合并到 `main`。

## 1. 分支说明

项目使用三类分支：

```text
main
dev
feature/xxx
```

各分支作用：

| 分支 | 作用 | 是否直接开发 |
| --- | --- | --- |
| `main` | 稳定可部署版本 | 不直接开发 |
| `dev` | 日常集成开发版本 | 不直接写代码，主要用于合并 |
| `feature/xxx` | 个人功能开发分支 | 在这里开发 |

基本规则：

- 不直接在 `main` 上写代码。
- 不直接在 `dev` 上长期写代码。
- 每个任务从 `dev` 新建一个 `feature/...` 分支。
- 功能完成后，提交 Pull Request 到 `dev`。
- `dev` 测试稳定后，再 Pull Request 到 `main`。

## 2. 第一次获取项目

如果还没有克隆项目，先执行：

```bash
git clone https://github.com/OpenMedAILab/openmedailab-platform.git
cd openmedailab-platform
```

获取远端分支：

```bash
git fetch origin
```

切换到 `dev` 分支：

```bash
git switch -c dev origin/dev
```

检查当前状态：

```bash
git status
```

看到类似下面内容表示正常：

```text
On branch dev
Your branch is up to date with 'origin/dev'.
```

## 3. 每次开始新任务前

先同步最新 `dev`：

```bash
git switch dev
git pull --ff-only origin dev
```

然后从 `dev` 新建自己的功能分支：

```bash
git switch -c feature/your-task-name
```

示例：

```bash
git switch -c feature/project-pages
git switch -c feature/backend-core
git switch -c feature/import-topics
git switch -c feature/frontend-interactions
git switch -c feature/backend-interactions
```

建议分支命名：

| 类型 | 示例 | 说明 |
| --- | --- | --- |
| 前端页面 | `feature/project-pages` | 页面、模板、样式 |
| 后端核心 | `feature/backend-core` | model、view、路由 |
| 数据导入 | `feature/import-topics` | 课题导入命令 |
| 互动前端 | `feature/frontend-interactions` | 表单、按钮、提示 |
| 互动后端 | `feature/backend-interactions` | 关注、评分、参与逻辑 |
| 部署 | `feature/deploy` | Nginx、systemd、部署文档 |
| 修复问题 | `fix/login-error` | bug 修复 |
| 文档更新 | `docs/git-workflow` | 文档类修改 |

## 4. 本地开发流程

在自己的 `feature/...` 分支上开发。

开发过程中可以随时查看状态：

```bash
git status
```

查看改了哪些内容：

```bash
git diff
```

把修改加入暂存区：

```bash
git add .
```

提交修改：

```bash
git commit -m "feat: add project list page"
```

第一次推送功能分支：

```bash
git push -u origin feature/your-task-name
```

后续同一个分支再次推送：

```bash
git push
```

## 5. 提交信息规范

推荐格式：

```text
类型: 简短说明
```

常用类型：

| 类型 | 用途 | 示例 |
| --- | --- | --- |
| `feat` | 新功能 | `feat: add project list page` |
| `fix` | 修复 bug | `fix: prevent duplicate scores` |
| `docs` | 文档 | `docs: update deployment guide` |
| `style` | 样式调整 | `style: improve dashboard layout` |
| `refactor` | 重构 | `refactor: simplify project query` |
| `chore` | 配置、杂项 | `chore: update gitignore` |
| `test` | 测试 | `test: add project view tests` |

示例：

```bash
git commit -m "feat: add user dashboard"
git commit -m "fix: handle empty search result"
git commit -m "docs: add git collaboration guide"
```

## 6. Pull Request 合并流程

功能分支推送到 GitHub 后，在 GitHub 页面创建 Pull Request。

创建 PR 时注意：

```text
base: dev
compare: feature/your-task-name
```

也就是：

```text
把自己的 feature 分支合并到 dev
```

不要直接把 `feature/...` 合并到 `main`。

PR 标题建议：

```text
feat: add project list page
fix: prevent duplicate score submit
docs: add git collaboration guide
```

PR 描述建议写清楚：

```text
本次修改：
- 增加课题列表页面
- 增加搜索框和筛选表单
- 增加空结果提示

已检查：
- 本地服务可以启动
- 页面可以正常访问
- 未发现明显样式错位
```

## 7. 合并前检查

提交 PR 前，建议至少检查：

```bash
python manage.py check
python manage.py migrate
python manage.py runserver
```

如果改了后端 model：

```bash
python manage.py makemigrations
python manage.py migrate
```

如果改了页面：

- 首页能打开。
- 课题列表能打开。
- 课题详情能打开。
- 登录、注册页面能打开。
- 手机端布局没有明显错位。
- 按钮文字没有溢出。

如果改了互动功能：

- 未登录用户不能提交互动。
- 登录用户可以提交。
- 刷新页面后记录还在。
- 管理后台能看到记录。

## 8. 别人的代码合并到 dev 后，自己如何同步

如果当前在自己的功能分支，例如 `feature/project-pages`：

```bash
git switch dev
git pull --ff-only origin dev
git switch feature/project-pages
git rebase dev
```

如果 rebase 没有冲突，继续开发即可。

如果 rebase 后需要推送自己的分支：

```bash
git push --force-with-lease
```

注意：

- `--force-with-lease` 只用于自己的 `feature/...` 分支。
- 不要对 `main` 或 `dev` 使用强制推送。

## 9. 冲突处理

当执行下面命令时可能出现冲突：

```bash
git rebase dev
```

出现冲突后，Git 会提示哪些文件冲突。

查看状态：

```bash
git status
```

打开冲突文件，会看到类似内容：

```text
<<<<<<< HEAD
当前分支内容
=======
dev 分支内容
>>>>>>> dev
```

处理方法：

1. 手动保留正确内容。
2. 删除 `<<<<<<<`、`=======`、`>>>>>>>` 这些冲突标记。
3. 保存文件。
4. 执行：

```bash
git add .
git rebase --continue
```

如果想放弃这次 rebase：

```bash
git rebase --abort
```

## 10. 合并到 main 的流程

当 `dev` 上的功能已经稳定，并且本地检查通过后，再从 GitHub 创建 PR：

```text
base: main
compare: dev
```

也就是：

```text
把 dev 合并到 main
```

合并到 `main` 前建议检查：

- 核心页面能访问。
- 用户能注册、登录、退出。
- 课题关注、评分、参与意向能写入数据库。
- 管理后台能看到数据。
- 数据迁移可以执行。
- 本地服务可以启动。

## 11. 两个人的建议分工

根据项目文档，建议：

钱护磊主要使用：

```text
feature/backend-core
feature/import-topics
feature/backend-interactions
feature/deploy
```

王志主要使用：

```text
feature/project-pages
feature/frontend-interactions
feature/deploy-check
```

如果两个人都要改同一个功能，建议拆成前后端两个分支：

```text
feature/backend-interactions
feature/frontend-interactions
```

这样可以减少冲突。

## 12. 常用命令速查

查看当前分支和状态：

```bash
git status
```

查看所有分支：

```bash
git branch --all
```

切换分支：

```bash
git switch dev
```

创建并切换分支：

```bash
git switch -c feature/task-name
```

拉取远端更新：

```bash
git pull --ff-only origin dev
```

提交：

```bash
git add .
git commit -m "feat: your message"
```

推送：

```bash
git push
```

第一次推送新分支：

```bash
git push -u origin feature/task-name
```

删除本地已合并分支：

```bash
git branch -d feature/task-name
```

删除远端功能分支：

```bash
git push origin --delete feature/task-name
```

## 13. 禁止操作

不要直接在 `main` 上开发：

```bash
git switch main
# 不要在这里直接改代码并提交
```

不要直接在 `dev` 上堆很多个人开发代码：

```bash
git switch dev
# 不建议长期在这里直接写功能
```

不要对公共分支强制推送：

```bash
git push --force origin main
git push --force origin dev
```

不要提交这些文件：

```text
.env
db.sqlite3
*.sqlite3
__pycache__/
*.pyc
.venv/
staticfiles/
media/
*.log
```

不要把密码、Token、密钥提交到 GitHub。

## 14. 推荐 GitHub 设置

建议在 GitHub 仓库设置中开启分支保护：

对 `main`：

- 禁止直接 push。
- 必须通过 Pull Request 合并。
- 至少 1 人 review。
- 合并前要求检查通过。

对 `dev`：

- 建议通过 Pull Request 合并。
- 两人小团队可以先允许灵活处理，但不要长期直接 push。

## 15. 推荐日常节奏

每天开始开发：

```bash
git switch dev
git pull --ff-only origin dev
git switch feature/your-task-name
git rebase dev
```

开发中：

```bash
git status
git add .
git commit -m "feat: clear message"
git push
```

功能完成：

```text
GitHub 创建 PR：feature/your-task-name -> dev
```

`dev` 稳定后：

```text
GitHub 创建 PR：dev -> main
```

## 16. 一句话总结

```text
main 保稳定，dev 做集成，feature 做开发；开发从 dev 拉，完成 PR 回 dev，稳定后再进 main。
```
