import { expect, test } from "@playwright/test";
import { fixture, resetE2EData } from "./helpers.js";

test.beforeEach(() => {
  resetE2EData();
});

test("release modal traps focus, closes with escape, and restores focus", async ({ page }) => {
  await page.goto("/#/");
  const trigger = page.getByRole("button", { name: /v\d+\.\d+\.\d+/ }).first();
  await trigger.focus();
  await trigger.click();

  const modal = page.getByRole("dialog", { name: "更新日志" });
  await expect(modal).toBeVisible();
  await expect.poll(() => modal.evaluate((root) => root.contains(document.activeElement))).toBe(true);

  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    await expect.poll(() => modal.evaluate((root) => root.contains(document.activeElement))).toBe(true);
  }

  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => modal.evaluate((root) => root.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("toast announces login-required feedback through a polite live region", async ({ page }) => {
  const data = fixture();
  await page.goto(`/#/project/${data.projects.public_id}`);
  await page.getByRole("button", { name: /^点赞$/ }).click();

  const toast = page.locator("[role='status'][aria-live='polite'][aria-atomic='true']").filter({ hasText: /请先登录|登录/ });
  await expect(toast).toBeVisible();
});

test("confirm overlay z-index stays above business modal overlays", async ({ page }) => {
  await page.goto("/#/");
  const zValues = await page.evaluate(() => {
    const modal = document.createElement("div");
    modal.className = "form-modal-backdrop";
    const confirm = document.createElement("div");
    confirm.className = "confirm-modal-backdrop";
    document.body.append(modal, confirm);
    const values = {
      modal: Number.parseInt(getComputedStyle(modal).zIndex || "0", 10),
      confirm: Number.parseInt(getComputedStyle(confirm).zIndex || "0", 10),
    };
    modal.remove();
    confirm.remove();
    return values;
  });

  expect(zValues.confirm).toBeGreaterThan(zValues.modal);
});
