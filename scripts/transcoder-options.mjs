const BROWSER_SAFE_VIDEO_CODECS = new Set(["h264"]);

const PROFILES = {
  bootstrap: { height: 240, bitrate: "280k", maxrate: "420k", bufsize: "840k" },
  "480": { height: 480, bitrate: "900k", maxrate: "1200k", bufsize: "2400k" },
  "720": { height: 720, bitrate: "2200k", maxrate: "3000k", bufsize: "6000k" },
  "1080": { height: 1080, bitrate: "4500k", maxrate: "6000k", bufsize: "12000k" },
};

export function videoOutputOptions(codec = "", height = 0, allowCopy = false, quality = "compat") {
  if ((quality === "original" || quality === "compat") && BROWSER_SAFE_VIDEO_CODECS.has(codec.toLowerCase())) return ["-c:v", "copy"];
  if ((quality === "original" || quality === "compat") && allowCopy && codec.toLowerCase() === "hevc")
    return ["-c:v", "copy", "-tag:v", "hvc1"];

  const profile = PROFILES[quality];
  const targetHeight = profile
    ? Math.min(height || profile.height, profile.height)
    : quality === "original"
      ? height > 1080
        ? 1080
        : 0
      : height >= 1080
        ? 480
        : height > 720
          ? 720
          : 0;
  return [
    ...(targetHeight ? ["-vf", `scale=-2:${targetHeight}`] : []),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-threads",
    "1",
    "-crf",
    "25",
    ...(profile
      ? [
          "-b:v",
          profile.bitrate,
          "-maxrate",
          profile.maxrate,
          "-bufsize",
          profile.bufsize,
        ]
      : []),
    "-pix_fmt",
    "yuv420p",
  ];
}

export function selectedStreamIndex(value, fallback = 1) {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function subtitleTimelineOptions(value) {
  const parsed = Number(value);
  const seconds = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  if (!seconds) return { input: [], output: [] };
  const timestamp = String(seconds);
  return {
    input: ["-ss", timestamp, "-copyts"],
    output: ["-ss", timestamp, "-output_ts_offset", `-${timestamp}`],
  };
}

export function audioSyncOptions(value) {
  const parsed = Number(value);
  const seconds = Number.isFinite(parsed)
    ? Math.max(-5, Math.min(5, Math.round(parsed * 10) / 10))
    : 0;
  const filters = ["aresample=async=1000:first_pts=0"];
  if (seconds > 0)
    filters.push(`adelay=${Math.round(seconds * 1000)}:all=1`);
  else if (seconds < 0)
    filters.push(`atrim=start=${Math.abs(seconds)}`, "asetpts=PTS-STARTPTS");
  return ["-af", filters.join(",")];
}
