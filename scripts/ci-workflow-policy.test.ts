import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CI workflow concurrency", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

  it("cancels only superseded runs for the same workflow and ref", () => {
    expect(workflow).toMatch(
      /concurrency:\s*\n\s+group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\s*\n\s+cancel-in-progress:\s*true/,
    );
  });
});
