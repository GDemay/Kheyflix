import { describe, expect, it } from "vitest";
import {
  protectedArguments,
  protectedEnvironment,
} from "./gh-kheyflix-policy.mjs";

describe("Kheyflix GitHub CLI boundary", () => {
  it("removes ambient tokens and pins the isolated profile", () => {
    const env = protectedEnvironment(
      { GH_TOKEN: "wrong", GITHUB_TOKEN: "wrong-too", PATH: "/bin" },
      "/isolated/kheyflix",
    );
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env.GH_CONFIG_DIR).toBe("/isolated/kheyflix");
    expect(env.GH_REPO).toBe("GDemay/Kheyflix");
  });

  it("pins allowlisted delivery commands to the canonical repository", () => {
    expect(protectedArguments(["pr", "checks", "27"])).toEqual([
      "pr",
      "checks",
      "27",
      "--repo",
      "GDemay/Kheyflix",
    ]);
  });

  it.each([
    ["raw API", ["api", "repos/octocat/Hello-World"]],
    ["positional repo", ["repo", "view", "octocat/Hello-World"]],
    ["long repo", ["pr", "list", "--repo", "octocat/Hello-World"]],
    ["long equals repo", ["pr", "list", "--repo=octocat/Hello-World"]],
    ["compact repo", ["pr", "list", "-Roctocat/Hello-World"]],
    ["external PR URL", ["pr", "view", "https://github.com/octocat/Hello-World/pull/1"]],
    ["external issue URL", ["issue", "close", "https://github.com/octocat/Hello-World/issues/1"]],
    ["qualified PR", ["pr", "view", "octocat/Hello-World#1"]],
    ["issue transfer destination", ["issue", "transfer", "1", "octocat/Hello-World"]],
  ])("rejects the %s escape", (_label, args) => {
    expect(() => protectedArguments(args)).toThrow();
  });

  it("allows canonical repository URLs", () => {
    expect(
      protectedArguments([
        "pr",
        "view",
        "https://github.com/GDemay/Kheyflix/pull/27",
      ]),
    ).toEqual([
      "pr",
      "view",
      "https://github.com/GDemay/Kheyflix/pull/27",
      "--repo",
      "GDemay/Kheyflix",
    ]);
  });
});
