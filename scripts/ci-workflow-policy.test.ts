import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CI workflow concurrency", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

  it("cancels only superseded runs for the same workflow and ref", () => {
    expect(workflow).toMatch(
      /concurrency:\s*\n\s+group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\s*\n\s+cancel-in-progress:\s*true/,
    );
  });

  it("grants OIDC only to the post-deploy production verifier", () => {
    expect(workflow).toMatch(
      /production-playback:[\s\S]*?permissions:\s*\n\s+contents:\s*read\s*\n\s+id-token:\s*write/,
    );
    expect(workflow).toMatch(/permissions:\s*\n\s+contents:\s*read\s*\n(?!\s+id-token)/);
  });

  it("runs deterministic Chromium and WebKit UI coverage before allowing a change to merge", () => {
    expect(workflow).toMatch(
      /validate:[\s\S]*?name: Install Chromium and WebKit for UI smoke tests[\s\S]*?npx playwright install --with-deps chromium webkit[\s\S]*?name: UI smoke tests[\s\S]*?npm run test:ui:smoke[\s\S]*?name: WebKit player keyboard smoke test[\s\S]*?npm run test:ui:webkit/,
    );
  });

  it("uses Node 24-capable checkout and setup runtimes in every job", () => {
    expect(
      workflow.match(/uses: actions\/checkout@v(?:[5-9]|[1-9]\d+)\b/g) ?? [],
    ).toHaveLength(2);
    expect(
      workflow.match(/uses: actions\/setup-node@v(?:[5-9]|[1-9]\d+)\b/g) ?? [],
    ).toHaveLength(2);
  });

  it("keeps provider-failure and player-preference regressions in the PR smoke gate", () => {
    const packageJson = readFileSync("package.json", "utf8");

    expect(packageJson).toContain("tests/ui/provider-failure.spec.ts");
    expect(packageJson).toContain("tests/ui/player-keyboard-focus.spec.ts");
    expect(packageJson).toContain("tests/ui/player-preferences.spec.ts");
    expect(packageJson).toContain('"test:ui:webkit"');
  });
});
