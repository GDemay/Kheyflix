import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "42", file: "0", stream: "1" }) };

afterEach(() => {
  delete process.env.KHEYFLIX_TRANSCODER_URL;
  vi.unstubAllGlobals();
});

describe("subtitle gateway", () => {
  it("propagates browser cancellation to subtitle conversion", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("WEBVTT\n\n"));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://kheyflix.test/api/debrid/subtitle/42/0/1?start=15");

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://transcoder.test/subtitle/42/0/1.vtt?start=15",
      expect.objectContaining({ cache: "no-store", signal: request.signal }),
    );
  });
});
