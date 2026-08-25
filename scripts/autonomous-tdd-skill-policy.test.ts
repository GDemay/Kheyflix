import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skillPath = ".agents/skills/autonomous-tdd-delivery/SKILL.md";
const workflowPath =
  ".agents/skills/autonomous-tdd-delivery/references/workflow.md";

describe("repository autonomous TDD delivery skill", () => {
  it("ships the complete discoverable skill bundle", () => {
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(workflowPath)).toBe(true);

    const skill = readFileSync(skillPath, "utf8");
    const workflow = readFileSync(workflowPath, "utf8");

    expect(skill).toMatch(/^---\nname: autonomous-tdd-delivery\n/m);
    expect(skill).toContain("references/workflow.md");
    expect(skill).toContain("## Codex Cloud goal fallback");
    expect(skill).toContain("BLOCKED_GOAL_UNAVAILABLE");
    expect(workflow).toContain("# Evidence-gated workflow");
    expect(workflow).toContain("## 6. Independent acceptance gate");
    expect(workflow).toContain("## 8. Deployment and production gate");
  });
});
