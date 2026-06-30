import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainSource = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("./api.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function cssRuleBlock(selector, source = stylesSource) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] || "";
}

function mediaRange(startQuery, endQuery) {
  const start = stylesSource.indexOf(startQuery);
  const end = stylesSource.indexOf(endQuery, start + startQuery.length);
  if (start === -1) {
    return "";
  }
  return stylesSource.slice(start, end === -1 ? undefined : end);
}

test("legacy project detail modal state and styles are removed", () => {
  assert.match(mainSource, /<div v-if="state\.toast" class="toast" role="status" aria-live="polite" aria-atomic="true">/);
  assert.doesNotMatch(mainSource, /state\.preview/);
  assert.doesNotMatch(mainSource, /state\.currentProject/);
  assert.doesNotMatch(mainSource, /openProjectPreview/);
  assert.doesNotMatch(mainSource, /closeProjectPreview/);
  assert.doesNotMatch(mainSource, /toggleProjectPreviewSize/);
  assert.doesNotMatch(mainSource, /class="project-modal/);
  assert.doesNotMatch(stylesSource, /\.project-modal/);
  assert.doesNotMatch(stylesSource, /\.project-modal-backdrop/);
});

test("project title opens progress page while pdf actions still open documents", () => {
  assert.doesNotMatch(mainSource, /state\.preview\.pdfMode/);
  assert.doesNotMatch(mainSource, /openProjectPreview/);
  assert.doesNotMatch(mainSource, /class="project-pdf-preview"/);
  assert.doesNotMatch(mainSource, /<iframe[^>]+课题PDF预览/);
  assert.match(mainSource, /function projectDetailHref\(project\)/);
  assert.match(mainSource, /activeView === 'project'/);
  assert.match(mainSource, /parts\[0\] === "project"/);
  assert.match(mainSource, /parts\[2\] === "progress"/);
  assert.match(mainSource, /api\.projectProgress/);
  assert.match(mainSource, /function projectPdfHref\(project\)/);
  assert.match(mainSource, /function projectCardTitle\(project\)/);
  assert.match(mainSource, /class="project-title-link"[^>]*:href="projectDetailHref\(project\)"/);
  assert.match(mainSource, /data-testid="project-title-link"[\s\S]*?\{\{\s*projectCardTitle\(project\)\s*\}\}/);
  assert.match(mainSource, />查看PDF</);
  assert.match(mainSource, />下载PDF</);
  assert.match(mainSource, /target="_blank"\s+rel="noopener"/);
  assert.match(mainSource, /documentHref\(primaryProjectDocument\(project\)\)"\s+download/);
  assert.doesNotMatch(mainSource, /function selectSpace\(slug\)/);
  assert.doesNotMatch(mainSource, /navigate\("space"/);
});

test("project discussion is a standalone route instead of embedded inside progress", () => {
  assert.match(mainSource, /parts\[2\] === "discussion"/);
  assert.match(mainSource, /name: "projectDiscussion"/);
  assert.match(mainSource, /function projectDiscussionHref\(project\)/);
  assert.match(mainSource, /activeView === 'projectDiscussion'/);
  assert.match(mainSource, /class="project-discussion-page"/);
  assert.match(mainSource, /discussion-page-shell/);
  assert.match(mainSource, /discussion-bottom-bar/);
  assert.match(mainSource, /进入讨论区/);
  assert.match(mainSource, /查看项目进度/);
  assert.doesNotMatch(mainSource, /class="content-panel project-discussion-section"/);
});

test("project cards keep communication and progress buttons beside tags while pdf actions stay bottom-right", () => {
  assert.match(mainSource, /class="project-card-tags-actions"[\s\S]*?>\s*交流区\s*<[\s\S]*?>\s*项目进度\s*</);
  assert.match(mainSource, /<div v-if="hasPrimaryProjectPdf\(project\)" class="project-pdf-actions">/);
  const pdfActions = mainSource.match(/<div v-if="hasPrimaryProjectPdf\(project\)" class="project-pdf-actions">[\s\S]*?<\/div>/)?.[0] || "";
  assert.doesNotMatch(pdfActions, /projectDiscussionHref\(project\)/);
  assert.doesNotMatch(pdfActions, />\s*交流区\s*</);
  assert.doesNotMatch(pdfActions, />\s*项目进度\s*</);
  assert.match(stylesSource, /\.project-card-footer \.project-interaction-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(7,\s*minmax\(72px,\s*1fr\)\);/);
  assert.match(cssRuleBlock(".project-card-tags-actions"), /flex-wrap:\s*nowrap;/);
  assert.match(cssRuleBlock(".project-card-inline-actions"), /flex-wrap:\s*nowrap;/);
  const media980 = mediaRange("@media (max-width: 980px)", "@media (max-width: 640px)");
  assert.match(cssRuleBlock(".project-card-footer .project-interaction-actions", media980), /grid-template-columns:\s*repeat\(7,\s*minmax\(64px,\s*1fr\)\);/);
  const media640 = mediaRange("@media (max-width: 640px)", "@media (max-width: 380px)");
  assert.match(cssRuleBlock(".project-card-tags-actions", media640), /flex-direction:\s*column;/);
});

test("profile form uses public display name wording", () => {
  assert.match(mainSource, />对外显示姓名</);
  assert.doesNotMatch(mainSource, />真实姓名</);
});

test("admin project form exposes progress document upload separately from the main pdf", () => {
  assert.match(mainSource, /async function uploadProjectProgressDocument\(\)/);
  assert.match(mainSource, /documentKind:\s*"progress"/);
  assert.match(mainSource, /state\.admin\.projectForm\.progressDocumentUpload/);
  assert.match(mainSource, /项目进度文档/);
  assert.match(mainSource, /上传进度PDF/);
  assert.match(mainSource, /document_kind",\s*options\.documentKind \|\| "detail"/);
});

test("planned recruitment theme progress discussion and faq entry features are wired", () => {
  assert.match(mainSource, /overfilled/);
  assert.doesNotMatch(mainSource, /超额/);
  assert.doesNotMatch(stylesSource, /\.project-role-chip-row > span\.overfilled\s*\{/);
  assert.doesNotMatch(stylesSource, /\.project-role-chip-row > span\.self-role\.overfilled\s*\{/);

  assert.match(apiSource, /adminReorderThemes/);
  assert.match(apiSource, /\/api\/admin\/themes\/reorder\//);
  assert.match(mainSource, /themeSortDirty/);
  assert.match(mainSource, /moveThemeSort/);
  assert.match(mainSource, /saveThemeSort/);
  assert.match(mainSource, /排序未保存/);
  assert.match(stylesSource, /\.theme-sort-actions\s*\{/);

  assert.match(apiSource, /projectProgress/);
  assert.match(apiSource, /projectDiscussions/);
  assert.match(apiSource, /createProjectDiscussion/);
  assert.match(apiSource, /moderateProjectDiscussion/);
  assert.match(mainSource, /projectProgressDocuments/);
  assert.match(mainSource, /projectProgressTimelineItems/);
  assert.match(mainSource, /project-discussion-page/);
  assert.match(mainSource, /登录后参与课题讨论/);
  assert.match(stylesSource, /\.project-progress-page\s*\{/);
  assert.match(stylesSource, /\.project-discussion-item\s*\{/);

  assert.match(mainSource, /\{ name: "faq", label: "常见问答" \}/);
  assert.match(mainSource, /activeView === 'faq'/);
  assert.match(mainSource, /const FAQ_ENTRIES = \[/);
  assert.equal((mainSource.match(/question: "/g) || []).length, 10);
  assert.match(mainSource, /这个网站是做什么的/);
  assert.match(mainSource, /如何参与一个课题/);
  assert.match(mainSource, /遇到登录、课题或协作问题怎么办/);
  assert.match(mainSource, /SIDEBAR_QR_ENTRIES/);
  assert.match(mainSource, /联系管理员/);
  assert.match(mainSource, /加入社区/);
  assert.match(mainSource, /sidebarQrEntries/);
  assert.match(mainSource, /faqQrEntries/);
  assert.match(mainSource, /entry\.has_image && sidebarQrImageSrc\(entry\)/);
  assert.match(mainSource, /sidebarQrImageSrc/);
  assert.match(mainSource, /class="faq-qr-section"/);
  assert.doesNotMatch(mainSource, /sidebarQrModal/);
  assert.doesNotMatch(mainSource, /openSidebarQrModal/);
  assert.doesNotMatch(mainSource, /class="sidebar-qr-actions"/);
  assert.match(apiSource, /sidebarQrs/);
  assert.match(apiSource, /adminUploadSidebarQr/);
  assert.match(mainSource, /state\.admin\.activeTab === 'system'/);
  assert.match(mainSource, /系统入口/);
  assert.match(mainSource, /管理员可上传或更新常见问答底部二维码/);
  assert.match(mainSource, /uploadSidebarQr/);
  assert.match(mainSource, /setSidebarQrUploadFile/);
  assert.match(stylesSource, /\.faq-list\s*\{/);
  assert.match(stylesSource, /\.faq-qr-section\s*\{/);
  assert.match(stylesSource, /\.sidebar-qr-admin-grid\s*\{/);
  assert.doesNotMatch(stylesSource, /\.sidebar-qr-modal-backdrop/);
  assert.match(stylesSource, /\.confirm-modal-backdrop\s*\{[\s\S]*?z-index:\s*900;/);
});

test("participation hard cap has stable user-facing handling", () => {
  assert.match(mainSource, /participation_limit_reached/);
  assert.match(mainSource, /当前身份可同时参与的课题数已达上限/);
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
  assert.equal(blurCalls.length, 3);
  assert.match(mainSource, /function openProfileMenuFromTrigger\(event\)[\s\S]*?state\.profileMenuOpen = true;/);
  assert.match(mainSource, /@click="openProfileMenuFromTrigger\(\$event\)" aria-haspopup="dialog" :aria-expanded="state\.profileMenuOpen \? 'true' : 'false'"/);
  assert.doesNotMatch(mainSource, /class="text-button profile-trigger" type="button" @click="navigate\('dashboard'\); closeProfileMenu\(\); \$event\.currentTarget\.blur\(\)"/);
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
  assert.doesNotMatch(stylesSource, /@media \(max-width:\s*980px\)\s*\{\s*\.main-nav,\s*\.account-area\s*\{[^}]*overflow-x:\s*auto;/);
});

test("topbar account actions are consolidated into the profile menu", () => {
  assert.doesNotMatch(mainSource, /<span class="role-pill">/);
  assert.doesNotMatch(mainSource, /<button v-if="state\.user" class="ghost-button" type="button" @click="logout">/);
  assert.match(mainSource, /class="ghost-button danger profile-logout"/);
  assert.match(mainSource, /@click="logout\(\); closeProfileMenu\(\); \$event\.currentTarget\.blur\(\)"/);
});

test("project cards and headers keep small-screen overflow guards", () => {
  assert.match(stylesSource, /\.project-title-link\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(stylesSource, /\.section-head h1\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.section-head h1\s*\{[\s\S]*?font-size:\s*30px;/);
});

test("self-related project cards align meta chips near the corner ribbon without overlap", () => {
  const max980Start = stylesSource.indexOf("@media (max-width: 980px)");
  const max640Start = stylesSource.indexOf("@media (max-width: 640px)");
  const max980Block = stylesSource.slice(max980Start, max640Start);

  assert.match(mainSource, /project-card-headline--self-related/);
  assert.match(mainSource, /primarySelfRelationLabel\(project\)/);
  assert.doesNotMatch(mainSource, /function selfRelationContentStyle\(project\)/);
  assert.doesNotMatch(mainSource, /--self-relation-content-offset/);
  assert.doesNotMatch(mainSource, /:style="selfRelationContentStyle\(project\)"/);
  assert.match(mainSource, /class="project-card-body" data-testid="project-card-body"/);
  assert.match(stylesSource, /\.project-card--self-related\s*\{[\s\S]*?padding-top:\s*108px;/);
  assert.match(stylesSource, /\.project-card-headline\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/);
  assert.match(stylesSource, /\.project-card--self-related \.project-card-headline,\s*\.project-card-headline--self-related\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*16px;[\s\S]*?left:\s*72px;[\s\S]*?right:\s*18px;[\s\S]*?align-items:\s*start;/);
  assert.match(stylesSource, /\.project-card--self-related \.project-card-headline \.project-card-meta,\s*\.project-card-headline--self-related \.project-card-meta\s*\{[\s\S]*?padding-left:\s*0;/);
  assert.doesNotMatch(stylesSource, /--self-relation-content-offset/);
  assert.match(stylesSource, /\.project-card--self-related \.project-list-main,\s*\.project-card--self-related \.project-card-body\s*\{[\s\S]*?margin-left:\s*0;[\s\S]*?padding-left:\s*0;[\s\S]*?transform:\s*none;/);
  assert.match(stylesSource, /\.project-card--self-related > \.project-list-main,\s*\.project-card--self-related > \.project-card-body,\s*\.project-card--self-related > \.project-card-bottom,\s*\.project-card--self-related > \.project-card-footer\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?justify-self:\s*stretch;[\s\S]*?width:\s*100%;/);
  assert.match(stylesSource, /\.project-card\.project-card--self-related \.project-list-main,\s*\.project-card\.project-card--self-related \.project-card-body\s*\{[\s\S]*?margin-left:\s*0 !important;[\s\S]*?padding-left:\s*0 !important;[\s\S]*?transform:\s*none !important;/);
  assert.match(stylesSource, /\.project-card\.project-card--self-related > \.project-list-main,\s*\.project-card\.project-card--self-related > \.project-card-body,\s*\.project-card\.project-card--self-related > \.project-card-bottom,\s*\.project-card\.project-card--self-related > \.project-card-footer\s*\{[\s\S]*?margin-left:\s*0 !important;[\s\S]*?padding-left:\s*0 !important;[\s\S]*?transform:\s*none !important;/);
  assert.doesNotMatch(stylesSource, /\.project-card--self-related \.project-list-main\s*\{[\s\S]*?padding-left:\s*var/);
  assert.notEqual(max980Start, -1);
  assert.notEqual(max640Start, -1);
  assert.doesNotMatch(max980Block, /\.project-card-headline--self-related/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.project-card--self-related\s*\{[\s\S]*?padding-top:\s*96px;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.project-card--self-related \.project-card-headline,\s*\.project-card-headline--self-related\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*18px;[\s\S]*?left:\s*72px;[\s\S]*?right:\s*14px;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.project-card--self-related \.project-card-headline \.project-card-meta,\s*\.project-card-headline--self-related \.project-card-meta\s*\{[\s\S]*?padding-left:\s*0;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.project-card-headline--self-related \.project-card-side\s*\{[\s\S]*?display:\s*none;/);
});

test("project interaction buttons use a compact responsive grid without stretching", () => {
  assert.match(mainSource, /第一单位认领审批中/);
  assert.match(mainSource, /项目负责人审批中/);
  assert.match(mainSource, /claim-action-button/);
  assert.match(mainSource, /sponsor-action-button/);
  assert.match(stylesSource, /\.project-interaction-actions\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(88px,\s*112px\)\);[\s\S]*?justify-content:\s*start;[\s\S]*?max-width:\s*720px;/);
  assert.match(stylesSource, /\.project-interaction-actions button\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?white-space:\s*normal;/);
  assert.doesNotMatch(stylesSource, /\.project-interaction-actions \.sponsor-action-button\s*\{[\s\S]*?rgba\(217,\s*154,\s*24/);
  assert.doesNotMatch(stylesSource, /\.sponsor-action-button\.interaction-active\s*\{[\s\S]*?#ffefd0/);
  assert.match(stylesSource, /\.interaction-button\.interaction-active\s*\{[\s\S]*?background:\s*#e8f7f4;[\s\S]*?color:\s*#08766f;/);
  assert.match(stylesSource, /\.interaction-button > span:last-child\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(stylesSource, /\.interaction-icon\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  assert.match(stylesSource, /@media \(max-width:\s*980px\)\s*\{[\s\S]*?\.project-interaction-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(88px,\s*112px\)\);[\s\S]*?width:\s*auto;[\s\S]*?max-width:\s*720px;[\s\S]*?min-width:\s*min\(100%,\s*360px\);[\s\S]*?justify-content:\s*start;/);
  assert.doesNotMatch(stylesSource, /@media \(max-width:\s*980px\)\s*\{[\s\S]*?\.project-interaction-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.doesNotMatch(stylesSource, /@media \(max-width:\s*980px\)\s*\{[\s\S]*?\.project-interaction-actions button\s*\{[\s\S]*?min-height:\s*42px;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.project-card-footer\s*\{[\s\S]*?align-items:\s*stretch;[\s\S]*?flex-direction:\s*column;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.project-interaction-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;[\s\S]*?min-width:\s*0;[\s\S]*?justify-content:\s*stretch;/);
  assert.doesNotMatch(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.project-interaction-actions button\s*\{[\s\S]*?min-height:\s*40px;/);
  assert.match(stylesSource, /@media \(max-width:\s*380px\)\s*\{[\s\S]*?\.project-interaction-actions\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.doesNotMatch(stylesSource, /@media \(max-width:\s*380px\)\s*\{[\s\S]*?\.project-interaction-actions button\s*\{[\s\S]*?min-height:\s*38px;/);
  assert.match(stylesSource, /\.project-pdf-actions \.ghost-button,\s*\.project-pdf-actions \.pdf-download-link,\s*\.project-pdf-actions \.pdf-view-link\s*\{[\s\S]*?min-height:\s*44px;/);
});

test("team role chips expose self-role state accessibly across cards and progress page", () => {
  assert.match(mainSource, /function selfTeamRoleKeys\(project\)/);
  assert.match(mainSource, /function isSelfTeamRole\(project,\s*role\)/);
  assert.match(mainSource, /function teamRoleAriaLabel\(role\)/);
  assert.match(mainSource, /function requiredTeamRoles\(teamStatus,\s*project/);
  assert.match(mainSource, /v-for="role in requiredTeamRoles\(project\.team_status,\s*project\)"/);
  assert.match(mainSource, /v-for="role in requiredTeamRoles\(state\.projectProgress\.project\.team_status,\s*state\.projectProgress\.project\)"/);
  assert.match(mainSource, /'self-role': role\.isSelfRole/);
  assert.match(mainSource, /:aria-label="teamRoleAriaLabel\(role\)"/);
  assert.match(stylesSource, /\.project-role-chip-row > span\.self-role\s*\{[\s\S]*?background:\s*#fff4d2;[\s\S]*?color:\s*#7a4c00;/);
  assert.doesNotMatch(stylesSource, /\.project-role-chip-row > span\.self-role\.overfilled\s*\{/);
  assert.match(stylesSource, /\.project-role-chip-row > span:focus-visible,\s*\.team-role-chip:focus-visible\s*\{[\s\S]*?outline:\s*2px solid/);
});

test("project interaction icons do not leak ligature text when the icon font is unavailable", () => {
  assert.match(mainSource, /installMaterialSymbolReadinessWatcher\(\);/);
  assert.match(mainSource, /material-symbols-ready/);
  assert.match(mainSource, /thumb_up[\s\S]*?getBoundingClientRect\(\)\.width\s*<\s*48/);
  assert.match(stylesSource, /html:not\(\.material-symbols-ready\) \.interaction-icon\s*\{[\s\S]*?width:\s*0;[\s\S]*?font-size:\s*0;[\s\S]*?visibility:\s*hidden;/);
  assert.match(stylesSource, /html:not\(\.material-symbols-ready\) \.project-interaction-actions button\s*\{[\s\S]*?gap:\s*0;/);
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

test("admin theme management exposes dataset description pdf workflow", () => {
  assert.match(mainSource, />主题管理<\/button>/);
  assert.match(mainSource, /主题配置、首页筛选和数据集说明 PDF 都在这里统一维护。/);
  assert.match(mainSource, />新增主题</);
  assert.match(mainSource, /state\.admin\.themeFormOpen/);
  assert.match(mainSource, /adminThemeDatasetFile\(theme\)/);
  assert.match(mainSource, /数据集说明 PDF/);
  assert.match(mainSource, /一个主题只维护一份数据集说明 PDF/);
  assert.match(mainSource, /uploadThemeFileDetailPdf/);
  assert.match(mainSource, /function deactivateTheme\(theme\)/);
  assert.match(mainSource, /const nextActive = !theme\.is_active/);
  assert.match(mainSource, /api\.adminUpdateTheme\(theme\.id, \{ is_active: nextActive \}\)/);
  assert.match(mainSource, /nextActive \? "主题已启用" : "主题已停用"/);
  assert.match(mainSource, /function deleteTheme\(theme\)/);
  assert.match(mainSource, /openConfirmDialog\(\{/);
  assert.match(mainSource, /确认物理删除主题/);
  assert.match(mainSource, /api\.adminDeleteTheme\(theme\.id\)/);
  assert.match(mainSource, /\{\{ theme\.is_active \? '停用' : '启用' \}\}/);
  assert.match(mainSource, />删除<\/button>/);
  assert.doesNotMatch(mainSource, /新增说明/);
  assert.doesNotMatch(mainSource, /保存说明/);
  assert.match(apiSource, /themeDatasets/);
  assert.match(apiSource, /adminUploadThemeFileDetailPdf/);
  assert.doesNotMatch(mainSource, /文件空间管理/);
  assert.doesNotMatch(mainSource, /state\.admin\.fileManager/);
  assert.doesNotMatch(mainSource, /handleFileSpaceUpload/);
  assert.doesNotMatch(apiSource, /adminFileSpace/);
});

test("admin backup restore is exposed as a dedicated management tab", () => {
  assert.match(mainSource, /state\.admin\.activeTab === 'backup'/);
  assert.match(mainSource, />备份恢复<\/button>/);
  assert.match(mainSource, /function exportContentBackup\(\)/);
  assert.match(mainSource, /function restoreContentBackup\(\)/);
  assert.match(mainSource, /adminExportContentBackup/);
  assert.match(mainSource, /adminRestoreContentBackup/);
  assert.match(mainSource, /用户账号、协作记录和审计日志不会被恢复包覆盖/);
  assert.match(stylesSource, /\.backup-action-grid\s*\{/);
  assert.match(apiSource, /content-backup\/export/);
  assert.match(apiSource, /content-backup\/restore/);
});

test("homepage search toolbar is lifted and visually emphasized", () => {
  assert.match(mainSource, /sort:\s*"recommended"/);
  assert.match(mainSource, /<option value="recommended">默认<\/option>/);
  assert.match(mainSource, /<option value="project_id">编号顺序<\/option>/);
  assert.match(mainSource, /<option value="newest">最新编号<\/option>/);
  assert.match(mainSource, /<option value="updated">最近更新<\/option>/);
  assert.match(mainSource, /function projectListRequestParams\(\)\s*\{\s*return \{\s*\.\.\.state\.filters\s*\};\s*\}/);
  assert.doesNotMatch(mainSource, /params\.sort === "likes"[\s\S]*?params\.sort = "follows"/);
  assert.match(mainSource, /state\.filters\.sort === "recommended"[\s\S]*?projectEngagementCount\(b\) - projectEngagementCount\(a\)/);
  assert.match(mainSource, /state\.filters\.sort === "newest"[\s\S]*?projectTopicSortValue\(b\) - projectTopicSortValue\(a\)/);
  assert.match(mainSource, /state\.filters\.sort === "likes"[\s\S]*?numericProjectField\(b,\s*"score_count"\) - numericProjectField\(a,\s*"score_count"\)/);
  assert.match(mainSource, /return rows\.sort\(\(a, b\) => projectTopicSortValue\(a\) - projectTopicSortValue\(b\)\);/);
  assert.match(stylesSource, /\.toolbar\s*\{[\s\S]*?margin:\s*-4px 0 22px;[\s\S]*?padding:\s*16px;[\s\S]*?border-radius:\s*12px;/);
  assert.match(stylesSource, /\.toolbar input,\s*\.toolbar select\s*\{[\s\S]*?min-height:\s*46px;[\s\S]*?border-radius:\s*10px;/);
  assert.match(stylesSource, /\.toolbar \.primary-button\s*\{[\s\S]*?min-height:\s*58px;[\s\S]*?border-radius:\s*10px;/);
});

test("homepage theme selector uses image-backed topic cards", () => {
  assert.match(mainSource, /class="theme-chip topic-theme-card theme-action-card all-projects-theme-trigger"/);
  assert.match(mainSource, />不限主题</);
  assert.match(mainSource, /不限主题/);
  assert.doesNotMatch(mainSource, /state\.themeDropdownOpen/);
  assert.match(mainSource, /homeThemeRowColumnCount/);
  assert.match(mainSource, /homeThemeRowThemes/);
  assert.doesNotMatch(mainSource, /homeThemeDropdownThemes/);
  assert.doesNotMatch(mainSource, /toggleThemeDropdown/);
  assert.doesNotMatch(mainSource, /closeThemeDropdown/);
  assert.doesNotMatch(mainSource, /展示全部主题/);
  assert.doesNotMatch(mainSource, /收起全部主题/);
  assert.doesNotMatch(mainSource, /class="theme-dropdown"/);
  assert.doesNotMatch(mainSource, /class="theme-chip topic-theme-card theme-dropdown-card"/);
  assert.doesNotMatch(mainSource, /class="theme-dropdown-item"/);
  assert.match(mainSource, /class="theme-strip topic-theme-strip single-row"/);
  assert.match(mainSource, /:style="\{ '--home-theme-columns': homeThemeRowColumnCount \}"/);
  assert.match(mainSource, /class="theme-chip topic-theme-card"/);
  assert.doesNotMatch(mainSource, /class="theme-chip topic-theme-card theme-action-card all-themes-trigger"/);
  assert.match(mainSource, /homeThemeCards/);
  assert.match(mainSource, /FEATURED_TOPIC_THEMES/);
  assert.match(mainSource, /topicThemeMatchesPreset/);
  assert.doesNotMatch(mainSource, /homeThemeCards\.value\.slice\(0,\s*4\)/);
  assert.doesNotMatch(mainSource, /homeThemeDropdownThemes\s*=\s*computed\(\(\)\s*=>\s*homeThemeCards\.value\.slice\(4\)\)/);
  assert.match(mainSource, /homeThemeRowThemes\s*=\s*computed\(\(\)\s*=>\s*homeThemeCards\.value\)/);
  assert.match(mainSource, /homeThemeRowColumnCount\s*=\s*computed\(\(\)\s*=>\s*homeThemeRowThemes\.value\.length \+ 1\)/);
  assert.match(mainSource, /v-for="theme in homeThemeRowThemes"/);
  assert.doesNotMatch(mainSource, /class="theme-chip topic-theme-card theme-action-card theme-dropdown-card"[\s\S]*?<span>不限主题<\/span>/);
  assert.doesNotMatch(mainSource, /sortThemesByInitial/);
  assert.match(mainSource, /topicThemeCardStyle\(theme\)/);
  assert.match(mainSource, /topicThemeCardStyle\(\)/);
  assert.match(mainSource, /selectedThemeDatasetPdfHref/);
  assert.match(mainSource, /class="theme-dataset-link"/);
  assert.match(mainSource, /title="点击查看该主题的数据集说明文件"/);
  assert.match(mainSource, /target="_blank"\s+rel="noopener"/);
  assert.doesNotMatch(mainSource, /<span>全部课题<\/span>/);
  assert.match(mainSource, /AntiVEGF/);
  assert.match(mainSource, /AMD/);
  assert.match(mainSource, /阴道镜/);
  assert.match(mainSource, /MedicalAIPlatform\.png/);
  assert.match(mainSource, /AntiVEGF_img\.png/);
  assert.match(mainSource, /ROP\.png/);
  assert.match(mainSource, /Yindaojing\.png/);
  assert.doesNotMatch(mainSource, /synthetic:\s*true/);
  assert.match(stylesSource, /\.topic-theme-strip\.single-row\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(var\(--home-theme-columns\),\s*minmax\(118px,\s*1fr\)\);[^}]*overflow-x:\s*auto;/);
  assert.match(stylesSource, /\.topic-theme-card\s*\{[\s\S]*?min-height:\s*82px;/);
  assert.match(stylesSource, /\.topic-theme-card\s*\{[\s\S]*?display:\s*flex;[\s\S]*?background-size:\s*cover;/);
  assert.match(stylesSource, /\.theme-action-card\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/);
  assert.doesNotMatch(stylesSource, /\.theme-dropdown \.topic-theme-card/);
  assert.doesNotMatch(stylesSource, /\.theme-dropdown-card/);
  assert.doesNotMatch(stylesSource, /\.theme-dropdown\s*\{/);
  assert.match(stylesSource, /\.theme-dataset-link\s*\{/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.topic-theme-strip\.single-row\s*\{[\s\S]*?grid-template-columns:\s*none;[\s\S]*?grid-auto-flow:\s*column;[\s\S]*?grid-auto-columns:\s*minmax\(118px,\s*42vw\);[\s\S]*?overflow-x:\s*auto;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.topic-theme-strip\.single-row \.topic-theme-card\s*\{[\s\S]*?scroll-snap-align:\s*start;/);
});

test("topbar exposes only aggregate platform stats", () => {
  assert.match(mainSource, /platform_stats:\s*\{[\s\S]*?registered_user_count:\s*0,[\s\S]*?online_user_count:\s*0,[\s\S]*?online_window_seconds:\s*300/);
  assert.match(mainSource, /platformStats/);
  assert.match(mainSource, /class="site-micro-stats"/);
  assert.match(mainSource, /注册 \{\{ platformStats\.registered_user_count \|\| 0 \}\}/);
  assert.match(mainSource, /在线 \{\{ platformStats\.online_user_count \|\| 0 \}\}/);
  assert.match(stylesSource, /\.site-micro-stats\s*\{[\s\S]*?font-size:\s*12px;[\s\S]*?white-space:\s*nowrap;/);
  assert.doesNotMatch(mainSource, /last_seen_at/);
});

test("workspace lifecycle UI exposes user/admin spaces and always-expanded project cards", () => {
  assert.match(mainSource, /label:\s*"个人中心"/);
  assert.match(mainSource, />当前积分<\/h2>/);
  assert.doesNotMatch(mainSource, /<dt>声誉<\/dt>/);
  assert.match(mainSource, /workspace-tabs/);
  assert.match(mainSource, />我的任务<\/button>/);
  assert.match(mainSource, />我的上传<\/button>/);
  assert.doesNotMatch(mainSource, /function uploadMyProjectDocument\(\)/);
  assert.match(mainSource, /api\.uploadProjectDocuments/);
  assert.match(mainSource, /setMyProjectDocumentFile/);
  assert.match(mainSource, /function uploadProjectDocumentForForm\(form,\s*uploadMethod,\s*options = \{\}\)/);
  assert.match(mainSource, /uploadProjectDocumentForForm\(state\.myProjectForm,\s*api\.uploadProjectDocuments,[\s\S]*?projectId:\s*savedProject\.id,[\s\S]*?silent:\s*true/);
  assert.match(mainSource, /可在这里选择 PDF，保存课题时自动上传。/);
  assert.match(mainSource, /PDF 会随课题一起上传或替换。/);
  assert.match(apiSource, /project-documents\/upload/);
  assert.match(mainSource, /const WORKSPACE_TABS = new Set\(\[[^\]]*"applications"/);
  assert.match(mainSource, />我的申请<\/button>/);
  assert.match(mainSource, /myApplicationRows/);
  assert.match(mainSource, /class="application-list"/);
  assert.match(mainSource, /class="application-card"/);
  assert.match(stylesSource, /\.application-card > div\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(stylesSource, /\.application-card p,\s*\.application-card small\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.doesNotMatch(mainSource, />我的任务结果<\/button>/);
  assert.doesNotMatch(mainSource, />我的贡献<\/button>/);
  assert.doesNotMatch(mainSource, />积分流水<\/button>/);
  assert.match(mainSource, /state\.admin\.activeTab === 'overview'/);
  assert.match(mainSource, /state\.admin\.activeTab === 'interactions'/);
  assert.match(mainSource, /state\.admin\.activeTab === 'contributions'/);
  assert.match(mainSource, /state\.admin\.activeTab === 'audit'/);
  assert.doesNotMatch(mainSource, /state\.admin\.activeTab === 'tasks'/);
  assert.doesNotMatch(mainSource, /state\.admin\.activeTab === 'credits'/);
  assert.match(mainSource, /projectSummaryText\(project\)/);
  assert.doesNotMatch(mainSource, /toggleProjectExpansion\(project\)/);
  assert.doesNotMatch(mainSource, /展开摘要和详情/);
  assert.match(mainSource, /class="project-expanded-detail"/);
  assert.match(mainSource, /projectCreatorLabel\(project\)/);
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
  assert.match(mainSource, /projectStageTone\(project\)/);
  assert.match(mainSource, /class="project-stage-chip"/);
  assert.match(mainSource, /class="project-funding-chip"/);
  assert.match(mainSource, /team_status\?\.sponsor_count/);
  assert.match(mainSource, /projectStartupText\(project\)/);
  assert.match(mainSource, /interactionButtonActive\('like', project\)/);
  assert.match(mainSource, /interactionButtonActive\('participation', project\)/);
  assert.match(mainSource, /interactionButtonActive\('lead', project\)/);
  assert.match(mainSource, /interactionButtonActive\('paper', project\)/);
  assert.match(mainSource, /interactionButtonActive\('sponsor', project,\s*'compute'\)/);
  assert.match(mainSource, /interactionButtonActive\('sponsor', project,\s*'labor_fee'\)/);
  assert.match(mainSource, /function isPlatformAdminUser\(\)/);
  assert.doesNotMatch(mainSource, /v-if="canUseCollaborationCta\(\)"/);
  assert.match(mainSource, />thumb_up<\/span>/);
  assert.match(mainSource, />star<\/span>/);
  assert.match(mainSource, />groups<\/span>/);
  assert.match(mainSource, />supervisor_account<\/span>/);
  assert.match(mainSource, />workspace_premium<\/span>/);
  assert.match(mainSource, />volunteer_activism<\/span>/);
  assert.match(mainSource, /@click\.stop="submitLike\(project\)"[\s\S]*?@click\.stop="toggleFollow\(project\)"[\s\S]*?@click\.stop="handleParticipationAction\(project\)"[\s\S]*?@click\.stop="submitLeadClaim\(project,\s*\$event\)"[\s\S]*?@click\.stop="submitPaperClaim\(project,\s*\$event\)"[\s\S]*?@click\.stop="openSponsorModal\(project,\s*'compute',\s*\$event\)"[\s\S]*?@click\.stop="openSponsorModal\(project,\s*'labor_fee',\s*\$event\)"/);
  assert.match(mainSource, /followButtonLabel\(project\)/);
  assert.match(mainSource, /leadClaimButtonLabel\(project\)/);
  assert.match(mainSource, /认领项目负责人/);
  assert.match(mainSource, /项目负责人审批中/);
  assert.match(mainSource, /认领第一单位/);
  assert.doesNotMatch(mainSource, />Lead</);
  assert.match(mainSource, /sponsorButtonLabel\(project,\s*'compute'\)/);
  assert.match(mainSource, /sponsorButtonLabel\(project,\s*'labor_fee'\)/);
  assert.match(mainSource, />招募<\/strong>/);
  assert.match(mainSource, />启动<\/strong>/);
  assert.match(mainSource, /projectRecruitmentText\(project\)/);
  assert.match(mainSource, /AI博士及以上/);
  assert.match(mainSource, /role\.count }}\/{{ role\.required/);
  assert.match(stylesSource, /\.project-card-top\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/);
  assert.match(stylesSource, /\.project-card-counts\s*\{/);
  assert.match(stylesSource, /\.project-card-side\s*\{/);
  assert.match(stylesSource, /\.project-card-uploader\s*\{/);
  assert.match(stylesSource, /\.project-card-bottom\s*\{/);
  assert.match(stylesSource, /\.project-card-footer\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*space-between;/);
  assert.match(mainSource, /primarySelfRelationLabel\(project\)/);
  assert.match(mainSource, /secondarySelfRelationLabels\(project\)/);
  assert.match(mainSource, /selfRelationSortRank\(project\)/);
  assert.match(mainSource, /SELF_RELATION_PRIORITY = \["claim", "participation", "sponsor"\]/);
  assert.match(mainSource, /project-catalog-card/);
  assert.match(stylesSource, /\.self-relation-corner\s*\{/);
  assert.match(stylesSource, /\.project-card--self-related:hover::before\s*\{[\s\S]*?#d99a18/);
  assert.match(stylesSource, /\.project-status-row\s*\{[\s\S]*?grid-template-columns:\s*38px minmax\(0,\s*1fr\);/);
  assert.match(stylesSource, /\.project-role-chip-row\s*\{[\s\S]*?display:\s*flex;/);
  assert.match(stylesSource, /\.project-interaction-actions\s*\{[\s\S]*?display:\s*grid;[\s\S]*?justify-content:\s*start;/);
  assert.match(stylesSource, /\.project-interaction-actions button\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/);
  assert.match(stylesSource, /\.interaction-icon\s*\{[\s\S]*?font-variation-settings:\s*"FILL" 0/);
  assert.match(stylesSource, /\.interaction-button\.interaction-active \.interaction-icon,[\s\S]*?\.follow-button\.active \.interaction-icon\s*\{[\s\S]*?font-variation-settings:\s*"FILL" 1/);
  assert.match(stylesSource, /\.interaction-button\.interaction-active\s*\{/);
  assert.match(stylesSource, /\.project-card-meta span\.ready\s*\{/);
  assert.match(stylesSource, /\.project-startup-status\.ready > span\s*\{/);
  assert.match(stylesSource, /\.project-role-chip-row > span\.ready\s*\{/);
  assert.doesNotMatch(stylesSource, /\.project-role-chip-row > span\.overfilled\s*\{/);
  assert.match(stylesSource, /\.project-stage-chip\.stage-active\s*\{/);
  assert.match(stylesSource, /\.project-funding-chip\.funded\s*\{/);
  assert.match(stylesSource, /\.project-expanded-detail\s*\{/);
  assert.match(stylesSource, /\.project-pdf-actions\s*\{/);
  assert.match(stylesSource, /\.project-pdf-actions\s*\{[\s\S]*?margin-left:\s*auto;/);
  assert.match(stylesSource, /\.project-meta-row\s*\{/);
  assert.doesNotMatch(stylesSource, /\.project-status-popover\s*\{/);
  assert.doesNotMatch(stylesSource, /\.viewer-status-block\s*\{/);
  assert.doesNotMatch(stylesSource, /\.status-uid-group/);
});

test("legacy duplicated project detail view has been removed", () => {
  assert.doesNotMatch(mainSource, /class="project-action-bar/);
  assert.doesNotMatch(mainSource, /class="detail-stack/);
  assert.doesNotMatch(mainSource, /class="content-panel project-team-panel"/);
  assert.doesNotMatch(mainSource, /目标期刊\/会议/);
  assert.match(mainSource, /function projectStageValue\(project\)\s*\{\s*return project\?\.stage \|\| "";\s*\}\s*function projectStageTone\(project\)[\s\S]*?function projectTeamReady/s);
  assert.doesNotMatch(mainSource, /state\.currentProject/);
  assert.doesNotMatch(mainSource, /<div class="score-panel">/);
  assert.doesNotMatch(mainSource, /<aside class="side-panel">\s*<h2>组队情况<\/h2>/);
  assert.doesNotMatch(mainSource, /<aside class="side-panel">\s*<h2>课题互动<\/h2>/);
  assert.doesNotMatch(stylesSource, /\.project-action-bar\s*\{/);
  assert.doesNotMatch(stylesSource, /\.detail-stack\s*\{/);
  assert.doesNotMatch(stylesSource, /\.project-team-panel \.role-list\s*\{/);
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
  assert.match(mainSource, /bulkProjectActionSubmitting:\s*false/);
  assert.match(mainSource, /bulkProjectStage:\s*"open_recruiting"/);
  assert.match(mainSource, /class="admin-project-toolbar"/);
  assert.match(mainSource, /class="bulk-selection-status"/);
  assert.match(mainSource, /已选 \{\{ state\.admin\.selectedProjectIds\.length \}\} 项/);
  assert.match(mainSource, /function toggleVisibleAdminProjectsSelection\(event\)/);
  assert.match(mainSource, /function bulkArchiveSelectedProjects\(\)/);
  assert.match(mainSource, /function bulkPublishSelectedProjects\(isPublic\)/);
  assert.match(mainSource, /function bulkSetSelectedProjectStage\(\)/);
  assert.match(mainSource, /function bulkDeleteSelectedProjects\(\)/);
  assert.match(mainSource, /function bulkUpdateSelectedProjects\(options\)/);
  assert.match(mainSource, /api\.adminBulkProjectAction\(\{/);
  assert.match(mainSource, /批量归档\(/);
  assert.match(mainSource, />批量公开<\/button>/);
  assert.match(mainSource, />取消公开<\/button>/);
  assert.match(mainSource, />批量设置状态<\/button>/);
  assert.match(mainSource, />批量删除<\/button>/);
  assert.match(mainSource, /确认批量物理删除课题/);
  assert.match(mainSource, /function archiveProject\(project\)/);
  assert.match(mainSource, /api\.adminUpdateProject\(project\.id,\s*\{\s*stage:\s*"archived",\s*is_public:\s*false\s*\}\)/);
  assert.match(mainSource, /function deleteAdminProject\(project\)/);
  assert.match(mainSource, /确认物理删除课题/);
  assert.match(mainSource, /api\.adminDeleteProject\(project\.id\)/);
  assert.match(mainSource, />归档<\/button>/);
  assert.match(mainSource, />删除<\/button>/);
  assert.match(mainSource, /class="admin-table project-admin-table"/);
  assert.match(mainSource, /aria-label="选择当前页全部课题"/);
  assert.match(apiSource, /adminBulkArchiveProjects/);
  assert.match(apiSource, /\/api\/admin\/projects\/bulk-archive\//);
  assert.match(apiSource, /adminBulkProjectAction/);
  assert.match(apiSource, /\/api\/admin\/projects\/bulk-action\//);
  assert.match(stylesSource, /\.admin-project-toolbar\s*\{/);
  assert.match(stylesSource, /\.bulk-selection-status\s*\{/);
  assert.match(stylesSource, /\.project-admin-table \.admin-table-head,\s*\.project-admin-table \.admin-table-row\s*\{/);
  assert.match(stylesSource, /\.admin-select-cell\s*\{/);
});

test("admin application approval keeps only interaction review in the approval panel", () => {
  assert.match(mainSource, />申请审批<\/button>/);
  assert.doesNotMatch(mainSource, />任务审批<\/button>/);
  assert.doesNotMatch(mainSource, />协作管理<\/button>/);
  assert.doesNotMatch(mainSource, />协作审核<\/button>/);
  assert.doesNotMatch(mainSource, /组队看板/);
  assert.doesNotMatch(mainSource, /已审核项目状态/);
  assert.match(mainSource, />任务管理<\/button>/);
  assert.doesNotMatch(mainSource, /prepareTaskForProject\(group\.project\)/);
  assert.doesNotMatch(mainSource, /reviewInteraction\(item,\s*'recorded'\)/);
  assert.doesNotMatch(mainSource.match(/function reviewInteraction\(item,\s*status,\s*event = null\)[\s\S]*?\n    \}/)?.[0] || "", /window\.prompt/);
  assert.match(mainSource, /function openReviewModal\(item,\s*status,\s*event = null\)/);
  assert.match(mainSource, /function loadReviewContext\(item\)/);
  assert.match(mainSource, /function reviewContextSummary\(\)/);
  assert.match(mainSource, /class="review-context-panel"/);
  assert.match(mainSource, /审批上下文/);
  assert.match(mainSource, /function submitReviewModal\(\)/);
  assert.match(mainSource, /拒绝申请时必须填写审核意见/);
  assert.match(mainSource, /data-testid="admin-review-modal"/);
  assert.match(mainSource, /:data-testid="item\.isSponsorGroup \? 'admin-sponsor-group' : null"/);
  assert.match(mainSource, /reviewModalRef/);
  assert.match(stylesSource, /\.collaboration-management\s*\{/);
  assert.match(stylesSource, /\.collaboration-grid\.single-column\s*\{/);
  assert.match(stylesSource, /\.review-modal-backdrop\s*\{/);
  assert.match(stylesSource, /\.review-modal\s*\{/);
  assert.match(stylesSource, /\.review-modal-grid\s*\{/);
  assert.match(stylesSource, /\.review-context-panel\s*\{/);
  assert.match(stylesSource, /\.sponsor-intent-group\s*\{/);
});

test("project lifecycle actions are gated by project stage and review status", () => {
  assert.match(mainSource, /const FOLLOWABLE_STAGE_VALUES = new Set\(\["open_recruiting", "team_building", "active"\]\)/);
  assert.match(mainSource, /const RECRUITING_STAGE_VALUES = new Set\(\["open_recruiting", "team_building"\]\)/);
  assert.match(mainSource, /v-if="shouldShowFollowButton\(project\)"/);
  assert.doesNotMatch(mainSource, /state\.currentProject/);
  assert.match(mainSource, /当前阶段暂不接受新的参与/);
  assert.match(mainSource, /handleParticipationAction\(project\)/);
  assert.match(mainSource, /取消点赞/);
  assert.match(mainSource, /取消关注/);
  assert.match(mainSource, /function isLeadClaimed\(project\)/);
  assert.match(mainSource, /claim_types/);
  assert.match(mainSource, /function canClickLeadClaim\(project\)/);
  assert.match(mainSource, /claim_availability/);
  assert.match(mainSource, /claim-reason-tooltip/);
  assert.match(mainSource, /该课题已有\$\{label\}申请或已通过\$\{label\}/);
  assert.match(mainSource, /claimRequestsByProjectId:\s*\{\}/);
  assert.match(mainSource, /function withdrawLeadClaim\(project\)/);
  assert.match(mainSource, /api\.withdrawInteraction\("claim",\s*request\.id/);
  assert.match(mainSource, /function isClaimPending\(request\)/);
  assert.match(mainSource, /function isClaimApproved\(request\)/);
  assert.match(mainSource, /async function withdrawLeadClaim\(project\)[\s\S]*?!request\?\.id \|\| !isClaimApproved\(request\)/);
  assert.match(mainSource, /async function withdrawPaperClaim\(project\)[\s\S]*?!request\?\.id \|\| !isClaimApproved\(request\)/);
  assert.match(mainSource, /function claimRequestFromAvailability\(project,\s*claimType\)/);
  assert.match(mainSource, /function hasClaimAvailability\(project,\s*claimType\)/);
  assert.match(mainSource, /own_interaction_id/);
  assert.match(mainSource, /syncProjectClaimAvailability\(project\)/);
  assert.match(mainSource, /applyProjectClaimAvailability\(item,\s*savedClaim\)/);
  assert.match(mainSource, /reason_code:\s*"own_pending"/);
  assert.match(mainSource, /reason_code:\s*"own_approved"/);
  assert.match(mainSource, /if \(action === "pending"\)[\s\S]*?showClaimUnavailableFeedback\(event,\s*project,\s*"leader"\)/);
  assert.match(mainSource, /if \(action === "pending"\)[\s\S]*?showClaimUnavailableFeedback\(event,\s*project,\s*"paper_first_unit"\)/);
  assert.match(mainSource, /项目负责人审批中/);
  assert.match(mainSource, /第一单位认领审批中/);
  assert.match(mainSource, /撤回项目负责人认领/);
  assert.match(mainSource, /已撤回项目负责人认领/);
  assert.match(mainSource, /撤回论文第一单位认领/);
  assert.doesNotMatch(mainSource, /撤回第一单位/);
  assert.match(mainSource, /function markProjectLeadClaimWithdrawn\(project/);
  assert.match(mainSource, /async function openSponsorModal\(project,\s*sponsorType,\s*event = null,\s*options = \{\}\)/);
  assert.match(mainSource, /QUICK_SPONSOR_TYPES = \["compute", "labor_fee"\]/);
  assert.doesNotMatch(mainSource, /v-model="state\.forms\.sponsor\.sponsor_types"/);
  assert.match(mainSource, /class="sponsor-popover"/);
  assert.match(mainSource, /aria-controls="sponsor-popover"/);
  assert.match(mainSource, /aria-expanded/);
  assert.match(mainSource, /管理资助算力/);
  assert.match(mainSource, /管理资助劳务/);
  assert.match(mainSource, /资助金额\/算力情况/);
  assert.match(mainSource, /sponsorRequestByType\(state\.sponsorModal\.project,\s*state\.forms\.sponsor\.sponsor_type\)/);
  assert.match(mainSource, /withdrawSponsorRequest\(state\.sponsorModal\.project,\s*sponsorRequestByType\(state\.sponsorModal\.project,\s*state\.forms\.sponsor\.sponsor_type\)\)/);
  assert.match(mainSource, /isWithdrawingSponsor,/);
  assert.match(mainSource, /isSponsorTypeActive\(state\.sponsorModal\.project,\s*state\.forms\.sponsor\.sponsor_type\)/);
  assert.match(mainSource, /confirmText:\s*`撤回\$\{sponsorTypeButtonLabel\(targetRequest\.sponsor_type\)\}`/);
  assert.doesNotMatch(mainSource, /requestsToWithdraw/);
  assert.match(stylesSource, /\.sponsor-popover \.sponsor-withdraw-button\.ghost-button\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?height:\s*auto;/);
  assert.doesNotMatch(mainSource, /<select v-model="state\.forms\.sponsor\.sponsor_type"/);
  assert.doesNotMatch(mainSource, /extra_type/);
  assert.doesNotMatch(mainSource, /async function submitParticipationRequest\(project\)[\s\S]*?await loadProjects\(\{ reset: true \}\);[\s\S]*?async function handleParticipationAction/);
  assert.doesNotMatch(mainSource, /async function submitLeadClaim\(project\)[\s\S]*?await loadProjects\(\{ reset: true \}\);[\s\S]*?async function submitSponsor/);
  assert.doesNotMatch(mainSource, /async function openSponsorModal\(project[\s\S]*?await loadProjects\(\{ reset: true \}\);[\s\S]*?async function withdrawSponsorRequest/);
  assert.match(mainSource, /api\.withdrawInteraction\("sponsor",\s*targetRequest\.id/);
  assert.match(mainSource, /撤回资助/);
  assert.match(mainSource, /function withdrawParticipationRequest\(project\)/);
  assert.match(mainSource, /api\.withdrawInteraction\("interest",\s*request\.id/);
  assert.match(mainSource, /取消参与/);
  assert.match(mainSource, /function refreshProjectStatus\(project\)/);
  assert.match(mainSource, /api\.projectStatusCard\(id\)/);
  assert.match(mainSource, /const SPONSOR_POPOVER_HEIGHT = 420;/);
  assert.match(mainSource, /function sponsorPopoverPositionFromTrigger\(trigger,\s*popoverSize = \{\}\)/);
  assert.match(mainSource, /function realignSponsorPopoverFromRenderedSize\(trigger = state\.sponsorModal\.returnFocus\)/);
  assert.match(mainSource, /document\.querySelector\("\.sponsor-popover"\)\?\.getBoundingClientRect\?\.\(\)/);
  assert.match(mainSource, /width:\s*popoverRect\.width,[\s\S]*?height:\s*popoverRect\.height/);
  assert.match(mainSource, /sponsorPopoverPositionFromTrigger\(trigger,\s*renderedSize\)/);
  assert.match(mainSource, /realignSponsorPopoverFromRenderedSize\(state\.sponsorModal\.returnFocus\);[\s\S]*?document\.querySelector\("\.sponsor-popover textarea:not\(:disabled\), \.sponsor-popover \.sponsor-withdraw-button:not\(:disabled\)"\)\?\.focus\(\);/);
  assert.match(mainSource, /function handleSponsorPopoverViewportChange\(\)[\s\S]*?realignSponsorPopoverFromRenderedSize\(\)/);
  assert.match(mainSource, /window\.addEventListener\("resize",\s*handleSponsorPopoverViewportChange\)/);
  assert.match(mainSource, /window\.removeEventListener\("resize",\s*handleSponsorPopoverViewportChange\)/);
  assert.match(mainSource, /await refreshProjectStatus\(project\)/);
  assert.match(mainSource, /if \(roleType === "phd_or_above"\) return "大学老师";/);
  assert.match(mainSource, /function participationRoleForCurrentUser\(\)[\s\S]*?return "学生";[\s\S]*?function markProjectInterestSubmitted/);
  assert.match(mainSource, /async function submitLeadClaim\(project,\s*event = null\)[\s\S]*?await refreshProjectStatus\(project\);[\s\S]*?async function withdrawLeadClaim/);
  assert.match(mainSource, /async function withdrawLeadClaim\(project\)[\s\S]*?await refreshProjectStatus\(project\);[\s\S]*?async function submitPaperClaim/);
  assert.doesNotMatch(mainSource, /async function withdrawParticipationRequest\(project\)[\s\S]*?openConfirmDialog[\s\S]*?async function submitLeadClaim/);
  assert.match(mainSource, /重新提交申请/);
  assert.match(mainSource, /重新提交资助/);
  assert.match(mainSource, /handleApplicationAction\(row,\s*event = null\)/);
  assert.match(mainSource, /openSponsorModal\(row\.project,\s*row\.sponsor_type,\s*event,/);
  assert.match(mainSource, /previousReviewComment:\s*row\.review_comment/);
  assert.doesNotMatch(mainSource, /重新点赞/);
  assert.match(mainSource, /v-if="canReviewInteraction\(item\)"/);
  assert.match(mainSource, /只有待处理申请可以审核/);
  assert.match(mainSource, /拟认领第一单位/);
  assert.match(mainSource, /请填写拟认领的论文第一单位。/);
  assert.match(mainSource, /申请说明/);
  assert.match(mainSource, /负责人职责说明/);
  assert.match(mainSource, /state\.forms\.sponsor\.previous_review_comment/);
  assert.match(mainSource, /上次审核意见：/);
  assert.match(mainSource, /claimed_unit_name/);
  assert.match(mainSource, /state\.paperClaimRequestsByProjectId = \{\}/);
  assert.match(mainSource, /state\.forms\.leadClaim/);
  assert.match(mainSource, /closeSponsorModal\(\)/);
  assert.match(mainSource, /closePaperClaimModal\(\)/);
});

test("task management reuses existing project patch flows for stage changes", () => {
  assert.match(mainSource, /updateTaskProjectStage\(state\.admin\.taskProjectDetail\.project,\s*'active'\)/);
  assert.match(mainSource, /updateTaskProjectStage\(state\.admin\.taskProjectDetail\.project,\s*'paused'\)/);
  assert.match(mainSource, /updateTaskProjectStage\(state\.admin\.taskProjectDetail\.project,\s*'archived'\)/);
  assert.match(mainSource, /const payload = \{ stage \};[\s\S]*?if \(stage === "archived"\) \{[\s\S]*?payload\.is_public = false;/);
  assert.match(mainSource, /api\.adminUpdateProject\(project\.id,\s*payload\)/);
  assert.doesNotMatch(mainSource, /is_public:\s*stage !== "archived"/);
  assert.doesNotMatch(apiSource, /\b(publishProject|startProject|pauseProject|archiveProject)\b/);
});

test("admin archive stage changes do not show confirmation dialogs", () => {
  assert.doesNotMatch(
    mainSource,
    /async function updateAdminProjectStage\(project,\s*stage,\s*event = null\)[\s\S]*?openConfirmDialog\(\{[\s\S]*?确认归档课题[\s\S]*?const payload = \{ stage \};/
  );
  assert.match(mainSource, /async function archiveProject\(project\)[\s\S]*?api\.adminUpdateProject\(project\.id,\s*\{\s*stage:\s*"archived",\s*is_public:\s*false\s*\}\)/);
  assert.match(mainSource, /async function deleteAdminProject\(project\)[\s\S]*?openConfirmDialog\(\{[\s\S]*?确认物理删除课题/);
});

test("project cards no longer keep hover status-card state after lifecycle writes", () => {
  assert.doesNotMatch(mainSource, /state\.projectStatusCards/);
  assert.doesNotMatch(mainSource, /课题状态读取失败/);
  assert.doesNotMatch(mainSource, /uid_groups:\s*\{\s*uids_visible:\s*false,\s*groups:\s*\[\]\s*\}/);
  assert.match(mainSource, /async function fetchProjectApprovedInteractions\(project\)[\s\S]*?api\.projectStatusCard\(project\.id\)/);
  assert.match(mainSource, /\["interest",\s*"claim",\s*"sponsor"\]\.includes\(group\.type\)/);
  assert.match(mainSource, /group\.status === "approved"/);
  assert.match(mainSource, /已获批资助/);
  assert.match(mainSource, /function invalidateProjectStatusCard\(projectId = null\)/);
  assert.match(mainSource, /delete state\.projectStatusCardCache\[projectId\]/);
  assert.match(mainSource, /state\.projectStatusCardCache = \{\}/);
  assert.match(mainSource, /invalidateProjectStatusCard\(item\.project\?\.id\)/);
  assert.match(mainSource, /invalidateProjectStatusCard\(project\.id\)/);
});

test("platform admin sees sponsor buttons disabled with sponsor-specific hover reason", () => {
  assert.match(mainSource, /function platformAdminSponsorReason\(\)/);
  assert.match(mainSource, /系统管理员不能资助项目/);
  assert.match(mainSource, /function sponsorButtonAriaDisabled\(project,\s*sponsorType\)/);
  assert.match(mainSource, /function sponsorButtonDisabledReason\(project,\s*sponsorType\)/);
  assert.match(mainSource, /isPlatformAdminUser\(\)[\s\S]*?platformAdminSponsorReason\(\)/);
  assert.match(mainSource, /'is-disabled':\s*!canClickSponsor\(project,\s*'compute'\)/);
  assert.match(mainSource, /:aria-disabled="sponsorButtonAriaDisabled\(project,\s*'compute'\)"/);
  assert.match(mainSource, /@mouseenter="showSponsorContactCard\(\$event,\s*project,\s*'compute'\)"/);
  assert.match(mainSource, /@click\.stop="openSponsorModal\(project,\s*'compute',\s*\$event\)"/);
  assert.match(mainSource, /showContactHoverCard\(event,\s*sponsorTypeButtonLabel\(sponsorType\),\s*\[[\s\S]*?platformAdminSponsorReason\(\)/);
});

test("project contact hover cards are fixed viewport-safe overlays", () => {
  assert.match(mainSource, /contactHoverCard:\s*\{[\s\S]*?visible:\s*false/);
  assert.match(mainSource, /class="contact-hover-card floating-contact-card"/);
  assert.match(mainSource, /data-testid="floating-contact-card"/);
  assert.match(mainSource, /function showTeamContactCard\(event,\s*role,\s*project\)/);
  assert.match(mainSource, /async function showSponsorContactCard\(event,\s*project,\s*sponsorType\)/);
  assert.match(mainSource, /contactDetailText\(member\)/);
  assert.match(mainSource, /sponsorContactMembers\(groups,\s*sponsorType\)/);
  assert.match(mainSource, /flatMap\(\(group\)\s*=>\s*group\.members/);
  assert.match(mainSource, /detail:\s*contactWechatText\(member\)/);
  assert.match(mainSource, /name:\s*member\.uid/);
  assert.match(mainSource, /Math\.min\(maxY,\s*Math\.max\(12,\s*rect\.bottom \+ 8\)\)/);
  assert.doesNotMatch(mainSource, /class="contact-hover-card team-contact-card"/);
  assert.doesNotMatch(mainSource, /class="contact-hover-card creator-contact-card"/);
  assert.match(stylesSource, /\.contact-hover-card\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*860;[\s\S]*?max-height:\s*min\(320px,\s*calc\(100dvh - 24px\)\);/);
  assert.doesNotMatch(stylesSource, /\.contact-hover-trigger:hover\s*>\s*\.contact-hover-card/);
  assert.doesNotMatch(stylesSource, /\.project-role-chip-row \.team-contact-card/);
});

test("project progress page exposes the same core interaction actions as project cards", () => {
  assert.match(mainSource, /class="project-progress-actions project-interaction-actions"/);
  assert.match(mainSource, /submitLike\(state\.projectProgress\.project\)/);
  assert.match(mainSource, /toggleFollow\(state\.projectProgress\.project\)/);
  assert.match(mainSource, /handleParticipationAction\(state\.projectProgress\.project\)/);
  assert.match(mainSource, /submitLeadClaim\(state\.projectProgress\.project,\s*\$event\)/);
  assert.match(mainSource, /submitPaperClaim\(state\.projectProgress\.project,\s*\$event\)/);
  assert.match(mainSource, /openSponsorModal\(state\.projectProgress\.project,\s*'compute',\s*\$event\)/);
  assert.match(mainSource, /openSponsorModal\(state\.projectProgress\.project,\s*'labor_fee',\s*\$event\)/);
});

test("claim reason controls remain focusable when unavailable", () => {
  assert.doesNotMatch(mainSource, /:disabled="!canClickLeadClaim\(project\)"/);
  assert.doesNotMatch(mainSource, /:disabled="!canClickPaperClaim\(project\)"/);
  assert.match(mainSource, /'is-disabled': !canClickLeadClaim\(project\)/);
  assert.match(mainSource, /'is-disabled': !canClickPaperClaim\(project\)/);
});

test("task result submission supports documents without admin review actions", () => {
  assert.match(mainSource, />任务管理<\/button>/);
  assert.match(mainSource, /<h2>任务管理<\/h2>/);
  assert.match(apiSource, /createMeContributionWithFile:\s*\(formData\)\s*=>\s*requestForm\("\/api\/me\/contributions\/upload\/",\s*formData\)/);
  assert.match(mainSource, /function setContributionFile\(event\)/);
  assert.match(mainSource, /api\.createMeContributionWithFile\(formData\)/);
  assert.match(mainSource, /结果文档（PDF\/Markdown，可选）/);
  assert.match(mainSource, /function contributionFileHref\(contribution\)/);
  assert.match(mainSource, />查看文档<\/a>/);
  assert.doesNotMatch(mainSource, /v-if="item\.status === 'submitted'"/);
  assert.doesNotMatch(mainSource, /填写审核评语/);
  assert.doesNotMatch(mainSource, /reviewContribution\(item,\s*'approved'\)/);
  assert.doesNotMatch(mainSource, /reviewContribution\(item,\s*'rejected'\)/);
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
  assert.match(mainSource, /导入课题目录/);
  assert.match(mainSource, /chooseJsonImportDirectory/);
  assert.match(mainSource, /chooseJsonImportMixedFiles/);
  assert.match(mainSource, /directoryInputSupportsFolders/);
  assert.match(mainSource, /webkitdirectory" in input/);
  assert.match(mainSource, /已改为选择目录内 JSON\/PDF 文件/);
  assert.match(mainSource, /showDirectoryPicker/);
  assert.match(mainSource, /jsonImportJsonFilesInput/);
  assert.match(mainSource, /jsonImportDirectoryInput/);
  assert.match(mainSource, /jsonImportMixedFilesInput/);
  assert.match(mainSource, /ref="jsonImportJsonFilesInput"[\s\S]*?accept="\.json,application\/json"/);
  assert.match(mainSource, /选择目录内 JSON\/PDF 文件/);
  assert.match(mainSource, /Linux 文件夹选择不可用时/);
  assert.match(mainSource, /visually-hidden-file-input/);
  assert.doesNotMatch(mainSource, /webkitdirectory directory multiple/);
  assert.doesNotMatch(stylesSource, /\.json-import-picker input\s*\{[\s\S]*?inset:\s*0;[\s\S]*?opacity:\s*0;/);
  assert.match(stylesSource, /\.visually-hidden-file-input\s*\{/);
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

test("admin project list loads every matching project page at once", () => {
  assert.match(mainSource, /const ADMIN_PROJECT_PAGE_SIZE = 100/);
  assert.match(mainSource, /projectFilters:\s*\{ q:\s*"", theme:\s*"", page:\s*1, page_size:\s*ADMIN_PROJECT_PAGE_SIZE \}/);
  assert.match(mainSource, /async function fetchAllAdminProjectPages\(params = \{\}\)/);
  assert.match(mainSource, /const data = await fetchAllAdminProjectPages\(state\.admin\.projectFilters\)/);
  assert.match(mainSource, /has_next:\s*false/);
  assert.match(mainSource, /已显示全部筛选结果/);
  assert.doesNotMatch(mainSource, /loadMoreAdminProjects/);
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
  assert.match(mainSource, /title:\s*"个人资料"/);
  assert.match(mainSource, /class="content-panel admin-overview-card workspace-overview-card"/);
  assert.match(mainSource, /@click="setWorkspaceTab\(card\.tab\)"/);
  assert.match(stylesSource, /\.workspace-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(150px,\s*1fr\)\);/);
  assert.match(stylesSource, /@media \(max-width:\s*980px\)\s*\{[\s\S]*?\.workspace-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.workspace-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(stylesSource, /\.workspace-overview-card\s*\{/);
  assert.match(stylesSource, /\.admin-overview-card:hover\s*\{[\s\S]*?scale\(1\.02\)/);
});

test("user uploaded projects can be edited while archived projects stay locked", () => {
  assert.match(mainSource, /function canEditMyProject\(project\)[\s\S]*?project\?\.stage !== "archived"/);
  assert.match(mainSource, /v-if="canEditMyProject\(project\)"/);
  assert.match(mainSource, /function myProjectStageEditable\(project\)[\s\S]*?\["draft",\s*"open_recruiting"\]\.includes\(project\?\.stage\)/);
  assert.match(mainSource, /lockedStageProjectPayload/);
  assert.match(mainSource, /保存修改/);
  assert.match(mainSource, /function resetUserProjectState\(\)[\s\S]*?state\.myProjects = \[\];/);
  assert.match(mainSource, /function resetUserProjectState\(\)[\s\S]*?state\.myProjectPagination = \{\};/);
  assert.match(mainSource, /function resetUserProjectState\(\)[\s\S]*?state\.myProjectQuota = \{ daily_limit: 10, used_today: 0, remaining: 10, unlimited: false \};/);
});

test("business modals use an explicit z-index scale and close competing overlays", () => {
  assert.match(mainSource, /function closeMutuallyExclusiveModals\(next = ""\)/);
  assert.match(mainSource, /closeMutuallyExclusiveModals\("contribution"\)/);
  assert.match(mainSource, /closeMutuallyExclusiveModals\("taskProjectDetail"\)/);
  assert.match(mainSource, /closeMutuallyExclusiveModals\("projectForm"\)/);
  assert.match(mainSource, /closeMutuallyExclusiveModals\("myProjectForm"\)/);
  assert.match(stylesSource, /\.toast\s*\{[\s\S]*?z-index:\s*950;/);
  assert.doesNotMatch(stylesSource, /\.project-modal-backdrop\s*\{/);
  assert.match(stylesSource, /\.project-form-modal\s*\{[\s\S]*?z-index:\s*300;/);
  assert.match(stylesSource, /\.task-result-modal,\s*\.task-detail-modal\s*\{[\s\S]*?z-index:\s*320;/);
  assert.match(stylesSource, /\.confirm-modal-backdrop\s*\{[\s\S]*?z-index:\s*900;/);
  assert.match(indexSource, new RegExp(`href="/src/styles\\.css\\?v=${packageJson.version}(?:-[^"]+)?"`));
  assert.match(indexSource, new RegExp(`src="/src/main\\.js\\?v=${packageJson.version}(?:-[^"]+)?"`));
});

test("modal accessibility hooks keep focus inside dialogs and restore triggers", () => {
  assert.match(mainSource, /const confirmDialogRef = ref\(null\)/);
  assert.match(mainSource, /let lastModalTrigger = null/);
  assert.match(mainSource, /function focusFirstModalControl\(modalRef\)/);
  assert.match(mainSource, /function trapModalFocus\(event, modalRef\)/);
  assert.match(mainSource, /function restoreLastModalTrigger\(\)/);
  assert.match(mainSource, /ref="confirmDialogRef"[\s\S]*?@keydown="trapModalFocus\(\$event, confirmDialogRef\)"/);
  assert.match(mainSource, /ref="participationModalRef"[\s\S]*?@keydown="trapModalFocus\(\$event, participationModalRef\)"/);
  assert.match(mainSource, /ref="leadClaimModalRef"[\s\S]*?@keydown="trapModalFocus\(\$event, leadClaimModalRef\)"/);
  assert.match(mainSource, /ref="paperClaimModalRef"[\s\S]*?@keydown="trapModalFocus\(\$event, paperClaimModalRef\)"/);
  assert.match(mainSource, /ref="sponsorModalRef"[\s\S]*?@keydown="trapModalFocus\(\$event, sponsorModalRef\)"/);
  assert.match(mainSource, /ref="reviewModalRef"[\s\S]*?@keydown="trapModalFocus\(\$event, reviewModalRef\)"/);
  assert.match(mainSource, /ref="contributionModalRef"[\s\S]*?@keydown="trapModalFocus\(\$event, contributionModalRef\)"/);
});

test("visual e2e hooks and decorative icon semantics are present", () => {
  assert.match(mainSource, /data-testid="project-card"/);
  assert.match(mainSource, /data-testid="relation-corner-ribbon"/);
  assert.match(mainSource, /data-testid="my-relation-chip"/);
  assert.match(mainSource, /data-testid="project-topic-chip"/);
  assert.match(mainSource, /data-testid="project-meta-row"/);
  assert.match(mainSource, /data-testid="project-title-link"/);
  assert.match(mainSource, /data-testid="project-status-strip"/);
  assert.match(mainSource, /data-testid="sponsor-popover"/);
  assert.match(mainSource, /data-testid="claim-reason-tooltip"/);
  assert.doesNotMatch(mainSource, /<span class="material-symbols-rounded"(?![^>]*aria-hidden)/);
});

test("small-screen controls keep touch targets and avoid duplicate theme controls", () => {
  assert.match(mainSource, /class="filter-group optional-mobile"/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.topbar\s*\{[\s\S]*?gap:\s*8px;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.toolbar \.filter-group\.optional-mobile\s*\{[\s\S]*?display:\s*none;/);
  assert.match(stylesSource, /\.checkbox-chip\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.topic-theme-strip\.single-row\s*\{[\s\S]*?margin-top:\s*8px;/);
});

test("sponsor modal uses two independent main-flow types without token checkbox flow", () => {
  assert.match(mainSource, /const QUICK_SPONSOR_TYPES = \["compute",\s*"labor_fee"\]/);
  assert.doesNotMatch(mainSource, /moreSponsorTypeOptions/);
  assert.doesNotMatch(mainSource, /更多资助类型/);
  assert.doesNotMatch(mainSource, /state\.forms\.sponsor\.show_more_types/);
  assert.doesNotMatch(mainSource, /sponsorPopoverTypes = \[\.\.\.QUICK_SPONSOR_TYPES,\s*"token"\]/);
  assert.doesNotMatch(stylesSource, /\.sponsor-more-toggle\s*\{/);
  assert.match(mainSource, /openSponsorModal\(row\.project,\s*row\.sponsor_type,\s*event,/);
  assert.match(mainSource, /if \(!QUICK_SPONSOR_TYPES\.includes\(row\.sponsor_type\)\)\s*\{[\s\S]*?navigate\("project",\s*\{ id: row\.project\?\.id \}\);[\s\S]*?return;[\s\S]*?\}/);
});

test("legacy approved-project handoff helpers are not returned as product entry points", () => {
  assert.doesNotMatch(mainSource, /const approvedInteractionGroups = computed/);
  assert.doesNotMatch(mainSource, /function loadApprovedInteractions\(/);
  assert.doesNotMatch(mainSource, /function updateApprovedProjectStage\(/);
  assert.doesNotMatch(mainSource, /function archiveApprovedProject\(/);
  assert.doesNotMatch(mainSource, /window\.confirm\(`确认归档课题/);
});
