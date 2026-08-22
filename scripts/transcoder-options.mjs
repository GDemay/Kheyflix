const BROWSER_SAFE_VIDEO_CODECS = new Set(["h264"]);

const PROFILES = {
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
      : height > 1080
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
