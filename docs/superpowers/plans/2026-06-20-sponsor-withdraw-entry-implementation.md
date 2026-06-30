# Sponsor Withdraw Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking completed work.

**Goal:** Make sponsor withdrawal visible and convenient in the sponsor popover while tightening backend sponsor withdraw rules.

**Architecture:** Keep the existing sponsor API and `viewer_state.sponsor_requests` data flow. Add explicit frontend helpers and a current-sponsor section that calls the existing withdraw endpoint per sponsor request; add backend status validation so only active sponsor intents can be withdrawn.

**Tech Stack:** Django Ninja API, Django TestCase, Vue single-file-in-JS app, Node built-in test runner, CSS.

---

### Task 1: Failing Frontend Contract Test

**Files:**
- Modify: `frontend/src/uiPlacement.test.js`
- Test: `frontend/src/uiPlacement.test.js`

- [x] **Step 1: Add assertions that the sponsor popover has a current-sponsor section, explicit per-item withdraw button text, and danger styling.**
- [x] **Step 2: Run `node --test frontend/src/uiPlacement.test.js` and confirm the new assertions fail.**

### Task 2: Failing Backend Status Test

**Files:**
- Modify: `api/tests.py`
- Test: `api/tests.py`

- [x] **Step 1: Add tests for withdrawing pending and approved sponsor intents, and rejecting rejected/withdrawn sponsor intents with `interaction_not_withdrawable`.**
- [x] **Step 2: Run the targeted Django tests and confirm the rejected/withdrawn test fails before implementation.**

### Task 3: Frontend Implementation

**Files:**
- Modify: `frontend/src/main.js`
- Modify: `frontend/src/styles.css`

- [x] **Step 1: Add helpers for current sponsor requests, sponsor status text, disabled state, and per-request withdrawal.**
- [x] **Step 2: Render `当前资助` in the sponsor popover with one row per active sponsor request and a visible `撤回{type}` button.**
- [x] **Step 3: Keep `新增资助类型` checkboxes for adding new sponsor requests; active sponsor checkboxes stay checked and disabled, and withdrawal is only available through the explicit current-sponsor buttons.**
- [x] **Step 4: Add compact current-sponsor row styles with danger action styling and 44px touch targets.**

### Task 4: Backend Implementation

**Files:**
- Modify: `api/ninja_api.py`

- [x] **Step 1: In `me_interaction_withdraw`, reject sponsor intents whose status is not `pending` or `approved`.**
- [x] **Step 2: Write failed audit entries for rejected sponsor withdraw attempts using `interaction_not_withdrawable`.**

### Task 5: Verification

**Files:**
- Test: `frontend/src/*.test.js`
- Test: `api/tests.py`

- [x] **Step 1: Run frontend unit tests.**
- [x] **Step 2: Run targeted backend tests.**
- [x] **Step 3: Run release/version and whitespace checks.**
- [x] **Step 4: Capture a sponsor popover screenshot showing the explicit withdraw entry.**

### Verification Notes

- Frontend tests: `node --test frontend/src/*.test.js` passed.
- Backend sponsor withdraw tests: `.venv/bin/python manage.py test api.tests.ApiTests.test_user_can_withdraw_pending_and_approved_sponsor_intents api.tests.ApiTests.test_user_cannot_withdraw_inactive_sponsor_intents` passed.
- Release/whitespace checks: `python scripts/check_release_version.py` and `git diff --check` passed.
- Screenshot artifact: `artifacts/ui-qa/sponsor-popover-current-withdraw.png` shows the `当前资助` section and `撤回资助劳务费` button.
- Review follow-up: removed the hidden uncheck-and-submit withdrawal path after UI review, made active sponsor checkboxes read-only, focused the explicit withdraw button first, and strengthened the sponsor-withdraw button selector for 44px touch targets.
