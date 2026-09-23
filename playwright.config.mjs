import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  workers: 1, // one persistent Chromium profile with the extension at a time
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "node tests/server.mjs",
    url: "http://localhost:4517/long.html",
    reuseExistingServer: true,
  },
});
