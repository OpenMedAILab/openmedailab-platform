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
  assert.match(mainSource, /closeRouteScopedOverlays\(\);\s*window\.requestAnimationFrame\(\(\) => window\.scrollTo\(\{ top: 0, behavior: "auto" \}\)\);/);
  assert.match(mainSource, /if \(state\.contributionModal\.open\)\s*\{\s*closeContributionModal\(\);/s);
  assert.match(mainSource, /if \(state\.admin\.taskProjectDetail\.open\)\s*\{\s*closeTaskProjectDetail\(\);/s);
  assert.match(mainSource, /if \(state\.admin\.projectFormOpen\)\s*\{\s*closeProjectForm\(\);/s);
  assert.match(mainSource, /if \(state\.confirmDialog\.open\)\s*\{\s*resolveConfirmDialog\(false\);/s);
});

test("profile menu action clicks blur the focused button after closing", () => {
  const blurCalls = mainSource.match(/\$event\.currentTarget\.blur\(\)/g) || [];
  assert.equal(blurCalls.length, 4);
});

test("desktop layout uses a left sidebar and mobile restores the top navigation", () => {
  assert.match(stylesSource, /\.app-shell\s*\{[\s\S]*?grid-template-columns:\s*240px minmax\(0,\s*1fr\);/);
  assert.match(stylesSource, /\.topbar\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?height:\s*calc\(100vh - 32px\);/);
  assert.match(stylesSource, /\.main-nav\s*\{[\s\S]*?flex-direction:\s*column;/);
  assert.match(stylesSource, /\.page\s*\{[\s\S]*?width:\s*min\(1180px,\s*100%\);/);
  assert.match(stylesSource, /@media \(max-width:\s*1040px\)\s*\{[\s\S]*?\.app-shell\s*\{[\s\S]*?display:\s*block;/);
  assert.match(stylesSource, /@media \(max-width:\s*1040px\)\s*\{[\s\S]*?\.topbar\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(stylesSource, /@media \(max-width:\s*1040px\)\s*\{[\s\S]*?\.main-nav,\s*\.account-area\s*\{[\s\S]*?flex-direction:\s*row;[\s\S]*?justify-content:\s*center;/);
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

test("homepage removes the hero copy and keeps compact library stats", () => {
  assert.doesNotMatch(mainSource, /library-hero/);
  assert.doesNotMatch(mainSource, /hero-title/);
  assert.doesNotMatch(mainSource, /大道无言/);
  assert.doesNotMatch(mainSource, /让医学问题，/);
  assert.doesNotMatch(mainSource, /等到它的盖世英雄/);
  assert.doesNotMatch(mainSource, /真实临床场景，开放协作验证/);
  assert.doesNotMatch(mainSource, /const heroTitleStyle = computed/);
  assert.doesNotMatch(mainSource, /function updateHeroTitleScrollProgress\(\)/);
  assert.match(mainSource, /class="inline-stats"/);
  assert.match(stylesSource, /\.inline-stats\s*\{/);
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

test("homepage theme selector uses image-backed topic cards", () => {
  assert.doesNotMatch(mainSource, />全部主题</);
  assert.match(mainSource, /不限主题/);
  assert.match(mainSource, /class="theme-strip topic-theme-strip"/);
  assert.match(mainSource, /class="theme-chip topic-theme-card"/);
  assert.match(mainSource, /homeThemeCards/);
  assert.match(mainSource, /topicThemeCardStyle\(theme\)/);
  assert.match(mainSource, /全部课题/);
  assert.match(mainSource, /AntiVEGF/);
  assert.match(mainSource, /阴道镜/);
  assert.match(mainSource, /MedicalAIPlatform\.png/);
  assert.match(mainSource, /AntiVEGF_img\.png/);
  assert.match(mainSource, /ROP\.png/);
  assert.match(mainSource, /Yindaojing\.png/);
  assert.match(stylesSource, /\.topic-theme-strip\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(168px,\s*1fr\)\);/);
  assert.match(stylesSource, /\.topic-theme-card\s*\{[\s\S]*?display:\s*flex;[\s\S]*?background-size:\s*cover;/);
});

test("workspace lifecycle UI exposes user/admin spaces and compact expandable project cards", () => {
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
  assert.match(mainSource, /toggleProjectExpansion\(project\)/);
  assert.match(mainSource, /projectSummaryText\(project\)/);
  assert.match(mainSource, /展开摘要和详情/);
  assert.doesNotMatch(mainSource, /project-status-popover/);
  assert.doesNotMatch(mainSource, /openProjectStatusCard\(project\)/);
  assert.match(stylesSource, /\.workspace-tabs\s*\{/);
});

test("project cards keep compact summary UI without hover status styles", () => {
  assert.match(stylesSource, /\.project-card\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(stylesSource, /\.project-list-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(mainSource, /class="project-card-top"/);
  assert.match(mainSource, /class="project-card-meta"/);
  assert.match(mainSource, /class="project-card-counts"/);
  assert.match(mainSource, /class="project-card-bottom project-status-strip"/);
  assert.match(mainSource, /class="project-status-row"/);
  assert.match(mainSource, /project-role-chip-row/);
  assert.match(mainSource, /projectFundingLabel\(project\)/);
  assert.match(mainSource, /projectStartupText\(project\)/);
  assert.match(mainSource, /interactionButtonActive\('like', project\)/);
  assert.match(mainSource, /interactionButtonActive\('participation', project\)/);
  assert.match(mainSource, /interactionButtonActive\('sponsor', project\)/);
  assert.match(mainSource, /@click\.stop="submitLike\(project\)"[\s\S]*?@click\.stop="toggleFollow\(project\)"[\s\S]*?@click\.stop="handleParticipationAction\(project\)"[\s\S]*?@click\.stop="submitLeadClaim\(project\)"[\s\S]*?@click\.stop="submitSponsor\(project\)"/);
  assert.match(mainSource, /followButtonLabel\(project\)/);
  assert.match(mainSource, /sponsorButtonLabel\(project\)/);
  assert.match(mainSource, /资助情况/);
  assert.match(mainSource, /启动情况/);
  assert.match(mainSource, /projectRecruitmentText\(project\)/);
  assert.match(mainSource, /AI博士及以上/);
  assert.match(mainSource, /role\.count }}\/{{ role\.required/);
  assert.match(stylesSource, /\.project-card-top\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/);
  assert.match(stylesSource, /\.project-card-counts\s*\{/);
  assert.match(stylesSource, /\.project-card-bottom\s*\{/);
  assert.match(stylesSource, /\.project-status-row\s*\{[\s\S]*?grid-template-columns:\s*38px minmax\(0,\s*1fr\);/);
  assert.match(stylesSource, /\.project-role-chip-row\s*\{[\s\S]*?display:\s*flex;/);
  assert.match(stylesSource, /\.project-interaction-actions\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*flex-start;/);
  assert.match(stylesSource, /\.project-interaction-actions button\s*\{[\s\S]*?flex:\s*0 0 86px;/);
  assert.match(stylesSource, /\.interaction-button\.interaction-active\s*\{/);
  assert.match(stylesSource, /\.project-card-meta span\.ready\s*\{/);
  assert.match(stylesSource, /\.project-startup-status\.ready > span\s*\{/);
  assert.match(stylesSource, /\.project-role-groups span\.ready\s*\{/);
  assert.match(stylesSource, /\.project-expanded-detail\s*\{/);
  assert.match(stylesSource, /\.project-meta-row\s*\{/);
  assert.doesNotMatch(stylesSource, /\.project-status-popover\s*\{/);
  assert.doesNotMatch(stylesSource, /\.viewer-status-block\s*\{/);
  assert.doesNotMatch(stylesSource, /\.status-uid-group/);
});

test("project detail uses a top action bar instead of right side panels", () => {
  assert.match(mainSource, /class="project-action-bar"/);
  assert.match(mainSource, /class="detail-stack"/);
  assert.match(mainSource, /class="content-panel project-team-panel"/);
  assert.match(mainSource, /目标期刊\/会议/);
  assert.match(mainSource, /projectStartupLabel\(state\.currentProject\)/);
  assert.match(mainSource, /projectFundingLabel\(state\.currentProject\)/);
  assert.doesNotMatch(mainSource, /<div class="score-panel">/);
  assert.doesNotMatch(mainSource, /<aside class="side-panel">\s*<h2>组队情况<\/h2>/);
  assert.doesNotMatch(mainSource, /<aside class="side-panel">\s*<h2>课题互动<\/h2>/);
  assert.match(stylesSource, /\.project-action-bar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/);
  assert.match(stylesSource, /\.detail-stack\s*\{/);
  assert.match(stylesSource, /\.project-team-panel \.role-list\s*\{/);
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

test("admin project management supports bulk archive selection", () => {
  assert.match(mainSource, /selectedProjectIds:\s*\[\]/);
  assert.match(mainSource, /bulkArchivingProjects:\s*false/);
  assert.match(mainSource, /function toggleVisibleAdminProjectsSelection\(event\)/);
  assert.match(mainSource, /function bulkArchiveSelectedProjects\(\)/);
  assert.match(mainSource, /api\.adminBulkArchiveProjects\(\{\s*ids\s*\}\)/);
  assert.match(mainSource, /批量删除\(/);
  assert.match(mainSource, /class="admin-table project-admin-table"/);
  assert.match(mainSource, /aria-label="选择当前页全部课题"/);
  assert.match(apiSource, /adminBulkArchiveProjects/);
  assert.match(apiSource, /\/api\/admin\/projects\/bulk-archive\//);
  assert.match(stylesSource, /\.project-admin-table \.admin-table-head,\s*\.project-admin-table \.admin-table-row\s*\{/);
  assert.match(stylesSource, /\.admin-select-cell\s*\{/);
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
  assert.match(mainSource, /当前阶段暂不接受新的参与申请/);
  assert.match(mainSource, /handleParticipationAction\(project\)/);
  assert.match(mainSource, /handleParticipationAction\(state\.currentProject\)/);
  assert.match(mainSource, /取消点赞/);
  assert.match(mainSource, /取消关注/);
  assert.match(mainSource, /async function submitSponsor\(project = state\.currentProject\)/);
  assert.match(mainSource, /api\.withdrawInteraction\("sponsor",\s*request\.id/);
  assert.match(mainSource, /撤回资助/);
  assert.match(mainSource, /function withdrawParticipationRequest\(project\)/);
  assert.match(mainSource, /api\.withdrawInteraction\("interest",\s*request\.id/);
  assert.match(mainSource, /撤回申请/);
  assert.doesNotMatch(mainSource, /重新申请/);
  assert.doesNotMatch(mainSource, /重新资助/);
  assert.doesNotMatch(mainSource, /重新点赞/);
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

test("project cards no longer fetch hover status cards after lifecycle writes", () => {
  assert.doesNotMatch(mainSource, /state\.projectStatusCards/);
  assert.doesNotMatch(mainSource, /api\.projectStatusCard\(project\.id\)/);
  assert.doesNotMatch(mainSource, /课题状态读取失败/);
  assert.doesNotMatch(mainSource, /uid_groups:\s*\{\s*uids_visible:\s*false,\s*groups:\s*\[\]\s*\}/);
  assert.match(mainSource, /function invalidateProjectStatusCard\(\)\s*\{\s*return null;/);
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

test("admin project lifecycle exposes json import with confirmation preview", () => {
  assert.doesNotMatch(mainSource, /importJson\(/);
  assert.doesNotMatch(mainSource, /useExampleJson/);
  assert.doesNotMatch(mainSource, /state\.admin\.importText/);
  assert.match(mainSource, /JSON 导入/);
  assert.match(mainSource, /downloadJsonTemplate/);
  assert.match(mainSource, /handleJsonFiles/);
  assert.match(mainSource, /clearJsonImport/);
  assert.match(mainSource, /state\.schema\.json_template/);
  assert.match(mainSource, /字段契约与 JSON 模板/);
  assert.doesNotMatch(mainSource, /JSON\/JSONL/);
  assert.doesNotMatch(mainSource, /\.jsonl/);
  assert.match(mainSource, /refreshJsonImportRow/);
  assert.match(mainSource, /jsonImport\.previewOpen/);
  assert.match(mainSource, /确认导入可写入项/);
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
  assert.match(mainSource, /Title（中文）/);
  assert.match(mainSource, /Title（英文，选填）/);
  assert.match(mainSource, /<label><span>摘要<\/span><textarea v-model="state\.admin\.projectForm\.summary"/);
  assert.match(mainSource, /科学问题（选填，250字以内）/);
  assert.match(mainSource, /临床终点（选填，250字以内）/);
  assert.match(mainSource, /已有基础（选填，250字以内）/);
  assert.doesNotMatch(mainSource, /<label><span>课题 ID<\/span><input v-model="state\.admin\.projectForm\.topic_id"/);
  assert.doesNotMatch(mainSource, /数据类型/);
  assert.doesNotMatch(mainSource, /最小样本量/);
  assert.doesNotMatch(mainSource, /评价指标（每行一条）/);
  assert.doesNotMatch(mainSource, /预期成果（每行一条）/);
  assert.doesNotMatch(mainSource, /文件列表（类型\\|标题\\|路径，每行一条）/);
  assert.doesNotMatch(mainSource, /Markdown 路径/);
  assert.doesNotMatch(mainSource, /正文 Markdown/);
  assert.doesNotMatch(mainSource, /评分维度（维度\\|分数，每行一条）/);
});

test("admin project form is opened in a modal instead of occupying the normal project list view", () => {
  assert.match(mainSource, /projectFormOpen:\s*false/);
  assert.match(mainSource, /state\.admin\.projectFormOpen\s*=\s*true/);
  assert.match(mainSource, /closeProjectForm/);
  assert.match(mainSource, /project-form-modal/);
  assert.match(mainSource, /role="dialog"/);
  assert.doesNotMatch(mainSource, /id="admin-project-form"/);
});

test("admin project form no longer exposes score dimension fields", () => {
  assert.doesNotMatch(mainSource, /formatScoreDimensionLines/);
  assert.doesNotMatch(mainSource, /scoreDimensionsPayload/);
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
