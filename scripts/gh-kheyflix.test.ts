import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const project = process.cwd();

function fakeGh(login: string) {
  const directory = mkdtempSync(join(tmpdir(), "kheyflix-gh-test-"));
  const executable = join(directory, "gh");
  writeFileSync(
    executable,
    `#!/bin/sh\nif [ "$1 $2 $3 $4" = "api user --jq .login" ]; then printf '%s\\n' '${login}'; exit 0; fi\nprintf '%s\\n' "$GH_CONFIG_DIR|$GH_REPO|$*"\n`,
  );
  chmodSync(executable, 0o700);
  return { directory, executable };
}

function invoke(login: string, args: string[], extraEnv: Record<string, string> = {}) {
  const fake = fakeGh(login);
  return spawnSync(process.execPath, ["scripts/gh-kheyflix.mjs", ...args], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      KHEYFLIX_GH_BIN: fake.executable,
      KHEYFLIX_GH_CONFIG_DIR: fake.directory,
      ...extraEnv,
    },
  });
}

describe("Kheyflix GitHub CLI boundary", () => {
  it("blocks the globally active guillaume-tesla identity", () => {
    const result = invoke("guillaume-tesla", ["pr", "list"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not GDemay");
  });

  it("pins GDemay operations to the canonical repository and isolated profile", () => {
    const result = invoke("GDemay", ["pr", "list"], {
      GH_TOKEN: "wrong-global-token",
      GITHUB_TOKEN: "another-wrong-global-token",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("GDemay/Kheyflix|pr list");
    expect(result.stdout).toContain("kheyflix-gh-test-");
  });

  it("rejects an explicit repository override", () => {
    const result = invoke("GDemay", ["pr", "create", "--repo", "guillaume-tesla/Kheyflix"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("explicit repository must be GDemay/Kheyflix");
  });
});
