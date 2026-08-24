import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const routeFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? routeFiles(path)
      : entry.name === "route.ts"
        ? [path]
        : [];
  });

describe("API observability policy", () => {
  it("wraps every public API route with the shared observer", () => {
    const uncovered = routeFiles(join(process.cwd(), "app", "api"))
      .filter((path) => !readFileSync(path, "utf8").includes("observeApi"));

    expect(uncovered).toEqual([]);
  });
});
