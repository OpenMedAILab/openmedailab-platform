# Sponsor Withdraw Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking completed work.

**Goal:** Make sponsor withdrawal visible and convenient through two independent card/detail buttons, while tightening backend sponsor withdraw rules.

**Architecture:** Keep the existing sponsor API and `viewer_state.sponsor_requests` data flow. Add explicit frontend helpers keyed by `sponsor_type`; `资助劳务费` and `资助算力` each submit or withdraw only their own sponsor request. Add backend status validation so only active sponsor intents can be withdrawn.

**Tech Stack:** Django Ninja API, Django TestCase, Vue single-file-in-JS app, Node built-in test runner, CSS.

---

### Task 1: Failing Frontend Contract Test

**Files:**
- Modify: `frontend/src/uiPlacement.test.js`
- Test: `frontend/src/uiPlacement.test.js`

- [x] **Step 1: Add assertions that the card/detail action area exposes `资助劳务费` and `资助算力` as independent buttons with per-type withdraw text.**
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

- [x] **Step 1: Add helpers for per-type sponsor requests, disabled state, and per-type withdrawal.**
- [x] **Step 2: Render two sibling sponsor buttons in project cards, progress pages, and favorite cards.**
- [x] **Step 3: Remove sponsor popover, sponsor checkbox state, and implicit uncheck-and-submit withdrawal.**
- [x] **Step 4: Keep sponsor buttons on the normal interaction-button style system with compact 44px+ touch targets.**

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
- [x] **Step 4: Capture a browser screenshot showing the two sponsor buttons as sibling interaction actions.**

### Verification Notes

- Frontend tests: `node --test frontend/src/*.test.js` passed.
- Backend sponsor withdraw tests: `.venv/bin/python manage.py test api.tests.ApiTests.test_user_can_withdraw_pending_and_approved_sponsor_intents api.tests.ApiTests.test_user_cannot_withdraw_inactive_sponsor_intents` passed.
- Release/whitespace checks: `python scripts/check_release_version.py` and `git diff --check` passed.
- Screenshot artifact: `artifacts/ui-qa/sponsor-independent-buttons.png` shows `资助劳务费` and `资助算力` as sibling interaction buttons. Per-type withdraw confirmation is covered by source-level UI tests and the existing sponsor withdraw backend tests.
- Review follow-up: removed the hidden uncheck-and-submit withdrawal path and then removed the sponsor popover entirely after UI review; each sponsor button now owns its own submit/withdraw flow.
