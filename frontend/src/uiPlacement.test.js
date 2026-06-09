import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainSource = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

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

test("homepage hero title uses the campaign copy with hover and scroll motion guards", () => {
  assert.match(mainSource, /让医学问题，/);
  assert.match(mainSource, /等到它的盖世英雄/);
  assert.match(mainSource, /const heroTitleStyle = computed/);
  assert.match(mainSource, /function updateHeroTitleScrollProgress\(\)/);
  assert.match(mainSource, /"--hero-title-opacity": \(1 - progress \* 0\.72\)\.toFixed\(3\)/);
  assert.match(stylesSource, /\.library-hero \.hero-title\s*\{[\s\S]*?display:\s*block;/);
  assert.match(stylesSource, /\.library-hero \.hero-title:hover\s*\{[\s\S]*?scale\(1\.022\)/);
  assert.match(stylesSource, /\.library-hero \.hero-title\s*\{[\s\S]*?mask-image:\s*linear-gradient/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.library-hero \.hero-title\s*\{[\s\S]*?transition:\s*none;/);
});

test("homepage search toolbar is lifted and visually emphasized", () => {
  assert.match(stylesSource, /\.toolbar\s*\{[\s\S]*?margin:\s*-4px 0 22px;[\s\S]*?padding:\s*16px;[\s\S]*?border-radius:\s*12px;/);
  assert.match(stylesSource, /\.toolbar input,\s*\.toolbar select\s*\{[\s\S]*?min-height:\s*46px;[\s\S]*?border-radius:\s*10px;/);
  assert.match(stylesSource, /\.toolbar \.primary-button\s*\{[\s\S]*?min-height:\s*58px;[\s\S]*?border-radius:\s*10px;/);
});

test("workspace lifecycle UI exposes user/admin spaces and project status hover card", () => {
  assert.match(mainSource, /label:\s*"我的空间"/);
  assert.match(mainSource, /workspace-tabs/);
  assert.match(mainSource, /我的任务/);
  assert.match(mainSource, /我的贡献/);
  assert.match(mainSource, /积分流水/);
  assert.match(mainSource, /state\.admin\.activeTab === 'overview'/);
  assert.match(mainSource, /state\.admin\.activeTab === 'interactions'/);
  assert.match(mainSource, /state\.admin\.activeTab === 'tasks'/);
  assert.match(mainSource, /state\.admin\.activeTab === 'contributions'/);
  assert.match(mainSource, /state\.admin\.activeTab === 'audit'/);
  assert.match(mainSource, /project-status-popover/);
  assert.match(mainSource, /openProjectStatusCard\(project\)/);
  assert.match(stylesSource, /\.project-status-popover\s*\{/);
  assert.match(stylesSource, /\.workspace-tabs\s*\{/);
});

test("project status hover card separates personal labels from highlighted status uids", () => {
  assert.match(mainSource, /我的状态/);
  assert.match(mainSource, /viewerStatusLabelsFor\(project\)/);
  assert.match(mainSource, /statusUidListFor\(project\)/);
  assert.match(mainSource, /statusHighlightUidFor\(project\)/);
  assert.doesNotMatch(mainSource, /<strong>\{\{ viewerUidFor\(project\)/);
  assert.doesNotMatch(mainSource, /相关 UID/);
  assert.doesNotMatch(mainSource, /UID \{\{ statusUidCountFor\(project\) \}\} 个/);
  assert.match(stylesSource, /\.viewer-status-block\s*\{/);
  assert.match(stylesSource, /\.uid-strip span\.highlighted\s*\{/);
});

test("project status hover card stays inside the project card instead of being clipped", () => {
  assert.match(stylesSource, /\.project-card\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.doesNotMatch(stylesSource, /\.project-status-popover\s*\{[\s\S]*?top:\s*calc\(100% - 8px\);/);
  assert.match(stylesSource, /\.project-status-popover\s*\{[\s\S]*?top:\s*18px;/);
  assert.match(stylesSource, /\.project-status-popover\s*\{[\s\S]*?max-height:\s*min\(260px,\s*calc\(100% - 36px\)\);/);
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

test("admin collaboration management exposes review and approved project task handoff", () => {
  assert.match(mainSource, />协作管理<\/button>/);
  assert.doesNotMatch(mainSource, />协作审核<\/button>/);
  assert.match(mainSource, /approvedInteractionGroups/);
  assert.match(mainSource, /loadApprovedInteractions/);
  assert.match(mainSource, /审核后任务管理/);
  assert.match(mainSource, /已审核项目状态/);
  assert.match(mainSource, /prepareTaskForProject\(group\.project\)/);
  assert.match(stylesSource, /\.collaboration-management\s*\{/);
  assert.match(stylesSource, /\.approved-project-row\s*\{/);
});

test("task rows expose progress and participant uids only", () => {
  assert.match(mainSource, /taskProgressLabel\(task\)/);
  assert.match(mainSource, /taskParticipantUids\(task\)/);
  assert.match(mainSource, /参与 UID/);
  assert.match(mainSource, /task\.assignee_uid \|\| taskParticipantUids\(task\)\[0\]/);
  assert.doesNotMatch(mainSource, /task\.assignee\?\.username/);
  assert.doesNotMatch(mainSource, /task\.assignee\?\.profile\?\.uid/);
});

test("workspace lifecycle people fields render uid-only payloads", () => {
  assert.match(mainSource, /item\.user\.uid/);
  assert.match(mainSource, /entry\.user\.uid/);
  assert.match(mainSource, /entry\?\.actor\?\.uid/);
  assert.doesNotMatch(mainSource, /item\.user\.profile\?\.uid/);
  assert.doesNotMatch(mainSource, /entry\.user\.profile\?\.uid/);
  assert.doesNotMatch(mainSource, /entry\?\.actor\?\.profile\?\.uid/);
});
