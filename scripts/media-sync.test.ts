import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  audioSyncOptions,
  subtitleTimelineOptions,
} from "./transcoder-options.mjs";

const directory = mkdtempSync(join(tmpdir(), "kheyflix-media-sync-"));
const source = join(directory, "source.mkv");

function ffmpeg(args: string[]) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || "FFmpeg failed");
}

function ffprobe(path: string) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "packet=pts_time", "-of", "json", path],
    { encoding: "utf8", timeout: 30_000 },
  );
  if (result.status !== 0) throw new Error(result.stderr || "FFprobe failed");
  return (JSON.parse(result.stdout).packets as Array<{ pts_time: string }>).map(
    (packet) => Number(packet.pts_time),
  );
}

beforeAll(() => {
  ffmpeg([
    "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=25:duration=10",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=10",
    "-i", "tests/fixtures/timeline-sync.srt",
    "-filter:a", "aselect='not(between(t,2,2.2))'",
    "-map", "0:v", "-map", "1:a", "-map", "2:s",
    "-c:v", "libx264", "-c:a", "pcm_s16le", "-c:s", "srt",
    source,
  ]);
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("media timeline integration", () => {
  it("fills an input timestamp discontinuity instead of carrying A/V drift forward", () => {
    const output = join(directory, "reconciled.mkv");
    ffmpeg([
      "-i", source,
      "-map", "0:v:0", "-map", "0:a:0",
      "-c:v", "copy", "-c:a", "aac",
      ...audioSyncOptions("0"),
      output,
    ]);
    const timestamps = ffprobe(output);
    const largestGap = Math.max(
      ...timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]),
    );
    expect(largestGap).toBeLessThanOrEqual(0.023);
  });

  it("drops expired cues and rebases remaining subtitles to an exact seek", () => {
    const output = join(directory, "seek.vtt"),
      timeline = subtitleTimelineOptions(5);
    ffmpeg([
      ...timeline.input,
      "-i", source,
      ...timeline.output,
      "-map", "0:s:0",
      "-f", "webvtt",
      output,
    ]);
    const webvtt = readFileSync(output, "utf8");
    expect(webvtt).not.toContain("first cue");
    expect(webvtt).toContain("00:02.000 --> 00:03.000\nsecond cue");
  });
});
