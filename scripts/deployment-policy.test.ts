import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) =>
  readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

describe("Railway delivery boundary", () => {
  it("keeps direct Railway CLI credentials and commands out of tracked guidance", async () => {
    const files = await Promise.all(
      [".env.example", "README.md", "docs/deployment.md"].map(readProjectFile),
    );

    for (const file of files) {
      expect(file).not.toMatch(/RAILWAY_TOKEN/);
      expect(file).not.toMatch(
        /(?:^|\n)\s*railway\s+(?:up|variable|deployment|logs|rollback)\b/im,
      );
    }
    expect(files.join("\n")).toContain("Railway MCP");
  });

  it("keeps the legacy deploy command fail-closed", async () => {
    const source = await readProjectFile("scripts/deploy.mjs");

    expect(source).not.toContain("node:child_process");
    expect(source).not.toMatch(/spawn(?:Sync)?\s*\(/);
  });
});
