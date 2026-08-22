const BROWSER_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis"]);

export const needsCompatibleAudio = (codec?: string) =>
  Boolean(codec && !BROWSER_AUDIO_CODECS.has(codec.toLowerCase()));
