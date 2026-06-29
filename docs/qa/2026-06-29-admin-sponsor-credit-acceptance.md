# Admin Collaboration, Sponsor Buttons, and Initial Credits Acceptance Plan

Date: 2026-06-29; final PR refresh: 2026-06-30

## Scope

This acceptance plan verifies four changes:

1. Platform administrators cannot participate in projects through participation, claim, sponsor, or task-result submission flows.
2. Sponsor UI uses two independent buttons: `资助算力` and `资助劳务`.
3. Sponsor modals support type-specific note submission, note updates, withdraw, and approved sponsor UID/WeChat hover.
4. New users receive role-based initial credits.

## Release Preconditions

- `VERSION` and `frontend/package.json` match.
- `CHANGELOG.md` contains a `1.2.0 - 2026-06-30` entry.
- `AGENTS.md` no longer describes the old sponsor main flow as a multi-select popover with “更多资助类型”.
- `AGENTS.md` top product version line says `当前产品版本文件：VERSION = 1.2.0`.
- No schema migration is required for sponsor details because `SponsorIntent.note` is reused.
- Existing user credit balances are not backfilled.
- Existing historical token sponsor records remain readable in personal/admin views, but token is not part of the main project-card/detail sponsor CTA.

## Data Preparation

Prepare fixture data through tests, factories, fixtures, or a temporary local seed script before running browser acceptance:

- Platform administrator: `platform_admin` / `ADM00000001`.
- Normal users:
  - one user with no project relations
  - one user with follow-only and score-only relations
  - one approved compute sponsor
  - one approved labor sponsor
  - one pending sponsor
  - one rejected sponsor
  - one withdrawn sponsor
  - one historical active token sponsor
  - one historical rejected or withdrawn token sponsor
- Registration users for initial-credit checks:
  - doctor
  - `phd_student`
  - `phd_or_above`
  - undergraduate or equivalent student
  - master student
- Projects:
  - one recruiting public project with no sponsor
  - one recruiting public project with approved compute and labor sponsors
  - one non-recruiting project to verify disabled sponsor buttons
  - one in-progress project for task-result submission eligibility checks
- Historical admin-owned collaboration rows:
  - one active admin interest, claim, sponsor, and contribution row, created only as fixture data
  - these rows are used to verify they stay as historical records but do not count as current collaboration state.

## Automated Verification

Run from repository root unless stated otherwise.

```bash
python scripts/check_release_version.py
.venv/bin/python manage.py check
.venv/bin/python manage.py makemigrations --check --dry-run
.venv/bin/python manage.py test accounts api projects interactions credits
cd frontend && node --check src/main.js
cd frontend && node --test src/*.test.js
cd frontend && npm run build
cd frontend && npm run test:e2e
./scripts/qa_full.sh
git diff --check
```

If `.venv/bin/python` is not the active project runtime, use the `conda run -n openmedailab python ...` equivalents from `AGENTS.md` and record that substitution.

## Automated Verification Results

Executed on 2026-06-29 and refreshed on 2026-06-30:

| Check | Result |
| --- | --- |
| `python scripts/check_release_version.py` | Passed, `release version ok: 1.2.0` |
| `.venv/bin/python manage.py check` | Passed |
| `.venv/bin/python manage.py makemigrations --check --dry-run` | Passed, no changes detected |
| `.venv/bin/python manage.py test accounts api projects interactions credits` | Passed, 124 tests |
| `cd frontend && node --check src/main.js` | Passed |
| `cd frontend && node --check e2e/project-core.spec.js` | Passed |
| `cd frontend && node --test src/*.test.js` | Passed, 72 tests |
| `cd frontend && npm run build` | Passed |
| `cd frontend && npm run test:e2e` | Passed, 55 Playwright tests across desktop, tablet, and mobile viewports |
| `./scripts/qa_full.sh` | Passed; includes Django check, migration check, 124 backend tests, 72 frontend tests, production build, 55 Playwright tests, and release version check |
| `git diff --check` | Passed |

Notes:

