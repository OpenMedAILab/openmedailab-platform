import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.OPENMEDAILAB_E2E_BASE_URL || "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.js",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1000 } } },
    { name: "mobile-360", use: { viewport: { width: 360, height: 740 }, isMobile: true } },
    { name: "mobile-390", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } } },
    { name: "mobile-320", use: { viewport: { width: 320, height: 740 }, isMobile: true } },
  ],
  webServer: [
    {
      command: "../.venv/bin/python ../manage.py migrate --noinput && OPENMEDAILAB_E2E=1 ../.venv/bin/python ../manage.py runserver 127.0.0.1:8000",
      url: "http://127.0.0.1:8000/api/meta/",
      cwd: ".",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5173",
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
