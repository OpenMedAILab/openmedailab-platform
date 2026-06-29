# Admin Collaboration, Sponsor Buttons, and Initial Credits Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Update collaboration rules so platform administrators cannot join, claim, sponsor, or submit project results; replace the single sponsor management popover with two type-specific sponsor buttons and modal flows; set role-based initial credits for new registrations.

**Architecture:** Reuse existing `SponsorIntent` rows, `POST /api/projects/{id}/sponsor/`, withdraw API, and status-card UID groups. Add backend permission guards for collaboration writes, adjust RBAC and frontend state so administrator collaboration CTAs remain visible but disabled, and update frontend sponsor state to operate on exactly one sponsor type at a time.

**Tech Stack:** Django, Django Ninja, SQLite/PostgreSQL-compatible ORM patterns, Vue 3 single-file SPA in `frontend/src/main.js`, Node test runner, Playwright.

---

## Review Status

Three independent read-only agents reviewed the current code and this direction:

| Reviewer | Result | Conditions Integrated |
| --- | --- | --- |
| Backend/API | 有条件通过 | Add backend hard guard, update RBAC, use stable error code and failed audit, preserve admin review of other users, handle historical admin rows. |
| Frontend/UI | 有条件通过 | Replace all three sponsor button locations, update sponsor modal helpers, add sponsor UID/WeChat hover rendering, update FAQ copy, handle small screens. |
| QA/Docs/Version | 有条件通过 | Update AGENTS, CHANGELOG, VERSION and `frontend/package.json`, replace old token/multi-select tests, document fixtures and no backfill. |

This plan incorporates those conditions. Execution should not start by editing implementation code until this plan and the companion acceptance plan are accepted.

## Execution Status

Implemented on 2026-06-29 and refreshed for PR on 2026-06-30 on branch `codex/new-features`.

Final verification passed:

- `./scripts/qa_full.sh`
- `git diff --check`

The final full QA run covered Django checks, migration dry-run, 124 backend tests, 72 frontend unit/static tests, production frontend build, 55 Playwright E2E tests, and release version consistency for `1.2.0`.

## Product Decisions

- **Administrator collaboration scope:** Platform administrators cannot act as project collaborators or applicants. They cannot create or update their own `ProjectInterest`, `ProjectClaimIntent`, `SponsorIntent`, or project-level `Contribution` records. This must not block administrators from reviewing, approving, rejecting, moderating, or otherwise managing other users' applications.
- **Historical administrator collaboration rows:** Do not delete historical admin-owned interest, claim, sponsor, or contribution rows automatically. For current product behavior, those rows must not count as active participation, claim, sponsor, project task qualification, status-card UID groups, sponsor hover data, or viewer-state collaboration badges. A separate cleanup command can be considered later if product asks for data removal.
- **Lightweight feedback:** 收藏 and 点赞 remain allowed for administrators and ordinary users. They are not treated as “参与项目” and never grant task-result submission eligibility.
- **Legacy Django views:** Although SPA/API is the product entry, legacy `projects/views.py` relation writers must also block administrator interest, claim, and sponsor submissions so the rule is hard to bypass.
- **Sponsor data model:** No schema migration for sponsor amount or compute details. The modal field labeled “资助金额/算力情况” writes to existing `SponsorIntent.note`.
- **Sponsor types in main UI:** Main project cards and project detail show only `compute` and `labor_fee`. Existing `token` and other sponsor types stay API/admin/history compatible but leave the main card/detail CTA flow.
- **Historical token sponsor behavior:** Historical `token` sponsor rows remain visible in personal/admin history. Active token rows may still be withdrawn through the personal-center row action, but rejected or withdrawn token rows must not show a main-flow “重新提交资助” action and must not open the compute/labor modal.
- **Sponsor status semantics:** Submitting an active pending or approved sponsor type updates `note` and keeps its current status. Resubmitting rejected or withdrawn sponsor types reopens as `pending`, matching current backend behavior.
- **Initial credits:** New registrations only. Doctors start with 250 credits. `phd_student` and `phd_or_above` start with 200 credits. `undergrad_or_below`, `master_student`, `engineer`, `other`, and legacy-normalized student-like roles stay at 100. Existing user balances and historical ledger entries are not backfilled.
- **Version target:** Use `1.2.0` for this work. Product treats administrator collaboration blocking as a compatible 1.x permission-policy update, not a breaking lifecycle reset.

## File Map