- Initial Playwright execution exposed an E2E seed reset bug: stale E2E projects whose title had been changed were not removed by `seed_e2e_data --reset`, causing `unique_active_review_claim_slot` conflicts. Regression tests now cover namespaced E2E cleanup and non-E2E topic-id collision safety.
- E2E sponsor flows were updated from the old single `资助`/token main path to the new `资助算力` and `资助劳务` main paths. Historical rejected token rows are verified to show `查看课题` rather than reopening the main sponsor modal.
- During one full QA run, an existing concurrency test failed transiently and then passed when rerun in isolation. A later complete `./scripts/qa_full.sh` run passed end to end.

## Agent Acceptance Results

Three independent agents re-reviewed the completed implementation on 2026-06-29. All reported no remaining blocker.

| Agent Focus | Result | Notes |
| --- | --- | --- |
| Backend/API | Passed | Verified platform-admin claim availability denial, E2E seed reset safety, and sponsor-stage behavior. Extra probe confirmed only active `pending`/`approved` sponsor records can update notes after recruiting ends; new, rejected, and withdrawn sponsor records remain blocked by `project_not_recruiting`. |
| Frontend/UI | Passed | Verified two sponsor buttons, compact type-specific sponsor modal, administrator sponsor buttons rendered disabled with hover reason, sponsor hover rendering, and frontend/backend alignment for managing active sponsor records. |
| Docs/Release | Passed | Verified `VERSION`, `frontend/package.json`, `frontend/package-lock.json`, static asset version query, `CHANGELOG.md`, `AGENTS.md`, and this acceptance document are aligned with `1.2.0`. |

Non-blocking follow-up suggestions:

- Narrow one Playwright selector from `/管理资助|资助/` to explicit compute/labor labels.
- Add an extra backend regression test for `rejected`, `withdrawn`, and new sponsor submissions on non-recruiting projects.
- Consider adding `package-lock.json` to the release checker script.

## Backend Assertions

### Administrator Cannot Collaborate

- Platform admin `POST /api/projects/{id}/interest/` returns stable failure:
  - status `403`
  - code `platform_admin_cannot_collaborate`
  - no `ProjectInterest` row created
  - failed audit exists
- Platform admin `POST /api/projects/{id}/claim/` returns the same stable failure and creates no `ProjectClaimIntent`.
- Platform admin `POST /api/projects/{id}/sponsor/` returns the same stable failure and creates no `SponsorIntent`.
- Platform admin cannot submit task results even if a historical approved relation exists:
  - status `403`
  - code `platform_admin_cannot_collaborate`
  - no `Contribution` row created
  - failed audit exists
- Platform admin can still access admin workspace and approval APIs.
- Platform admin can still approve, reject, and review other users' claim and sponsor applications.
- Platform admin can still follow and like projects if logged in.
- `/api/rbac/` for platform admin reports:
  - `express_interest: false`
  - `claim_work: false`
  - `sponsor_project: false`
  - `manage_projects: true`
  - `review_interactions: true`

### Historical Administrator Rows

- Historical admin-owned active interest, claim, sponsor, and contribution rows are not deleted automatically.
- Historical admin-owned active interest, claim, and sponsor rows do not appear in public/current collaboration counts.
- Historical admin-owned active interest, claim, and sponsor rows do not appear in status-card UID groups.
- Historical admin-owned sponsor rows do not appear in sponsor hover UID cards.
- Historical admin-owned rows do not make admin viewer state look participated, claimed, sponsored, or task-eligible.
- Historical admin-owned rows cannot be used to submit new task results.

### Legacy Views

- `projects/<id>/interest/`, `projects/<id>/claim/`, and `projects/<id>/sponsor/` do not write collaboration rows for platform admin.
- Legacy denial uses a user-facing message and redirects safely.

### Sponsor API Compatibility

- Normal user can create `compute` sponsor intent and receives `pending`.
- Normal user can create `labor_fee` sponsor intent independently.
- If only `compute` is active, `labor_fee` remains available.
- Resubmitting active `compute` updates `note` and keeps current status.
- Resubmitting active `labor_fee` updates `note` and keeps current status.
- Resubmitting rejected or withdrawn sponsor intent reopens it as `pending` and clears review fields.
- Withdrawing pending and approved sponsor intents works.
- Withdrawing rejected or already withdrawn sponsor intents returns stable business error.
- Sponsor approval does not auto-start a project.
- Sponsor-only relation still does not grant task-result submission.
- Follow-only and score-only relations do not grant task-result submission and are not treated as active project participation.
- Historical active token sponsor rows remain readable in personal/admin views.
- Historical active token sponsor rows can be withdrawn from personal center when the existing API allows it.
- Historical rejected or withdrawn token sponsor rows do not expose a main-flow “重新提交资助” action and do not open the compute/labor sponsor modal.

