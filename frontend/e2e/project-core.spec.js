import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectNoIntersection, expectWithinViewport, fixture, loginAs, repoRoot, resetE2EData } from "./helpers.js";

const APPROVAL_SCREENSHOT_DIR = path.join(repoRoot(), "docs/qa/screenshots/approval-workflow-2026-06-19");

test.beforeEach(() => {
  resetE2EData();
});

function projectCardByTitle(page, title) {
  return page.getByTestId("project-card").filter({ hasText: title }).first();
}

async function captureApprovalScreenshot(page, testInfo, fileName, projectName = "desktop-1440") {
  if (testInfo.project.name !== projectName) return;
  mkdirSync(APPROVAL_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(APPROVAL_SCREENSHOT_DIR, fileName), fullPage: true });
}

async function ensureHomeLoaded(page) {
  await page.goto("/#/");
  await page.getByTestId("project-card").first().waitFor();
}

test("home page has no horizontal overflow and mobile first screen exposes title and status", async ({ page }) => {
  await ensureHomeLoaded(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const firstTitle = page.getByTestId("project-title-link").first();
  const firstStrip = page.getByTestId("project-status-strip").first();
  await expect(firstTitle).toBeVisible();
  await expect(firstStrip).toBeVisible();
  const titleBox = await firstTitle.boundingBox();
  const stripBox = await firstStrip.boundingBox();
  expect(titleBox.y).toBeLessThan(page.viewportSize().height);
  expect(stripBox.y).toBeLessThan(page.viewportSize().height);
});

test("relationship badge geometry and hover strip match product requirement", async ({ page, isMobile }) => {
  const data = fixture();
  await loginAs(page, data.users.participant, data.users.password);
  await ensureHomeLoaded(page);
  const card = projectCardByTitle(page, data.projects.with_relations_title);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();

  const ribbon = card.getByTestId("relation-corner-ribbon");
  const relationChip = card.getByTestId("my-relation-chip").first();
  const topicChip = card.getByTestId("project-topic-chip").first();
  const metaRow = card.getByTestId("project-meta-row");
  const title = card.getByTestId("project-title-link");
  const main = card.getByTestId("project-card-body");
  const bottom = card.locator(".project-card-bottom");
  const footer = card.locator(".project-card-footer");
  for (const locator of [ribbon, relationChip, topicChip, metaRow, title]) {
    await expect(locator).toBeVisible();
  }
  const expectedTitle = `T${String(data.projects.with_relations_topic_id).padStart(4, "0")}: ${data.projects.with_relations_title}`;
  await expect(title).toHaveText(expectedTitle);
  const overfilledRole = card.locator(".team-role-chip.overfilled").filter({ hasText: /学生.*2\/1/ }).first();
  await expect(overfilledRole).toBeVisible();
  await expect(overfilledRole).not.toContainText("超额");

  const rb = await ribbon.boundingBox();
  const rel = await relationChip.boundingBox();
  const topic = await topicChip.boundingBox();
  const row = await metaRow.boundingBox();
  const titleBox = await title.boundingBox();
  const cardBox = await card.boundingBox();
  const mainBox = await main.boundingBox();
  const bottomBox = await bottom.boundingBox();
  const footerBox = await footer.boundingBox();
  const firstChipOffset = rel.x - cardBox.x;
  expectNoIntersection(rel, topic);
  expectNoIntersection(topic, titleBox);
  expect(firstChipOffset).toBeGreaterThanOrEqual(isMobile ? 64 : 68);
  expect(firstChipOffset).toBeLessThanOrEqual(isMobile ? 82 : 84);
  if (Math.abs(rel.y - topic.y) <= 1) {
    expect(rel.x + rel.width).toBeLessThanOrEqual(topic.x - 8);
  }
  expect(titleBox.x - cardBox.x).toBeGreaterThanOrEqual(isMobile ? 14 : 18);
  expect(titleBox.x - cardBox.x).toBeLessThanOrEqual(isMobile ? 28 : 34);
  expect(firstChipOffset - (titleBox.x - cardBox.x)).toBeGreaterThanOrEqual(isMobile ? 40 : 44);
  expect(Math.abs(mainBox.x - titleBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(bottomBox.x - titleBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(footerBox.x - titleBox.x)).toBeLessThanOrEqual(1);
  expect(row.y).toBeGreaterThanOrEqual(rb.y + rb.height * 0.35);

  if (!isMobile) {
    await card.hover();
    const stripColor = await card.evaluate((el) => {
      const strip = el.querySelector("[data-testid='project-status-strip']");
      const style = strip ? getComputedStyle(strip) : getComputedStyle(el, "::before");
      return `${style.backgroundColor} ${style.backgroundImage}`;
    });
    expect(stripColor).toMatch(/rgb\((21[0-9]|22[0-9]|23[0-9]|24[0-9]),\s*(15[0-9]|16[0-9]|17[0-9]|18[0-9]),\s*(2[0-9]|3[0-9]|4[0-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9])\)|#d4a017|#f4b400|gold/i);
  }
});

test("participation adds the corner ribbon immediately without shifting card content", async ({ page, isMobile }) => {
  const data = fixture();
  await loginAs(page, data.users.participant, data.users.password);
  await ensureHomeLoaded(page);
  const card = projectCardByTitle(page, data.projects.public_title);
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByTestId("relation-corner-ribbon")).toHaveCount(0);

  const title = card.getByTestId("project-title-link");
  const main = card.getByTestId("project-card-body");
  const bottom = card.locator(".project-card-bottom");
  const footer = card.locator(".project-card-footer");
  const beforeTitleBox = await title.boundingBox();
  const beforeCardBox = await card.boundingBox();
  expect(beforeTitleBox.x - beforeCardBox.x).toBeGreaterThanOrEqual(isMobile ? 14 : 18);
  expect(beforeTitleBox.x - beforeCardBox.x).toBeLessThanOrEqual(isMobile ? 28 : 34);

  await card.getByRole("button", { name: /^参与$/ }).click();
  const participationDialog = page.getByRole("dialog", { name: "参与课题" });
  await expect(participationDialog).toBeVisible();
  await participationDialog.getByLabel(/论文署名意向/).selectOption("contribution");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/projects/${data.projects.public_id}/interest/`) && response.request().method() === "POST"),
    participationDialog.getByRole("button", { name: /确认参与/ }).click(),
  ]);

  const ribbon = card.getByTestId("relation-corner-ribbon");
  expect(await ribbon.count()).toBe(1);
  await expect(ribbon).toContainText("我已参与");
  const afterTitleBox = await title.boundingBox();
  const afterCardBox = await card.boundingBox();
  const afterMainBox = await main.boundingBox();
  const afterBottomBox = await bottom.boundingBox();
  const afterFooterBox = await footer.boundingBox();
  const afterFirstChip = await card.locator("[data-testid='project-meta-row'] > span").first().boundingBox();
  expect(afterTitleBox.x - afterCardBox.x).toBeGreaterThanOrEqual(isMobile ? 14 : 18);
  expect(afterTitleBox.x - afterCardBox.x).toBeLessThanOrEqual(isMobile ? 28 : 34);
  expect(afterFirstChip.x - afterCardBox.x).toBeGreaterThanOrEqual(isMobile ? 64 : 68);
  expect(afterFirstChip.x - afterCardBox.x).toBeLessThanOrEqual(isMobile ? 82 : 84);
  expect((afterFirstChip.x - afterCardBox.x) - (afterTitleBox.x - afterCardBox.x)).toBeGreaterThanOrEqual(isMobile ? 40 : 44);
  expect(Math.abs(afterMainBox.x - afterTitleBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterBottomBox.x - afterTitleBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterFooterBox.x - afterTitleBox.x)).toBeLessThanOrEqual(1);
});

test("project detail runs a real collaboration CTA flow", async ({ page }) => {
  const data = fixture();
  await page.goto(`/#/project/${data.projects.public_id}`);
  await page.getByRole("button", { name: /点赞/ }).click();
  await expect(page.getByRole("status")).toContainText(/请先登录|登录/);

  await loginAs(page, data.users.participant, data.users.password);
  await page.goto(`/#/project/${data.projects.public_id}`);
  await page.getByRole("button", { name: /点赞/ }).click();
  await expect(page.getByRole("status")).toContainText(/已点赞|点赞成功|评分/);
  await page.getByRole("button", { name: /关注/ }).click();
  await expect(page.getByRole("status")).toContainText(/已关注|关注/);

  await page.getByRole("button", { name: /^参与$/ }).click();
  const participationDialog = page.getByRole("dialog", { name: "参与课题" });
  await expect(participationDialog).toBeVisible();
  await participationDialog.getByLabel(/论文署名意向/).selectOption("contribution");
  await participationDialog.getByRole("button", { name: /确认参与/ }).click();
  await expect(page.getByRole("status")).toContainText(/已参与|参与/);
  await expect(page.getByRole("button", { name: /取消参与|已参与/ })).toBeVisible();

  const detailActions = page.locator(".project-progress-actions");
  await detailActions.getByRole("button", { name: /^资助$/ }).click();
  const popover = page.getByTestId("sponsor-popover");
  await expect(popover.getByLabel("资助劳务费")).toBeVisible();
  await expect(popover.getByLabel("资助算力")).toBeVisible();
  await popover.getByLabel("资助劳务费").check();
  await popover.getByLabel("资助算力").check();
  await expectWithinViewport(page, popover);
  await popover.getByRole("button", { name: /提交资助意向/ }).click();
  await expect(detailActions.getByRole("button", { name: /管理资助|资助审批中|撤回资助|已资助/ })).toBeVisible();
});

test("claim reason tooltip, sponsor popover and contact card stay within viewport", async ({ page, isMobile }) => {
  const data = fixture();
  await loginAs(page, data.users.claimant, data.users.password);
  await page.goto(`/#/project/${data.projects.claim_occupied_id}`);
  const leaderButton = page.getByRole("button", { name: /认领项目负责人|暂不认领|审批中/ }).first();
  await expect(leaderButton).toHaveAttribute("aria-disabled", "true");
  if (isMobile) {
    await leaderButton.evaluate((element) => element.click());
    await expect(page.getByRole("status")).toContainText(/已有|阶段|审批中|积分|认领/);
  } else {
    await leaderButton.hover();
    const tooltip = page.getByTestId("claim-reason-tooltip");
    await expect(tooltip).toContainText(/已有|阶段|审批中|积分|认领/);
    await expectWithinViewport(page, tooltip);
    await leaderButton.focus();
    await expect(tooltip).toBeVisible();
  }

  await ensureHomeLoaded(page);
  const card = projectCardByTitle(page, data.projects.with_relations_title);
  await card.scrollIntoViewIfNeeded();
  await card.locator(".contact-hover-trigger").last().hover();
  const contactCard = page.getByTestId("floating-contact-card");
  await expect(contactCard).toBeVisible();
  await expectWithinViewport(page, contactCard);

  const sponsorButton = card.getByRole("button", { name: /管理资助|资助/ }).first();
  await sponsorButton.scrollIntoViewIfNeeded();
  await expect(sponsorButton).toBeVisible();
  await sponsorButton.click();
  const popover = page.getByTestId("sponsor-popover");
  await expect(popover).toBeVisible();
  await expectWithinViewport(page, popover);
  const triggerBox = await sponsorButton.boundingBox();
  const popoverBox = await popover.boundingBox();
  const verticalDistance = Math.min(
    Math.abs(popoverBox.y - (triggerBox.y + triggerBox.height)),
    Math.abs(triggerBox.y - (popoverBox.y + popoverBox.height)),
  );
  expect(verticalDistance).toBeLessThanOrEqual(24);
  const checkboxHeights = await popover.getByRole("checkbox").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(Math.min(...checkboxHeights)).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await sponsorButton.click();
  await expect(popover).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(popover).toBeHidden();
});

test("pending approval labels do not overflow", async ({ page }) => {
  const data = fixture();
  await loginAs(page, data.users.claimant, data.users.password);
  await page.goto(`/#/project/${data.projects.claim_pending_id}`);
  for (const name of [/项目负责人审批中/, /第一单位认领审批中/]) {
    const button = page.getByRole("button", { name }).first();
    await expect(button).toBeVisible();
    const overflow = await button.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("approval workflow review modal handles secondary token sponsor flow", async ({ page }, testInfo) => {
  const data = fixture();
  await loginAs(page, data.users.sponsor, data.users.password);
  await page.goto(`/#/project/${data.projects.public_id}`);
  const detailActions = page.locator(".project-progress-actions");
  await detailActions.getByRole("button", { name: /^资助$/ }).click();
  const popover = page.getByTestId("sponsor-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: /^更多资助类型$/ }).click();
  await popover.getByLabel("资助 token").check();
  await popover.getByRole("button", { name: /提交资助意向/ }).click();
  await expect(detailActions.getByRole("button", { name: /管理资助|资助审批中|撤回资助|已资助/ })).toBeVisible();

  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "我的申请", exact: true }).click();
  await expect(page.getByText(/资助 token|token/).first()).toBeVisible();
  await captureApprovalScreenshot(page, testInfo, "my-applications-token-pending.png");

  await loginAs(page, data.users.admin, data.users.password);
  await page.goto("/#/admin");
  await page.getByRole("button", { name: "申请审批", exact: true }).click();
  const sponsorGroup = page.getByTestId("admin-sponsor-group").filter({ hasText: /token|资助 token/ }).first();
  await expect(sponsorGroup).toBeVisible();
  await captureApprovalScreenshot(page, testInfo, "admin-approval-token-group.png");
  await sponsorGroup.getByRole("button", { name: /通过/ }).click();
  const reviewModal = page.getByTestId("admin-review-modal");
  await expect(reviewModal).toBeVisible();
  await reviewModal.getByLabel("审核意见").fill("token 额度确认");
  await captureApprovalScreenshot(page, testInfo, "admin-review-modal-token-approve.png");
  await reviewModal.getByRole("button", { name: /确认通过/ }).click();
  await expect(page.getByRole("status")).toContainText(/已通过|审批/);

  await loginAs(page, data.users.sponsor, data.users.password);
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "我的申请", exact: true }).click();
  await expect(page.getByText(/token 额度确认|已通过|资助 token/).first()).toBeVisible();
  await captureApprovalScreenshot(page, testInfo, "my-applications-token-approved.png");

  await page.goto(`/#/project/${data.projects.public_id}`);
  const updatedDetailActions = page.locator(".project-progress-actions");
  await updatedDetailActions.getByRole("button", { name: /管理资助|资助/ }).click();
  const updatedPopover = page.getByTestId("sponsor-popover");
  await expect(updatedPopover).toBeVisible();
  const tokenCheckbox = updatedPopover.getByLabel("资助 token");
  if (!(await tokenCheckbox.count())) {
    await updatedPopover.getByRole("button", { name: /^更多资助类型$/ }).click();
  }
  await expect(tokenCheckbox).toBeChecked();
  await tokenCheckbox.uncheck();
  await updatedPopover.getByRole("button", { name: /提交资助意向/ }).click();
  await expect(page.getByRole("status")).toContainText(/资助意向已记录|撤回资助 token|已撤回资助/);

  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "我的申请", exact: true }).click();
  await expect(page.getByText(/资助 token|token/).first()).toBeVisible();
  await expect(page.getByText(/已撤回/).first()).toBeVisible();
});

test("my applications rejected requests open prefilled controls and resubmit to pending", async ({ page }) => {
  const data = fixture();
  await loginAs(page, data.users.claimant, data.users.password);
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "我的申请", exact: true }).click();
  const rejectedClaimCard = page.getByTestId("my-application-card").filter({ hasText: data.projects.rejected_application_title }).filter({ hasText: /项目负责人|认领项目负责人/ }).first();
  await expect(rejectedClaimCard).toContainText("请补充项目负责人职责说明");
  await rejectedClaimCard.getByRole("button", { name: /重新提交申请/ }).click();
  const leadDialog = page.getByRole("dialog", { name: "认领项目负责人" });
  await expect(leadDialog).toBeVisible();
  await expect(leadDialog.getByText("上次审核意见：请补充项目负责人职责说明")).toBeVisible();
  await expect(leadDialog.getByLabel("负责人职责说明")).toHaveValue("E2E rejected leader message");
  await leadDialog.getByRole("button", { name: "提交审核" }).click();
  await expect(leadDialog).toBeHidden();
  await expect(rejectedClaimCard).toContainText(/待处理|审批中/);
  await expect(rejectedClaimCard).not.toContainText("请补充项目负责人职责说明");
  await expect(rejectedClaimCard.getByRole("button", { name: "查看课题" })).toBeVisible();

  const rejectedPaperCard = page.getByTestId("my-application-card").filter({ hasText: data.projects.rejected_application_title }).filter({ hasText: /第一单位|论文第一单位/ }).first();
  await expect(rejectedPaperCard).toContainText("请补充第一单位认领依据");
  await rejectedPaperCard.getByRole("button", { name: /重新提交申请/ }).click();
  const paperDialog = page.getByRole("dialog", { name: /论文第一单位/ });
  await expect(paperDialog).toBeVisible();
  await expect(paperDialog.getByText("上次审核意见：请补充第一单位认领依据")).toBeVisible();
  await expect(paperDialog.getByLabel("拟认领第一单位")).toHaveValue("E2E 被驳回第一单位");
  await expect(paperDialog.getByLabel("申请说明")).toHaveValue("E2E rejected first unit message");
  await paperDialog.getByRole("button", { name: "提交审核" }).click();
  await expect(paperDialog).toBeHidden();
  await expect(rejectedPaperCard).toContainText(/待处理|审批中/);
  await expect(rejectedPaperCard).not.toContainText("请补充第一单位认领依据");
  await expect(rejectedPaperCard.getByRole("button", { name: "查看课题" })).toBeVisible();

  await loginAs(page, data.users.sponsor, data.users.password);
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "我的申请", exact: true }).click();
  const rejectedSponsorCard = page.getByTestId("my-application-card").filter({ hasText: data.projects.rejected_application_title }).filter({ hasText: /资助 token/ }).first();
  await expect(rejectedSponsorCard).toContainText("请补充 token 额度和周期");
  await rejectedSponsorCard.getByRole("button", { name: /重新提交资助/ }).click();
  const popover = page.getByTestId("sponsor-popover");
  await expect(popover).toBeVisible();
  await expect(popover.getByText("上次审核意见：请补充 token 额度和周期")).toBeVisible();
  await expect(popover.getByLabel("资助 token")).toBeChecked();
  await expect(popover.getByLabel("说明")).toHaveValue("E2E rejected token note");
  await popover.getByRole("button", { name: "提交资助意向" }).click();
  await expect(popover).toBeHidden();
  await expect(rejectedSponsorCard).toContainText(/待处理|审批中/);
  await expect(rejectedSponsorCard).not.toContainText("请补充 token 额度和周期");
  await expect(rejectedSponsorCard.getByRole("button", { name: "撤回资助意向" })).toBeVisible();
});
