const BROWSER_SAFE_VIDEO_CODECS = new Set(["h264"]);

export function videoOutputOptions(codec = "", height = 0, allowCopy = false) {
  if (BROWSER_SAFE_VIDEO_CODECS.has(codec.toLowerCase())) return ["-c:v", "copy"];
  if (allowCopy && codec.toLowerCase() === "hevc")
    return ["-c:v", "copy", "-tag:v", "hvc1"];

  const targetHeight = height > 1080 ? 480 : height > 720 ? 720 : 0;
  return [
    ...(targetHeight ? ["-vf", `scale=-2:${targetHeight}`] : []),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-crf",
    "25",
    "-pix_fmt",
    "yuv420p",
  ];
}

export function selectedStreamIndex(value, fallback = 1) {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
