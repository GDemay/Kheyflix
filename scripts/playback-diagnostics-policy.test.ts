import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("playback diagnostic privacy", () => {
  it("does not print browser error text or session-bearing media URLs", async () => {
    const test = await readFile("tests/ui/mkv-playback.spec.ts", "utf8");

    expect(test).toContain("safeMediaPath");
    expect(test).not.toContain("message.text()");
    expect(test).not.toContain("${response.status()} ${response.url()}");
    expect(test).not.toContain("${response.request().method()} ${response.url()}");
  });

  it("keeps transcoder process output out of public errors and logs", async () => {
    const transcoder = await readFile("scripts/transcoder.mjs", "utf8");

    expect(transcoder).toContain('console.error("[hls] encoder exited"');
    expect(transcoder).not.toContain("console.error(`[hls]");
    expect(transcoder).not.toMatch(/job\.stderr(?!Observed)/);
    expect(transcoder).not.toMatch(/error:\s*stderr(?!Observed)/);
    expect(transcoder).not.toContain("error instanceof Error ? error.message");
  });
});