### Status Card UID Groups

- `/api/projects/{id}/status-card/` returns structured sponsor groups:
  - `type: sponsor`
  - `status`
  - `subtype: compute` or `labor_fee`
  - `subtype_label`
  - `uids`
- Approved `compute` sponsor UID appears only in the approved compute group.
- Approved `labor_fee` sponsor UID appears only in the approved labor group.
- Pending, rejected, and withdrawn sponsor UIDs are not treated as “已获资助” hover data.
- Platform-admin sponsor UIDs are not treated as “已获资助” hover data even if historical rows exist.
- Anonymous users do not receive UID groups.

### Initial Credits

For new registrations:

| Role | Expected Balance | Ledger Amount | Ledger Balance |
| --- | ---: | ---: | ---: |
| `doctor` | 250 | 250 | 250 |
| `phd_student` | 200 | 200 | 200 |
| `phd_or_above` | 200 | 200 | 200 |
| `undergrad_or_below` | 100 | 100 | 100 |
| `master_student` | 100 | 100 | 100 |
| `engineer` | 100 | 100 | 100 |

Registration rollback tests still pass when ledger creation or UID generation fails.

## Frontend Static Assertions

- `frontend/src/main.js` contains two project sponsor CTA paths for `compute` and `labor_fee`.
- No project card/detail main-flow markup requires sponsor checkbox multi-select.
- No main-flow sponsor UI text requires `更多资助类型`.
- Generic `管理资助` is replaced by type-specific labels:
  - `管理资助算力`
  - `管理资助劳务`
- Type-specific withdraw copy exists:
  - `撤回资助算力`
  - `撤回资助劳务`
- Sponsor modal has a focused textarea for `资助金额/算力情况`.
- Sponsor modal focus trap remains wired.
- Confirm modal z-index remains higher than sponsor modal.
- Platform admin views keep the same collaboration button layout as other users; sponsor buttons render as disabled rather than hidden.
- Platform admin hover or focus on `资助算力` / `资助劳务` shows `系统管理员不能资助项目`.
- Sponsor hover rows show sponsor UID on top and sponsor WeChat below; they do not expose names, email, or review notes.
- `FAQ_ENTRIES` and visible help text no longer describe token as a main sponsor entry.
- Main-flow copy does not require old wording such as `算力、token 或劳务费`, `更多资助类型`, or generic `管理资助`.

## Browser Acceptance Paths

### 1. Public Visitor

1. Open `#/`.
2. Verify project cards render normally.
3. Verify sponsor buttons appear as `资助算力` and `资助劳务` but submitting requires login.
4. Hover sponsor buttons on an approved-sponsored project.
5. Verify no sensitive UID list is shown to visitor, or a login-safe message is shown.

### 2. Normal User Sponsor Flow

1. Log in as a normal user with no sponsor relations.
2. Open a recruiting project.
3. Click `资助算力`.
4. Verify a compact sponsor modal opens.
5. Fill compute details in `资助金额/算力情况`.
6. Submit.
7. Verify toast confirms sponsor intent.
8. Verify `资助算力` changes to `管理资助算力`.
9. Verify `资助劳务` remains available.
10. Open `资助劳务`, submit labor fee details.
11. Verify both sponsor types appear independently in personal center `我的申请`.

### 3. Manage Existing Sponsor

1. As the same user, open a project where `compute` sponsor is active.
2. Click `管理资助算力`.
3. Verify current status and review note area are visible when present.
4. Update the detail text and submit.
5. Verify status does not reset from approved to pending when previously approved.
6. Reopen and click `撤回资助算力`.
7. Verify confirm dialog appears above the sponsor modal.
8. Confirm withdraw.
9. Verify button returns to `资助算力`.

### 4. Other Logged-In User Hover

