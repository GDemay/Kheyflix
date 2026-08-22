const BROWSER_SAFE_VIDEO_CODECS = new Set(["h264"]);

export function videoOutputOptions(codec = "") {
  if (BROWSER_SAFE_VIDEO_CODECS.has(codec.toLowerCase())) return ["-c:v", "copy"];

  return [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
  ];
}

export function selectedStreamIndex(value, fallback = 1) {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
