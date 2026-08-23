const BROWSER_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis"]);

export type QualityMode = "auto" | "original" | "1080" | "720" | "480";
export type RenditionQuality = Exclude<QualityMode, "auto">;

const QUALITY_LADDER: RenditionQuality[] = ["480", "720", "1080", "original"];

export const availableQualities = (sourceHeight = 0): RenditionQuality[] =>
  QUALITY_LADDER.filter((quality) =>
    quality === "original" ? true : !sourceHeight || Number(quality) <= sourceHeight,
  );

export const nextAutoQuality = (
  current: RenditionQuality,
  direction: "up" | "down",
  sourceHeight = 0,
): RenditionQuality => {
  const ladder = availableQualities(sourceHeight),
    index = Math.max(0, ladder.indexOf(current));
  return ladder[
    direction === "up"
      ? Math.min(ladder.length - 1, index + 1)
      : Math.max(0, index - 1)
  ];
};

export const needsCompatibleAudio = (codec?: string) =>
  Boolean(codec && !BROWSER_AUDIO_CODECS.has(codec.toLowerCase()));

export const needsCompatiblePlayback = (
  format = "",
  audioCodec?: string,
) =>
  /(?:^|,)matroska(?:,|$)|(?:^|,)webm(?:,|$)/i.test(format) ||
  needsCompatibleAudio(audioCodec);

export const requiresMutedAutoplay = (userAgent = "") =>
  /(?:iPhone|iPad|iPod)/i.test(userAgent) ||
  (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent));
