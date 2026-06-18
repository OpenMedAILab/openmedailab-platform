import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

export function repoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../..");
}

export function resetE2EData() {
  const root = repoRoot();
  execFileSync(path.join(root, ".venv/bin/python"), ["manage.py", "seed_e2e_data", "--reset"], {
    cwd: root,
    env: { ...process.env, OPENMEDAILAB_E2E: "1" },
    stdio: "ignore",
  });
}

export function fixture() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(path.resolve(here, ".state/fixture.json"), "utf8"));
}

export async function loginAs(page, username, password = "StrongPass12345") {
  await page.goto("/#/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.locator(".auth-card").getByRole("button", { name: /^登录$/ }).click();
  await page.waitForURL(/#\/(dashboard|)$/);
}

export async function expectWithinViewport(page, locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

export function expectNoIntersection(a, b, margin = 0) {
  const separated = a.x + a.width + margin <= b.x
    || b.x + b.width + margin <= a.x
    || a.y + a.height + margin <= b.y
    || b.y + b.height + margin <= a.y;
  expect(separated, JSON.stringify({ a, b, margin })).toBe(true);
}
