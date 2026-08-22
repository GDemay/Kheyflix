import http from "node:http";
import { spawn } from "node:child_process";

const port = Number(process.env.KHEYFLIX_TRANSCODER_PORT || 3101),
  appOrigin = process.env.KHEYFLIX_APP_ORIGIN || "http://localhost:3000";
const ffmpeg = process.env.KHEYFLIX_FFMPEG_PATH || "ffmpeg",
  ffprobe = process.env.KHEYFLIX_FFPROBE_PATH || "ffprobe";
const jobs = new Map(),
  probes = new Map();
const MAX_JOBS = 4,
  TEXT_SUBTITLES = new Set([
    "subrip",
    "srt",
    "ass",
    "ssa",
    "webvtt",
    "mov_text",
  ]);
const inputFor = (id, file) => `${appOrigin}/api/debrid/stream/${id}/${file}`;
const json = (response, status, value) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
  });
  response.end(JSON.stringify(value));
};
const runJson = (binary, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "",
      error = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Media probe timed out."));
    }, 30000);
    child.stdout.on("data", (chunk) => {
      if (out.length < 2_000_000) out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (error.length < 16_000) error += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code) reject(new Error(error || `Probe exited with ${code}`));
      else
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error("Media probe returned invalid data."));
        }
    });
  });
async function probeMedia(id, file) {
  const key = `${id}:${file}`,
    cached = probes.get(key);
  if (cached && Date.now() - cached.updatedAt < 30 * 60_000)
    return cached.value;
  const raw = await runJson(ffprobe, [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    inputFor(id, file),
  ]);
  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const language = (stream) => stream.tags?.language || "und",
    title = (stream) => stream.tags?.title || "";
  const value = {
    duration:
      Number(raw.format?.duration) ||
      Math.max(0, ...streams.map((stream) => Number(stream.duration) || 0)),
    format: raw.format?.format_name || "",
    video: streams
      .filter((stream) => stream.codec_type === "video")
      .map((stream) => ({
        index: stream.index,
        codec: stream.codec_name,
        width: stream.width,
        height: stream.height,
      })),
    audio: streams
      .filter((stream) => stream.codec_type === "audio")
      .map((stream) => ({
        index: stream.index,
        codec: stream.codec_name,
        language: language(stream),
        title: title(stream),
        channels: stream.channels || 0,
        default: Boolean(stream.disposition?.default),
      })),
    subtitles: streams
      .filter((stream) => stream.codec_type === "subtitle")
      .map((stream) => ({
        index: stream.index,
        codec: stream.codec_name,
        language: language(stream),
        title: title(stream),
        supported: TEXT_SUBTITLES.has(stream.codec_name),
      })),
  };
  probes.set(key, { value, updatedAt: Date.now() });
  return value;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/health")
      return json(response, 200, { ok: true, jobs: jobs.size });
    const stop = url.pathname.match(/^\/stop\/([a-z0-9-]+)$/i);
    if (stop) {
      const child = jobs.get(stop[1]);
      if (child && !child.killed) child.kill("SIGKILL");
      jobs.delete(stop[1]);
      response.writeHead(204).end();
      return;
    }
    const probe = url.pathname.match(/^\/probe\/(\d+)\/(\d+)$/);
    if (probe) return json(response, 200, await probeMedia(probe[1], probe[2]));
    const subtitle = url.pathname.match(
      /^\/subtitle\/(\d+)\/(\d+)\/(\d+)\.vtt$/,
    );
    if (subtitle) {
      const subtitleStart = Math.max(
        0,
        Number(url.searchParams.get("start") || 0),
      );
      const info = await probeMedia(subtitle[1], subtitle[2]),
        track = info.subtitles.find(
          (item) => item.index === Number(subtitle[3]),
        );
      if (!track?.supported)
        return json(response, 415, {
          error: "This subtitle format cannot be displayed in a web player.",
        });
      const child = spawn(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          ...(subtitleStart ? ["-ss", String(subtitleStart)] : []),
          "-i",
          inputFor(subtitle[1], subtitle[2]),
          "-map",
          `0:${subtitle[3]}`,
          "-f",
          "webvtt",
          "pipe:1",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      response.writeHead(200, {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "private, max-age=86400",
      });
      child.stdout.pipe(response);
      response.on("close", () => {
        if (!child.killed) child.kill("SIGKILL");
      });
      return;
    }
    const match = url.pathname.match(/^\/transcode\/(\d+)\/(\d+)$/);
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    if (jobs.size >= MAX_JOBS)
      return json(response, 429, {
        error: "The playback service is busy. Try again shortly.",
      });
    const token = url.searchParams.get("token") || crypto.randomUUID(),
      existing = jobs.get(token);
    if (existing && !existing.killed) existing.kill("SIGKILL");
    const start = Math.max(0, Number(url.searchParams.get("start") || 0)),
      audio = Math.max(
        0,
        Math.floor(Number(url.searchParams.get("audio") || 1)),
      );
    const args = ["-hide_banner", "-loglevel", "error"];
    if (start) args.push("-ss", String(start));
    args.push(
      "-readrate",
      "2",
      "-i",
      inputFor(match[1], match[2]),
      "-map",
      "0:v:0",
      "-map",
      `0:${audio}?`,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ac",
      "2",
      "-sn",
      "-fflags",
      "+genpts",
      "-avoid_negative_ts",
      "make_zero",
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      "-frag_duration",
      "1000000",
      "-flush_packets",
      "1",
      "-f",
      "mp4",
      "pipe:1",
    );
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    jobs.set(token, child);
    let started = false,
      stderr = "";
    const startup = setTimeout(() => {
      if (!started) child.kill("SIGKILL");
    }, 30000);
    child.stdout.on("data", (chunk) => {
      if (!started) {
        started = true;
        clearTimeout(startup);
        response.writeHead(200, {
          "Content-Type": "video/mp4",
          "Cache-Control": "private, no-store",
          "X-Kheyflix-Audio": "aac",
        });
      }
      if (!response.write(chunk)) child.stdout.pause();
    });
    response.on("drain", () => child.stdout.resume());
    child.stdout.on("end", () => response.end());
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16000) stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(startup);
      if (!response.headersSent) json(response, 503, { error: error.message });
      else response.end();
    });
    child.on("close", (code) => {
      clearTimeout(startup);
      jobs.delete(token);
      if (!started && !response.writableEnded)
        json(response, code === null ? 504 : 502, {
          error: stderr || "The compatible stream could not start.",
        });
    });
    response.on("close", () => {
      if (!response.writableEnded && !child.killed) child.kill("SIGKILL");
    });
  } catch (error) {
    if (!response.headersSent)
      json(response, 502, {
        error:
          error instanceof Error ? error.message : "Playback service error.",
      });
    else response.end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Kheyflix media compatibility service: http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const child of jobs.values()) if (!child.killed) child.kill("SIGKILL");
    server.close(() => process.exit(0));
  });