| File | Responsibility |
| --- | --- |
| `accounts/models.py` | Add role-based initial credit helper and use it when creating `UserProfile`. |
| `accounts/services.py` | Continue writing register ledger from actual profile balance. No logic change expected beyond tests. |
| `api/rbac.py` | Set admin `express_interest`, `claim_work`, and `sponsor_project` capabilities to `False`; keep management capabilities. |
| `api/ninja_api.py` | Add administrator collaboration guard; apply to interest, claim, sponsor, and contribution submission paths; filter historical admin-owned collaboration rows out of current collaboration state; preserve audit and error structure. |
| `projects/views.py` | Add the same administrator guard for legacy interest, claim, and sponsor form paths. |
| `frontend/src/main.js` | Replace sponsor multi-select popover flow with type-specific buttons and modal state; add admin CTA guard; add sponsor UID/WeChat hover; update FAQ sponsor wording. |
| `frontend/src/styles.css` | Adapt sponsor modal sizing, UID hover content, and responsive CTA grid as needed. |
| `frontend/src/api.js` | No new API expected. Keep using `api.sponsor`, `api.withdrawInteraction`, and `api.projectStatusCard`. |
| `api/tests.py`, `accounts/tests.py` | Add backend permission, RBAC, sponsor semantics, status-card UID, and initial-credit tests. |
| `frontend/src/uiPlacement.test.js`, related frontend tests | Replace old sponsor popover and token main-flow assertions. |
| `frontend/e2e/*.spec.*` | Update browser flows for two sponsor buttons and administrator-disabled collaboration. |
| `AGENTS.md`, `CHANGELOG.md`, `VERSION`, `frontend/package.json` | Update product rules, release notes, and version consistency. |

## Implementation Tasks

### Task 1: Backend Administrator Collaboration Guard

**Files:**
- Modify `api/ninja_api.py`
- Modify `projects/views.py`
- Test `api/tests.py`

- [x] Add a helper in `api/ninja_api.py`, for example `require_non_platform_admin_collaborator(request, action, project)`.
- [x] Import and use `is_platform_admin_user` from `accounts.models`.
- [x] Return stable error payload:
  - HTTP status: `403`
  - code: `platform_admin_cannot_collaborate`
  - message: `系统管理员不能参与、认领或资助课题。`
- [x] Write failed audit through existing `audit_failed_response` with target `Project` and the relevant action.
- [x] Apply the guard after the project is resolved and before form validation in:
  - `interest_project`
  - `claim_project`
  - `sponsor_project`
- [x] Apply an equivalent guard in contribution submission context so historical administrator relations cannot submit task results.
- [x] Ensure the contribution denial also returns `platform_admin_cannot_collaborate`, creates no `Contribution`, and writes failed audit.
- [x] Apply a legacy form guard in `projects/views.py` for `interest_project`, `claim_project`, and `sponsor_project`; show a message and do not write database rows.
- [x] Do not block `follow_project`, `unfollow_project`, `score_project`, or `unscore_project` unless product requirements change.
- [x] Filter historical admin-owned collaboration rows out of current collaboration-derived state:
  - project participation/claim/sponsor counts
  - project status-card UID groups
  - `viewer_state` collaboration badges
  - sponsor hover UID data
  - task-result submission eligibility
- [x] Add tests that platform admin receives `platform_admin_cannot_collaborate` for interest, claim, sponsor, and contribution submission, and that no relation/contribution row is created.
- [x] Add tests that a normal user can still submit interest, claim, and sponsor through existing APIs.
- [x] Add tests that follow-only and score-only users cannot submit task results and are not treated as active project participants.

### Task 2: RBAC and Frontend Collaboration Visibility

**Files:**
- Modify `api/rbac.py`
- Modify `frontend/src/main.js`
- Test `api/tests.py`
- Test `frontend/src/uiPlacement.test.js`

- [x] Set admin capability values for `express_interest`, `claim_work`, and `sponsor_project` to `False` in `ADMIN_PATCH`, overriding authenticated defaults.
- [x] Keep admin management capabilities such as `manage_projects`, `review_interactions`, and `view_admin_console`.
- [x] Add API test for `/api/rbac/` as platform admin:
  - `express_interest` is `false`
  - `claim_work` is `false`
  - `sponsor_project` is `false`
  - `manage_projects` remains `true`
