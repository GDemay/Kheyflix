import { describe, expect, it } from "vitest";
import {
  classifyProviderPreflightFailure,
  ProviderPreflightHttpError,
} from "./provider-preflight";

describe("provider playback preflight", () => {
  it("continues to the media request after a transient transport failure", () => {
    expect(classifyProviderPreflightFailure(new TypeError("Failed to fetch"), false)).toEqual({
      action: "continue",
    });
  });

  it("keeps explicit provider HTTP failures fatal and useful", () => {
    expect(
      classifyProviderPreflightFailure(
        new ProviderPreflightHttpError(404),
        false,
      ),
    ).toEqual({
      action: "fail",
      message: "Media provider returned HTTP 404.",
    });
  });

  it("ignores a preflight aborted during navigation", () => {
    expect(classifyProviderPreflightFailure(new Error("aborted"), true)).toEqual({
      action: "ignore",
    });
  });
});
