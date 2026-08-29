import { describe, expect, it, vi } from "vitest";

import { main } from "./deploy.mjs";

describe("deploy command", () => {
  it("fails closed instead of invoking the Railway CLI", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(main(["node", "scripts/deploy.mjs", "production"])).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("configured Railway MCP"),
    );
    error.mockRestore();
  });

  it("rejects unknown deployment targets", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(main(["node", "scripts/deploy.mjs", "preview"])).toBe(2);
    error.mockRestore();
  });
});
