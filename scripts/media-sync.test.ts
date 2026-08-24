import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  audioSyncOptions,
  subtitleTimelineOptions,
} from "./transcoder-options.mjs";
import { rebaseWebVtt } from "./subtitle-timeline.mjs";

const directory = mkdtempSync(join(tmpdir(), "kheyflix-media-sync-"));
const source = join(directory, "source.mkv");

function ffmpeg(args: string[]) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || "FFmpeg failed");
  return result;
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
    "-filter:a", "aselect='not(between(t,2,2.2))',asetpts=PTS+0.916583/TB",
    "-map", "0:v", "-map", "1:a", "-map", "2:s",
    "-c:v", "libx264", "-preset", "ultrafast", "-g", "25",
    "-keyint_min", "25", "-sc_threshold", "0", "-bf", "0",
    "-c:a", "pcm_s16le", "-c:s", "srt",
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
    const detection = spawnSync(
        "ffmpeg",
        ["-hide_banner", "-nostats", "-i", output, "-map", "0:a:0", "-af", "silencedetect=noise=-50dB:d=0.05", "-f", "null", "-"],
        { encoding: "utf8", timeout: 30_000 },
      ),
      silence = detection.stderr.match(/silence_end: (?<seconds>\d+(?:\.\d+)?)/)?.groups;
    expect(detection.status).toBe(0);
    expect(Number(silence?.seconds)).toBeGreaterThanOrEqual(0.9);
    expect(Number(silence?.seconds)).toBeLessThanOrEqual(0.96);
  });

  it("starts audio and decoded video together after a non-keyframe seek", () => {
    const output = join(directory, "seek.mp4");
    ffmpeg([
      "-ss", "5.3", "-i", source,
      "-t", "1",
      "-map", "0:v:0", "-map", "0:a:0",
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
      "-threads", "1", "-crf", "25", "-pix_fmt", "yuv420p",
      "-c:a", "aac", ...audioSyncOptions("0"),
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      output,
    ]);
    const result = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=index,codec_type:packet=stream_index,pts_time", "-of", "json", output],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (result.status !== 0) throw new Error(result.stderr || "FFprobe failed");
    const value = JSON.parse(result.stdout) as {
        streams: Array<{ index: number; codec_type: string }>;
        packets: Array<{ stream_index: number; pts_time: string }>;
      },
      types = Object.fromEntries(value.streams.map((stream) => [stream.index, stream.codec_type])),
      first: Record<string, number> = {};
    for (const packet of value.packets)
      first[types[packet.stream_index]] ??= Number(packet.pts_time);
    expect(Math.abs(first.audio - first.video)).toBeLessThanOrEqual(0.023);
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
    const webvtt = rebaseWebVtt(readFileSync(output, "utf8"), 5);
    expect(webvtt).not.toContain("first cue");
    expect(webvtt).toContain("00:02.000 --> 00:03.000\nsecond cue");
  });
});
