import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
export const productionAccessStatePath = join(
  tmpdir(),
  "kheyflix-playwright-production-access.json",
);

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.012,
    },
  },
  use: {
    baseURL: externalBaseUrl ?? "http://localhost:4173",
    colorScheme: "dark",
    locale: "en-US",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    storageState: externalBaseUrl ? productionAccessStatePath : undefined,
    trace: externalBaseUrl ? "off" : "retain-on-failure",
  },
  globalSetup: externalBaseUrl ? "./tests/ui/production-access.setup.ts" : undefined,
  globalTeardown: externalBaseUrl ? "./tests/ui/production-access.teardown.ts" : undefined,
  projects: [
    { name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "tablet", use: { ...devices["iPad (gen 7)"], browserName: "chromium" } },
    { name: "laptop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "PORT=4173 node scripts/run-dev.mjs",
        url: "http://localhost:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
