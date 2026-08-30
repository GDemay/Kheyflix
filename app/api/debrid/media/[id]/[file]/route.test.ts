import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "42", file: "0" }) };

afterEach(() => {
  delete process.env.KHEYFLIX_TRANSCODER_URL;
  vi.unstubAllGlobals();
});

describe("media probe gateway", () => {
  it("propagates browser cancellation to the transcoder probe", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ duration: 120, video: [], audio: [], subtitles: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://kheyflix.test/api/debrid/media/42/0");

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://transcoder.test/probe/42/0",
      expect.objectContaining({ cache: "no-store", signal: request.signal }),
    );
  });
});
