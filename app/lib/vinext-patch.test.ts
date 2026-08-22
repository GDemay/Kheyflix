import { describe, expect, it } from "vitest";
import { patchVinextSource } from "../../scripts/patch-vinext.mjs";

const source = `before
\tconst nodeStream = Readable.fromWeb(webResponse.body);
\tif (shouldCompress) pipeline(nodeStream, createCompressor(encoding, "streaming"), res, () => {});
\telse pipeline(nodeStream, res, () => {});
after`;

describe("Vinext disconnected-stream patch", () => {
  it("cancels the upstream body when the destination is already closed", () => {
    const patched = patchVinextSource(source);
    expect(patched).toContain("res.destroyed || res.writableEnded");
    expect(patched).toContain('error?.code !== "ERR_STREAM_UNABLE_TO_PIPE"');
    expect(patched).toContain("cancelResponseBody(webResponse)");
  });

  it("is idempotent", () => {
    const once = patchVinextSource(source);
    expect(patchVinextSource(once)).toBe(once);
  });

  it("fails closed when Vinext changes its stream implementation", () => {
    expect(() => patchVinextSource("different implementation")).toThrow(
      /review the disconnect patch/i,
    );
  });
});
