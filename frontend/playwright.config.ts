import { defineConfig, devices } from "@playwright/test";

const remoteBase = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: remoteBase ?? "http://localhost:5173",
    trace: "on-first-retry",
  },

  // When PLAYWRIGHT_BASE_URL is set (deployed env), skip the local dev server.
  ...(remoteBase
    ? {}
    : {
        webServer: {
          command: "npm run e2e:serve",
          url: "http://localhost:5173",
          reuseExistingServer: !process.env.CI,
          env: {
            VITE_IS_TEST: "true",
            VITE_API_URL:
              process.env.TEST_BACKEND_URL ?? "http://localhost:8080",
          },
        },
      }),

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
