import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("initial browse bundle", () => {
  it("loads the compatibility player only when a viewer enters a stream", async () => {
    const app = await readFile("app/kheyflix-app.tsx", "utf8");

    expect(app).toContain(
      'const loadStreamingPlayer = () => import("./streaming-player");',
    );
    expect(app).toContain("const StreamingPlayer = lazy(loadStreamingPlayer);");
    expect(app).toContain('if (next.section === "stream") void loadStreamingPlayer();');
    expect(app).not.toContain('import StreamingPlayer from "./streaming-player";');
  });
});