- [x] Add frontend helper `canUseCollaborationCta()` or equivalent using RBAC role/capabilities.
- [x] Keep participation, claim, and sponsor CTAs visible for platform admin in project card, project detail, and favorites views.
- [x] Keep sponsor CTAs greyed out for platform admin and show `系统管理员不能资助项目` on hover/focus.
- [x] Keep like and follow buttons available for admin.
- [x] Ensure disabled admin CTA behavior does not remove the admin workspace navigation or approval flows.

### Task 3: Role-Based Initial Credits

**Files:**
- Modify `accounts/models.py`
- Test `api/tests.py` or `accounts/tests.py`
- Update `AGENTS.md`

- [x] Add `initial_credits_for_role(role_type)` near `RoleType` or `UserProfile` helpers.
- [x] Return:
  - `250` for `RoleType.DOCTOR`
  - `200` for `RoleType.PHD_STUDENT`
  - `200` for `RoleType.PHD_OR_ABOVE`
  - `100` for all other current and legacy-normalized roles
- [x] Use the helper in `create_user_profile` when setting `credit_balance`.
- [x] Keep `accounts/services.create_registered_user()` writing `CreditLedger.amount` and `balance_after` from `user.profile.credit_balance`.
- [x] Add registration tests for doctor, phd student, phd-or-above, undergraduate, master, engineer, and other/default where practical.
- [x] Assert `CreditLedger.ActionType.REGISTER_BONUS` amount and balance equal the returned profile balance.
- [x] Document that existing balances are not backfilled.

### Task 4: Sponsor Modal State Refactor

**Files:**
- Modify `frontend/src/main.js`
- Modify `frontend/src/styles.css`
- Test `frontend/src/uiPlacement.test.js`

- [x] Replace the multi-select `sponsor_types` form model with a type-specific modal state:
  - selected sponsor type: `compute` or `labor_fee`
  - `note`
  - active request for the selected type
  - previous review comment when reopened from rejected history
- [x] Replace `submitSponsor(project, event, options)` with a clearer opener such as `openSponsorModal(project, sponsorType, event, options)`.
- [x] Replace `submitSponsorModal()` logic so it submits exactly one `sponsor_type`.
- [x] For active pending/approved requests, submit should update the existing type's `note` without status reset.
- [x] Keep `withdrawSponsorRequest(project, request)` type-specific and keep explicit confirmation text:
  - `撤回资助算力`
  - `撤回资助劳务费`
- [x] Replace modal copy:
  - eyebrow: `资助算力` or `资助劳务费`
  - field label: `资助金额/算力情况`
  - compute placeholder: `请填写算力资源、额度、周期或可提供方式`
  - labor placeholder: `请填写拟资助金额、周期或支付说明`
- [x] Keep previous review note visible when supplied from rejected application rows.
- [x] Ensure modal is smaller than the project form modal and uses existing modal focus trap.
- [x] Remove old checkbox and “更多资助类型” main-flow UI from project cards/detail.

### Task 5: Two Independent Sponsor Buttons

**Files:**
- Modify `frontend/src/main.js`
- Modify `frontend/src/styles.css`
- Test `frontend/src/uiPlacement.test.js`
- Test browser E2E

- [x] In project card, project detail, and favorites views, replace the single sponsor button with two buttons:
  - `资助算力`
  - `资助劳务`
- [x] If the current user has an active request of that type, show:
  - `管理资助算力`
  - `管理资助劳务`
- [x] If a project is not recruiting and the user has no active request for that type, disable with type-specific text such as `暂不资助算力` and `暂不资助劳务`.
- [x] Button active state is per type, not global sponsor presence.
- [x] One active type must not make the other type appear managed.
- [x] Use existing `api.sponsor(project.id, { sponsor_type, note })`.
- [x] Use existing `api.withdrawInteraction("sponsor", id, payload)`.
- [x] Refresh local project state through `refreshProjectStatus(project)` and existing viewer-state sync helpers.
- [x] Update my-application retry path so rejected `compute` or `labor_fee` opens the type-specific modal.
- [x] For historical `token` sponsor rows in personal center, keep row visibility and withdraw capability for active rows, but do not provide a main-card submit button or a rejected/withdrawn token resubmit path.

### Task 6: Sponsor UID Hover

**Files:**
- Modify `frontend/src/main.js`
- Modify `frontend/src/styles.css` only if needed
- Test `frontend/src/uiPlacement.test.js`
- Test browser E2E

