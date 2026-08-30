import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("local browser-test topology", () => {
  it("starts the app and its transcoder together instead of bypassing media playback", async () => {
    const [config, runner] = await Promise.all([
      readFile("playwright.config.ts", "utf8"),
      readFile("scripts/run-dev.mjs", "utf8"),
    ]);

    expect(config).toContain('command: "PORT=4173 node scripts/run-dev.mjs"');
    expect(config).not.toContain('command: "./node_modules/.bin/vinext dev --port 4173"');
    expect(runner).toContain('spawn("node_modules/.bin/vinext", ["dev", "--port", env.PORT]');
    expect(runner).toContain("await loadLocalEnvironment()");
  });
});
