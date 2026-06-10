import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainSource = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("./api.js", import.meta.url), "utf8");

test("project modal uses an in-modal toast instead of the global page toast", () => {
  assert.match(mainSource, /<div v-if="state\.toast && !state\.preview\.open" class="toast">/);
  assert.match(mainSource, /<div v-if="state\.toast" class="toast modal-toast">/);
  assert.match(stylesSource, /\.project-modal\s*\{[^}]*position:\s*relative;/s);
  assert.match(stylesSource, /\.modal-toast\s*\{[^}]*position:\s*absolute;/s);
});

test("theme space navigation closes an open project preview modal", () => {
  assert.match(
    mainSource,
    /function selectSpace\(slug\)\s*\{\s*if \(state\.preview\.open\) \{\s*state\.preview\.open = false;\s*state\.preview\.maximized = false;\s*\}\s*navigate\("space", \{ slug \}\);/s
  );
});

test("route changes close workspace and admin modal overlays", () => {
  assert.match(mainSource, /function closeRouteScopedOverlays\(\)/);
  assert.match(mainSource, /closeRouteScopedOverlays\(\);\s*state\.heroTitleScrollProgress = 0;/);
  assert.match(mainSource, /if \(state\.contributionModal\.open\)\s*\{\s*closeContributionModal\(\);/s);
  assert.match(mainSource, /if \(state\.admin\.taskProjectDetail\.open\)\s*\{\s*closeTaskProjectDetail\(\);/s);
  assert.match(mainSource, /if \(state\.admin\.projectFormOpen\)\s*\{\s*closeProjectForm\(\);/s);
  assert.match(mainSource, /if \(state\.confirmDialog\.open\)\s*\{\s*resolveConfirmDialog\(false\);/s);
});

test("profile menu action clicks blur the focused button after closing", () => {
  const blurCalls = mainSource.match(/\$event\.currentTarget\.blur\(\)/g) || [];
  assert.equal(blurCalls.length, 4);
});

test("topbar wraps into centered rows before it overflows", () => {
  assert.match(stylesSource, /\.topbar\s*\{[\s\S]*?width:\s*min\(1440px,\s*calc\(100% - 32px\)\);/);
  assert.match(stylesSource, /@media \(max-width:\s*1040px\)\s*\{[\s\S]*?\.topbar\s*\{[\s\S]*?grid-template-columns:\s*1fr;[\s\S]*?justify-items:\s*center;/);
  assert.match(stylesSource, /@media \(max-width:\s*1040px\)\s*\{[\s\S]*?\.main-nav,\s*\.account-area\s*\{[\s\S]*?justify-content:\s*center;[\s\S]*?flex-wrap:\s*wrap;/);
  assert.doesNotMatch(stylesSource, /@media \(max-width:\s*1480px\)/);
  assert.doesNotMatch(stylesSource, /@media \(max-width:\s*980px\)\s*\{[\s\S]*?\.main-nav,\s*\.account-area\s*\{[\s\S]*?overflow-x:\s*auto;/);
});

test("topbar account actions are consolidated into the profile menu", () => {
  assert.doesNotMatch(mainSource, /<span class="role-pill">/);
  assert.doesNotMatch(mainSource, /<button v-if="state\.user" class="ghost-button" type="button" @click="logout">/);
  assert.match(mainSource, /class="ghost-button danger profile-logout"/);
  assert.match(mainSource, /@click="logout\(\); closeProfileMenu\(\); \$event\.currentTarget\.blur\(\)"/);
});

test("project modal and detail header have small-screen overflow guards", () => {
  assert.match(stylesSource, /\.project-modal\s*\{[\s\S]*?width:\s*min\(1120px,\s*calc\(100vw - 32px\)\);/);
  assert.match(stylesSource, /\.project-modal-header h2\s*\{[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(stylesSource, /\.detail-header h1[\s\S]*?\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.project-modal-backdrop\s*\{[\s\S]*?padding:\s*8px;/);
});

test("small-screen tab and chip rows wrap instead of hiding content horizontally", () => {
  assert.match(stylesSource, /\.admin-tabs\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?overflow:\s*visible;/);
  assert.match(stylesSource, /\.admin-tabs button\s*\{[\s\S]*?flex:\s*0 1 auto;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.theme-strip,\s*\.admin-tabs\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?overflow:\s*visible;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.theme-chip,\s*\.admin-tabs button\s*\{[\s\S]*?flex:\s*0 1 auto;/);
});

test("homepage hero title uses minimal copy with hover and scroll motion guards", () => {
  assert.match(mainSource, /大道无言/);
  assert.doesNotMatch(mainSource, /让医学问题，/);
  assert.doesNotMatch(mainSource, /等到它的盖世英雄/);
  assert.doesNotMatch(mainSource, /真实临床场景，开放协作验证/);
  assert.match(mainSource, /const heroTitleStyle = computed/);
  assert.match(mainSource, /function updateHeroTitleScrollProgress\(\)/);
  assert.match(mainSource, /"--hero-title-opacity": \(1 - progress \* 0\.72\)\.toFixed\(3\)/);
  assert.match(stylesSource, /\.library-hero \.hero-title\s*\{[\s\S]*?display:\s*block;/);
  assert.match(stylesSource, /\.library-hero \.hero-title:hover\s*\{[\s\S]*?scale\(1\.022\)/);
  assert.match(stylesSource, /\.library-hero \.hero-title\s*\{[\s\S]*?mask-image:\s*linear-gradient/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.library-hero \.hero-title\s*\{[\s\S]*?transition:\s*none;/);
});

test("modal overlays lock the page scroll behind dialogs", () => {
  assert.match(mainSource, /const modalOpen = computed/);
  assert.match(mainSource, /document\.body\.classList\.toggle\("modal-open", open\)/);
  assert.match(stylesSource, /body\.modal-open\s*\{[\s\S]*?overflow:\s*hidden;/);
});

test("admin file space management exposes a file-manager workflow", () => {
  assert.match(mainSource, /文件空间管理/);
  assert.match(mainSource, /state\.admin\.fileManager/);
  assert.match(mainSource, /handleFileSpaceUpload/);
  assert.match(mainSource, /webkitdirectory directory multiple/);
  assert.match(stylesSource, /\.file-manager-layout\s*\{/);
  assert.match(apiSource, /adminFileSpace/);
  assert.match(apiSource, /adminUploadFileSpaceFiles/);
});

test("homepage search toolbar is lifted and visually emphasized", () => {
  assert.match(stylesSource, /\.toolbar\s*\{[\s\S]*?margin:\s*-4px 0 22px;[\s\S]*?padding:\s*16px;[\s\S]*?border-radius:\s*12px;/);
  assert.match(stylesSource, /\.toolbar input,\s*\.toolbar select\s*\{[\s\S]*?min-height:\s*46px;[\s\S]*?border-radius:\s*10px;/);
  assert.match(stylesSource, /\.toolbar \.primary-button\s*\{[\s\S]*?min-height:\s*58px;[\s\S]*?border-radius:\s*10px;/);
});

test("workspace lifecycle UI exposes user/admin spaces and project status hover card", () => {
  assert.match(mainSource, /label:\s*"我的空间"/);
  assert.match(mainSource, /workspace-tabs/);
  assert.match(mainSource, />我的任务<\/button>/);
  assert.doesNotMatch(mainSource, />我的申请<\/button>/);
  assert.doesNotMatch(mainSource, />我的任务结果<\/button>/);
  assert.doesNotMatch(mainSource, />我的贡献<\/button>/);
  assert.doesNotMatch(mainSource, />积分流水<\/button>/);
  assert.match(mainSource, /state\.admin\.activeTab === 'overview'/);
  assert.match(mainSource, /state\.admin\.activeTab === 'interactions'/);
  assert.match(mainSource, /state\.admin\.activeTab === 'contributions'/);
  assert.match(mainSource, /state\.admin\.activeTab === 'audit'/);
  assert.doesNotMatch(mainSource, /state\.admin\.activeTab === 'tasks'/);
  assert.doesNotMatch(mainSource, /state\.admin\.activeTab === 'credits'/);
  assert.match(mainSource, /project-status-popover/);
  assert.match(mainSource, /openProjectStatusCard\(project\)/);
  assert.match(stylesSource, /\.project-status-popover\s*\{/);
  assert.match(stylesSource, /\.workspace-tabs\s*\{/);
});

test("project status hover card separates personal labels from highlighted status uids", () => {
  assert.match(mainSource, /我的状态/);
  assert.match(mainSource, /viewerStatusLabelsFor\(project\)/);
  assert.match(mainSource, /projectStageLabelFor\(project\)/);
  assert.match(mainSource, /statusUidGroupsFor\(project\)/);
  assert.match(mainSource, /visibleGroupUids\(group\)/);
  assert.match(mainSource, /hiddenGroupUidCount\(group\)/);
  assert.match(mainSource, /statusHighlightUidFor\(project\)/);
  assert.doesNotMatch(mainSource, /<strong>\{\{ viewerUidFor\(project\)/);
  assert.doesNotMatch(mainSource, /已收藏' : '未收藏'/);
  assert.doesNotMatch(mainSource, /课题状态 · 参与者/);
  assert.doesNotMatch(mainSource, /相关 UID/);
  assert.doesNotMatch(mainSource, /UID \{\{ statusUidCountFor\(project\) \}\} 个/);
  assert.match(stylesSource, /\.viewer-status-block\s*\{/);
  assert.match(stylesSource, /\.status-uid-group--follow\s*\{/);
  assert.match(stylesSource, /\.status-uid-group--interest,/);
  assert.match(stylesSource, /\.uid-strip span\.uid-more\s*\{/);
  assert.match(stylesSource, /\.uid-strip span\.highlighted\s*\{/);
  assert.doesNotMatch(stylesSource, /\.status-uid-group--task\s*\{/);
  assert.doesNotMatch(stylesSource, /\.status-uid-group--contribution\s*\{/);
});

test("project status hover card stays inside the project card instead of being clipped", () => {
  assert.match(stylesSource, /\.project-card\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.doesNotMatch(stylesSource, /\.project-status-popover\s*\{[\s\S]*?top:\s*calc\(100% - 8px\);/);
  assert.match(stylesSource, /\.project-status-popover\s*\{[\s\S]*?top:\s*18px;/);
  assert.match(stylesSource, /\.project-status-popover\s*\{[\s\S]*?max-height:\s*min\(320px,\s*calc\(100% - 36px\)\);/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.project-status-popover\s*\{[\s\S]*?top:\s*128px;/);
});

test("audit log table uses readable summaries instead of raw json", () => {
  assert.match(mainSource, /auditSummary\(entry\)/);
  assert.match(mainSource, /auditActionLabel\(entry\)/);
  assert.match(mainSource, /audit-table-row/);
  assert.doesNotMatch(mainSource, /shortText\(JSON\.stringify\(entry\.after \|\| \{\}\), 80\)/);
  assert.match(stylesSource, /\.audit-table \.audit-table-row\s*\{/);
});

test("admin overview cards are navigable and have hover affordance", () => {
  assert.match(mainSource, /adminOverviewCards/);
  assert.match(mainSource, /v-for="card in adminOverviewCards"/);
  assert.match(mainSource, /setAdminTab\(card\.tab\)/);
  assert.match(stylesSource, /\.admin-overview-card:hover\s*\{[\s\S]*?scale\(1\.02\)/);
});

test("admin task approval keeps only interaction review in the approval panel", () => {
  assert.match(mainSource, />任务审批<\/button>/);
  assert.doesNotMatch(mainSource, />协作管理<\/button>/);
  assert.doesNotMatch(mainSource, />协作审核<\/button>/);
  assert.doesNotMatch(mainSource, /组队看板/);
  assert.doesNotMatch(mainSource, /已审核项目状态/);
  assert.match(mainSource, />任务管理<\/button>/);
  assert.doesNotMatch(mainSource, /prepareTaskForProject\(group\.project\)/);
  assert.doesNotMatch(mainSource, /reviewInteraction\(item,\s*'recorded'\)/);
  assert.match(stylesSource, /\.collaboration-management\s*\{/);
  assert.match(stylesSource, /\.collaboration-grid\.single-column\s*\{/);
});

test("project lifecycle actions are gated by project stage and review status", () => {
  assert.match(mainSource, /const FOLLOWABLE_STAGE_VALUES = new Set\(\["open_recruiting", "team_building", "active"\]\)/);
  assert.match(mainSource, /const RECRUITING_STAGE_VALUES = new Set\(\["open_recruiting", "team_building"\]\)/);
  assert.match(mainSource, /v-if="shouldShowFollowButton\(project\)"/);
  assert.match(mainSource, /v-if="shouldShowFollowButton\(state\.currentProject\)"/);
  assert.match(mainSource, /v-if="canRecruitProject\(state\.currentProject\)"/);
  assert.match(mainSource, /当前阶段不接受新的参与、认领或资助意向/);
  assert.match(mainSource, /v-if="canReviewInteraction\(item\)"/);
  assert.match(mainSource, /Only pending interactions can be reviewed|只有待处理申请可以审核/);
});

test("task management reuses existing project patch flows for stage changes", () => {
  assert.match(mainSource, /updateTaskProjectStage\(state\.admin\.taskProjectDetail\.project,\s*'active'\)/);
  assert.match(mainSource, /updateTaskProjectStage\(state\.admin\.taskProjectDetail\.project,\s*'paused'\)/);
  assert.match(mainSource, /updateTaskProjectStage\(state\.admin\.taskProjectDetail\.project,\s*'archived'\)/);
  assert.match(mainSource, /const payload = \{ stage \};[\s\S]*?if \(stage === "archived"\) \{[\s\S]*?payload\.is_public = false;/);
  assert.match(mainSource, /api\.adminUpdateProject\(project\.id,\s*payload\)/);
  assert.doesNotMatch(mainSource, /is_public:\s*stage !== "archived"/);
  assert.match(mainSource, /api\.adminUpdateProject\(contribution\.project\.id,\s*\{ stage:\s*"archived",\s*is_public:\s*false \}\)/);
  assert.doesNotMatch(apiSource, /\b(publishProject|startProject|pauseProject|archiveProject)\b/);
});

test("project status card refreshes on hover and invalidates after lifecycle writes", () => {
  assert.match(mainSource, /const hasCachedCard = Boolean\(state\.projectStatusCards\[project\.id\]\)/);
  assert.doesNotMatch(mainSource, /if \(state\.projectStatusCards\[project\.id\]\) return;/);
  assert.match(mainSource, /state\.projectStatusCards\[project\.id\] = await api\.projectStatusCard\(project\.id\)/);
  assert.match(mainSource, /showToast\(error\.message \|\| "课题状态读取失败"\)/);
  assert.doesNotMatch(mainSource, /uid_groups:\s*\{\s*uids_visible:\s*false,\s*groups:\s*\[\]\s*\}/);
  assert.match(mainSource, /function invalidateProjectStatusCard\(projectOrId = null\)/);
  assert.match(mainSource, /invalidateProjectStatusCard\(projectId\)/);
  assert.match(mainSource, /invalidateProjectStatusCard\(item\.project\?\.id\)/);
  assert.match(mainSource, /invalidateProjectStatusCard\(project\.id\)/);
});

test("task result review hides legacy task reward and revision actions", () => {
  assert.match(mainSource, />任务管理<\/button>/);
  assert.match(mainSource, /<h2>任务管理<\/h2>/);
  assert.match(mainSource, /reviewContribution\(item,\s*'approved'\)/);
  assert.match(mainSource, /reviewContribution\(item,\s*'rejected'\)/);
  assert.doesNotMatch(mainSource, /通过并奖励/);
  assert.doesNotMatch(mainSource, /reviewContribution\(item,\s*'needs_revision'/);
  assert.doesNotMatch(mainSource, />需修改<\/button>/);
});

test("workspace lifecycle people fields render uid-only payloads", () => {
  assert.match(mainSource, /item\.user\.uid/);
  assert.match(mainSource, /entry\?\.actor\?\.uid/);
  assert.doesNotMatch(mainSource, /item\.user\.profile\?\.uid/);
  assert.doesNotMatch(mainSource, /entry\.user\.profile\?\.uid/);
  assert.doesNotMatch(mainSource, /entry\?\.actor\?\.profile\?\.uid/);
});

test("admin project lifecycle removes json import and exposes markdown template import", () => {
  assert.doesNotMatch(mainSource, />JSON 导入<\/button>/);
  assert.doesNotMatch(mainSource, /importJson\(/);
  assert.doesNotMatch(mainSource, /useExampleJson/);
  assert.doesNotMatch(mainSource, /state\.admin\.importText/);
  assert.match(mainSource, /Markdown 导入/);
  assert.match(mainSource, /copyMarkdownTemplate/);
  assert.match(mainSource, /handleMarkdownFiles/);
  assert.match(mainSource, /clearMarkdownImport/);
  assert.match(mainSource, /state\.schema\.markdown_template/);
  assert.match(mainSource, /字段契约与 Markdown 模板/);
  assert.match(mainSource, /refreshMarkdownImportRow/);
  assert.match(mainSource, /重新检测/);
  assert.match(mainSource, /清除导入提示/);
  assert.match(mainSource, /inline-row-field/);
});

test("admin project form uses structured project inputs instead of json textareas for core fields", () => {
  assert.doesNotMatch(mainSource, /数据需求 JSON/);
  assert.doesNotMatch(mainSource, /评价指标 JSON/);
  assert.doesNotMatch(mainSource, /预期成果 JSON/);
  assert.doesNotMatch(mainSource, /文件列表 JSON/);
  assert.doesNotMatch(mainSource, /评分维度 JSON/);
  assert.match(mainSource, /数据类型/);
  assert.match(mainSource, /最小样本量/);
  assert.match(mainSource, /评价指标（每行一条）/);
  assert.match(mainSource, /预期成果（每行一条）/);
  assert.doesNotMatch(mainSource, /文件列表（类型\\|标题\\|路径，每行一条）/);
  assert.doesNotMatch(mainSource, /Markdown 路径/);
  assert.doesNotMatch(mainSource, /正文 Markdown/);
  assert.match(mainSource, /评分维度（维度\\|分数，每行一条）/);
});

test("admin project form is opened in a modal instead of occupying the normal project list view", () => {
  assert.match(mainSource, /projectFormOpen:\s*false/);
  assert.match(mainSource, /state\.admin\.projectFormOpen\s*=\s*true/);
  assert.match(mainSource, /closeProjectForm/);
  assert.match(mainSource, /project-form-modal/);
  assert.match(mainSource, /role="dialog"/);
  assert.doesNotMatch(mainSource, /id="admin-project-form"/);
});

test("admin project score dimensions use line based structured input instead of hand written json", () => {
  assert.match(mainSource, /formatScoreDimensionLines/);
  assert.match(mainSource, /scoreDimensionsPayload/);
  assert.doesNotMatch(mainSource, /parseJsonStrict\(form\.score_dimensions,\s*"评分维度"/);
  assert.doesNotMatch(mainSource, /score_dimensions:\s*parseJsonOrFallback\(form\.score_dimensions/);
});

test("admin project list loads projects in batches of 25", () => {
  assert.match(mainSource, /projectFilters:\s*\{ q:\s*"", theme:\s*"", page:\s*1, page_size:\s*25 \}/);
});

test("admin project list changes stages through the existing project patch api", () => {
  assert.match(mainSource, /updatingProjectStageId:\s*null/);
  assert.match(mainSource, /class="admin-stage-select"/);
  assert.match(mainSource, /@change="updateAdminProjectStage\(project,\s*\$event\.target\.value,\s*\$event\)"/);
  assert.match(mainSource, /function updateAdminProjectStage\(project,\s*stage,\s*event = null\)/);
  assert.match(mainSource, /api\.adminUpdateProject\(project\.id,\s*payload\)/);
  assert.match(mainSource, /payload\.is_public = false/);
  assert.match(mainSource, /adminProjectVisibilityLabel\(project\)/);
  assert.match(stylesSource, /\.admin-stage-select\s*\{/);
  assert.doesNotMatch(apiSource, /\b(updateProjectStage|setProjectStage|publishProject|startProject|pauseProject|archiveProject)\b/);
});

test("workspace overview uses the same clickable card affordance as admin overview", () => {
  assert.match(mainSource, /const workspaceOverviewCards = computed/);
  assert.match(mainSource, /v-for="card in workspaceOverviewCards"/);
  assert.match(mainSource, /class="content-panel admin-overview-card workspace-overview-card"/);
  assert.match(mainSource, /@click="setWorkspaceTab\(card\.tab\)"/);
  assert.match(stylesSource, /\.workspace-overview-card\s*\{/);
  assert.match(stylesSource, /\.admin-overview-card:hover\s*\{[\s\S]*?scale\(1\.02\)/);
});

test("business modals use an explicit z-index scale and close competing overlays", () => {
  assert.match(mainSource, /function closeMutuallyExclusiveModals\(next = ""\)/);
  assert.match(mainSource, /closeMutuallyExclusiveModals\("contribution"\)/);
  assert.match(mainSource, /closeMutuallyExclusiveModals\("taskProjectDetail"\)/);
  assert.match(mainSource, /closeMutuallyExclusiveModals\("projectForm"\)/);
  assert.match(stylesSource, /\.toast\s*\{[\s\S]*?z-index:\s*120;/);
  assert.match(stylesSource, /\.project-modal-backdrop\s*\{[\s\S]*?z-index:\s*200;/);
  assert.match(stylesSource, /\.project-form-modal\s*\{[\s\S]*?z-index:\s*300;/);
  assert.match(stylesSource, /\.task-result-modal,\s*\.task-detail-modal\s*\{[\s\S]*?z-index:\s*320;/);
  assert.match(stylesSource, /\.confirm-modal-backdrop\s*\{[\s\S]*?z-index:\s*400;/);
});

test("legacy approved-project handoff helpers are not returned as product entry points", () => {
  assert.doesNotMatch(mainSource, /const approvedInteractionGroups = computed/);
  assert.doesNotMatch(mainSource, /function loadApprovedInteractions\(/);
  assert.doesNotMatch(mainSource, /function updateApprovedProjectStage\(/);
  assert.doesNotMatch(mainSource, /function archiveApprovedProject\(/);
  assert.doesNotMatch(mainSource, /window\.confirm\(`确认归档课题/);
});