- [x] Reuse contact hover positioning and `.contact-hover-card` styling.
- [x] Extend contact hover rendering so sponsor rows show UID on top and sponsor WeChat below.
- [x] Add `showSponsorContactCard(event, project, sponsorType)` or equivalent.
- [x] On hover/focus of each sponsor button:
  - if not logged in, show no UID list or a generic login-safe message
  - if logged in, fetch or reuse `api.projectStatusCard(project.id)`
  - filter `uid_groups.groups` by `type === "sponsor"`, `status === "approved"`, and `subtype === sponsorType`
  - display approved sponsor UID and WeChat only
- [x] Do not display usernames, display names, real names, email, or review notes in sponsor hover cards.
- [x] Cache fetched status-card sponsor UID groups enough to avoid repeated requests during the same hover session.
- [x] Invalidate the cache after sponsor submit, withdraw, or admin approval state refresh.

### Task 7: Backend Sponsor Compatibility Tests

**Files:**
- Modify `api/tests.py`

- [x] Preserve existing tests that approved sponsor count only counts approved records.
- [x] Preserve tests that pending and approved sponsor intents can be withdrawn.
- [x] Preserve tests that inactive sponsor intents cannot be withdrawn.
- [x] Add or update tests proving:
  - submitting an active approved sponsor type updates `note` and keeps status `approved`
  - submitting an active pending sponsor type updates `note` and keeps status `pending`
  - resubmitting rejected or withdrawn sponsor type becomes `pending`
  - `status-card.uid_groups.groups` exposes approved compute and labor sponsor UIDs and WeChat separately by `subtype`
  - pending/rejected/withdrawn sponsor UIDs are not used by frontend acceptance for “已获资助” hover

### Task 8: Frontend Tests and E2E Updates

**Files:**
- Modify `frontend/src/uiPlacement.test.js`
- Modify other `frontend/src/*.test.js` if they assert sponsor UI strings
- Modify `frontend/e2e/*.spec.*`

- [x] Remove assertions requiring:
  - `v-model="state.forms.sponsor.sponsor_types"`
  - sponsor checkbox rows
  - “更多资助类型”
  - token sponsor main-flow entry
  - generic `管理资助`
- [x] Add assertions requiring:
  - two type-specific sponsor buttons in all card/detail surfaces
  - `openSponsorModal(project, "compute", ...)` and `openSponsorModal(project, "labor_fee", ...)` or equivalent
  - type-specific labels `管理资助算力` and `管理资助劳务`
  - type-specific withdraw copy
  - sponsor UID/WeChat hover function and rendering
  - admin collaboration CTA guard
- [x] Update `FAQ_ENTRIES` and any help copy so token is not described as a main sponsor entry and old copy like `算力、token 或劳务费`, `更多资助类型`, or generic `管理资助` is not required in the main flow.
- [x] Update Playwright flows to use the compute and labor buttons separately.
- [x] Add small-screen checks for `390x844`, `360x740`, and `320x740`.
- [x] Ensure confirm modal remains above sponsor modal for withdraw confirmation.

### Task 9: Documentation and Release Metadata

**Files:**
- Modify `AGENTS.md`
- Modify `CHANGELOG.md`
- Modify `VERSION`
- Modify `frontend/package.json`
- Test release checks

- [x] Update `AGENTS.md` sections:
  - top product version line: `当前产品版本文件：VERSION = 1.2.0`
  - 2.1 user initial credits
  - 2.4 sponsor button product rules
  - 2.5 credit lifecycle
  - 3.1 role table
  - 3.2 ordinary user lifecycle credit line
  - 3.4 relation lifecycle
  - 4.4 interaction API note
  - 5.1 user profile model credit note
  - 6.4 UI feedback if needed
  - 9 acceptance assertions
- [x] Remove or rewrite old rules saying sponsor main entry is a multi-select popover with token progressive entry.
- [x] Add CHANGELOG entry for `1.2.0` dated `2026-06-29`.
- [x] Update `VERSION` to `1.2.0`.
- [x] Update `frontend/package.json` version to `1.2.0`.
- [x] Run `python scripts/check_release_version.py`.

## Required Verification

Run the commands from the acceptance plan. At minimum:

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
```

If the local environment uses `conda run -n openmedailab` instead of `.venv/bin/python`, use the AGENTS.md command matrix equivalent and record the substitution in the final implementation notes.

## Out of Scope

- No new sponsor payment integration.
- No structured numeric amount field or compute-resource table.
- No new sponsor API endpoint.
- No automatic backfill of existing user credit balances.
- No automatic cleanup of historical administrator collaboration rows unless product explicitly requests a data cleanup pass.
- No restoration of old task assignment or admin participation approval flows.
