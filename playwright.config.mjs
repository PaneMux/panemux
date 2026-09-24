import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 30_000,
  workers: 1, // one browser profile with the extension at a time
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [
    // Chromium loads the unpacked extension/ folder directly.
    { name: "chromium", testDir: "tests/e2e" },
    // Firefox gets the Firefox build, installed as a temporary add-on.
    { name: "firefox", testDir: "tests/firefox", timeout: 60_000 },
  ],
  webServer: {
    command: "node tests/server.mjs",
    url: "http://localhost:4517/long.html",
    reuseExistingServer: true,
  },
});