1. Log in as another normal user.
2. Open a project with approved compute and labor sponsors.
3. Hover or focus `资助算力`.
4. Verify the floating card matches team/contact hover style.
5. Verify it lists only approved compute sponsors, with UID on top and WeChat below.
6. Hover or focus `资助劳务`.
7. Verify it lists only approved labor sponsors, with UID on top and WeChat below.
8. Verify no username, display name, real name, email, or review note appears.

### 5. Administrator View

1. Log in as `platform_admin`.
2. Open project list and project detail.
3. Verify participation, claim, and sponsor CTAs remain visible in the same layout as normal users.
4. Verify `资助算力` and `资助劳务` are greyed out and hover/focus shows `系统管理员不能资助项目`.
5. Verify clicking the greyed sponsor buttons does not open the sponsor modal.
6. Verify like/follow, admin navigation, project management, and application approval still work.
7. Attempt direct API submission for interest, claim, and sponsor.
8. Verify `platform_admin_cannot_collaborate`.

### 6. Admin Approval

1. Normal user submits compute and labor sponsor intents.
2. Platform admin opens `#/admin` and `申请审批`.
3. Verify sponsor rows are visible and can still be reviewed one item at a time.
4. Approve compute and reject labor with review note.
5. Normal user opens `我的申请`.
6. Verify review status and review comments are visible.

### 7. Historical Token Sponsor Rows

1. Log in as a user with historical token sponsor rows.
2. Open `我的申请`.
3. Verify active token sponsor rows remain visible.
4. Verify active token sponsor rows can be withdrawn if allowed by current API status.
5. Verify rejected or withdrawn token sponsor rows do not show a main-flow resubmit action.
6. Verify clicking historical token rows never opens the compute or labor modal by accident.

### 8. Initial Credit Registration

1. Register a doctor account.
2. Verify displayed balance is 250.
3. Register a `phd_student` account.
4. Verify displayed balance is 200.
5. Register a `phd_or_above` account.
6. Verify displayed balance is 200.
7. Register an undergraduate or master account.
8. Verify displayed balance is 100.
9. Confirm backend ledger entries match these balances.

### 9. Responsive Layout

Check the sponsor buttons and sponsor modal at:

- `1440x1000`
- `768x1000`
- `390x844`
- `360x740`
- `320x740`

Required outcomes:

- Sponsor buttons do not overlap other CTAs.
- Long labels such as `管理资助算力` and `管理资助劳务` fit their buttons.
- Sponsor modal stays inside viewport.
- Confirm dialog stays above sponsor modal.
- Floating sponsor UID/WeChat card stays inside viewport.
- Project title and status rows remain readable.

## Manual Data Checks

Run these checks in Django shell or via tests after implementation:

- No new `SponsorIntent` field was added.
- No sponsor schema migration was generated.
- Existing token sponsor rows still appear in admin/user history.
- Existing users did not receive automatic balance changes.
- Platform admin has no newly created active interest, claim, sponsor, or contribution rows after guard tests.
- Fixture historical admin-owned rows remain in the database but are excluded from current collaboration counts, status-card UID groups, hover cards, viewer-state badges, and task-result eligibility.

## Failure Conditions

The release is not accepted if any of these occur:

- Platform admin can create or update their own interest, claim, sponsor, or contribution records as a collaborator/applicant.
- Platform admin approval or management of other users' applications is blocked by the new guard.
- Historical admin-owned rows count as active participation, claim, sponsor, hover UID data, viewer-state collaboration, or task-result eligibility.
- Admin RBAC still exposes `express_interest`, `claim_work`, or `sponsor_project` as true.
- Sponsor UI still depends on the old multi-select checkbox popover for main card/detail flow.
- FAQ/help/main-flow copy still exposes token as a main sponsor entry or requires old `更多资助类型`/generic `管理资助` wording.
- Approved sponsor update resets status to pending without explicit product approval.
- Hover card exposes names, email, or review notes instead of sponsor UID plus WeChat.
- Follow-only, score-only, or sponsor-only users can submit task results.
- Initial credit ledger does not match the displayed profile balance.
- `VERSION`, `frontend/package.json`, `CHANGELOG.md`, and `/api/meta/` release data disagree.
