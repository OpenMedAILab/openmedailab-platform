# Project Card Title Code and Overfill Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update project card UI so card titles show the project code prefix and overfilled team chips keep color only without showing the word `超额`.

**Architecture:** This is a front-end presentation-only change. Keep backend counts and `overfilled` status intact, change only Vue display bindings and tests; update documentation/version because the visible product rule changes.

**Tech Stack:** Vue template in `frontend/src/main.js`, CSS in `frontend/src/styles.css`, Node static tests, Playwright E2E, Django E2E fixture seed.

---

### Task 1: Add Tests for New Card Copy

**Files:**
- Modify: `frontend/src/uiPlacement.test.js`
- Modify: `frontend/e2e/project-core.spec.js`
- Modify: `api/management/commands/seed_e2e_data.py`

- [ ] **Step 1: Write failing static tests**

In `frontend/src/uiPlacement.test.js`, replace the existing assertion that expects `· 超额` with an assertion that the source no longer contains `超额`, and add assertions that project card titles use `projectCardTitle(project)`.

- [ ] **Step 2: Write failing browser test**

In `frontend/e2e/project-core.spec.js`, assert the relation-card title text equals `T9902: E2E_PUBLIC_WITH_RELATIONS 本人关系课题`, and that an overfilled role chip shows `2/1` without the word `超额`.

- [ ] **Step 3: Seed an overfilled visible role**

In `api/management/commands/seed_e2e_data.py`, add one extra approved student participant to the `with_relations` E2E project so the browser test exercises overfilled styling.

- [ ] **Step 4: Run red tests**

Run:

```bash
cd frontend && node --test src/uiPlacement.test.js
cd frontend && npm run test:e2e -- --project desktop-1440 --grep "relationship badge"
```

Expected: tests fail because the implementation still renders plain titles and `· 超额`.

### Task 2: Implement Minimal UI Change

**Files:**
- Modify: `frontend/src/main.js`

- [ ] **Step 1: Add title formatter**

Add:

```js
function projectCardTitle(project) {
  const title = String(project?.title || "未命名课题").trim() || "未命名课题";
  return `${topicCode(project)}: ${title}`;
}
```

- [ ] **Step 2: Use formatter on project cards**

Change public project cards and favorite project cards from `{{ project.title }}` to `{{ projectCardTitle(project) }}`.

- [ ] **Step 3: Remove visible overfill text**

Change both role-chip templates from:

```vue
{{ role.label }} {{ role.count }}/{{ role.required }}{{ role.overfilled ? ' · 超额' : '' }}
```

to:

```vue
{{ role.label }} {{ role.count }}/{{ role.required }}
```

Keep `:class="{ ready: role.ready, overfilled: role.overfilled }"` unchanged so color still differs.

### Task 3: Sync Product Rule and Version

**Files:**
- Modify: `AGENTS.md`
- Modify: `VERSION`
- Modify: `CHANGELOG.md`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/index.html`

- [ ] **Step 1: Update product rule**

Replace the rule requiring `2/1 · 超额` with a rule requiring `2/1` plus semantic color only.

- [ ] **Step 2: Bump patch version**

Update release metadata from `0.15.0` to `0.15.1` because this is a user-visible UI copy change.

### Task 4: Verify

**Files:**
- Test-only

- [ ] **Step 1: Run targeted static tests**

Run:

```bash
cd frontend && node --test src/uiPlacement.test.js
```

Expected: all tests pass.

- [ ] **Step 2: Run targeted browser tests**

Run:

```bash
cd frontend && npm run test:e2e -- --project desktop-1440 --grep "relationship badge|home page"
```

Expected: all selected browser tests pass and title text is verified on a real rendered card.

- [ ] **Step 3: Run build and release checks**

Run:

```bash
cd frontend && npm run build
.venv/bin/python scripts/check_release_version.py
git diff --check
```

Expected: all commands exit 0.
