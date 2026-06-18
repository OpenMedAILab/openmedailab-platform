import { expect, test } from "@playwright/test";
import { expectNoIntersection, expectWithinViewport, fixture, loginAs, resetE2EData } from "./helpers.js";

test.beforeEach(() => {
  resetE2EData();
});

function projectCardByTitle(page, title) {
  return page.getByTestId("project-card").filter({ hasText: title }).first();
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
  for (const locator of [ribbon, relationChip, topicChip, metaRow, title]) {
    await expect(locator).toBeVisible();
  }

  const rb = await ribbon.boundingBox();
  const rel = await relationChip.boundingBox();
  const topic = await topicChip.boundingBox();
  const row = await metaRow.boundingBox();
  const titleBox = await title.boundingBox();
  const gap = rel.x - (rb.x + rb.width);
  expectNoIntersection(rb, rel);
  expectNoIntersection(rel, topic, 8);
  expectNoIntersection(topic, titleBox);
  expect(gap).toBeGreaterThanOrEqual(12);
  expect(gap).toBeLessThanOrEqual(28);
  if (Math.abs(rel.y - topic.y) <= 1) {
    expect(rel.x + rel.width).toBeLessThanOrEqual(topic.x - 8);
  }
  expect(Math.abs(titleBox.x - topic.x)).toBeLessThanOrEqual(4);
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
  const triggerBox = await sponsorButton.boundingBox();
  await sponsorButton.click();
  const popover = page.getByTestId("sponsor-popover");
  await expect(popover).toBeVisible();
  await expectWithinViewport(page, popover);
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

test("secondary token sponsor flow is reachable and reviewable", async ({ page }) => {
  const data = fixture();
  await loginAs(page, data.users.sponsor, data.users.password);
  await page.goto(`/#/project/${data.projects.public_id}`);
  const detailActions = page.locator(".project-progress-actions");
  await detailActions.getByRole("button", { name: /^资助$/ }).click();
  const popover = page.getByTestId("sponsor-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: /更多资助类型/ }).click();
  await popover.getByLabel("资助 token").check();
  await popover.getByRole("button", { name: /提交资助意向/ }).click();
  await expect(detailActions.getByRole("button", { name: /管理资助|资助审批中|撤回资助|已资助/ })).toBeVisible();

  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "我的任务", exact: true }).click();
  await expect(page.getByText(/资助 token|token/).first()).toBeVisible();

  await loginAs(page, data.users.admin, data.users.password);
  await page.goto("/#/admin");
  await page.getByRole("button", { name: "任务审批", exact: true }).click();
  await expect(page.getByText(/资助 token|token/).first()).toBeVisible();
  page.once("dialog", async (dialog) => {
    await dialog.accept("token 额度确认");
  });
  await page.locator(".admin-table-row").filter({ hasText: /token|资助 token/ }).first().getByRole("button", { name: /通过/ }).click();
  await expect(page.getByRole("status")).toContainText(/已通过|审批/);

  await loginAs(page, data.users.sponsor, data.users.password);
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "我的任务", exact: true }).click();
  await expect(page.getByText(/token 额度确认|已通过|资助 token/).first()).toBeVisible();
});
