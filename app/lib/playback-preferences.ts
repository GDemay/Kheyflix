export const DEFAULT_PLAYBACK_RATE = 1;
export const MAX_AUDIO_SYNC_SECONDS = 5;

export type PlaybackPreferences = {
  subtitleLanguage?: string | null;
  playbackRate: number;
  audioSync: number;
};

export const defaultPlaybackPreferences = (): PlaybackPreferences => ({
  playbackRate: DEFAULT_PLAYBACK_RATE,
  audioSync: 0,
});

const clampSync = (value: number) =>
  Math.max(-MAX_AUDIO_SYNC_SECONDS, Math.min(MAX_AUDIO_SYNC_SECONDS, value));

export function parsePlaybackPreferences(
  value: string | null | undefined,
): PlaybackPreferences {
  if (!value) return defaultPlaybackPreferences();
  try {
    const parsed = JSON.parse(value) as Partial<PlaybackPreferences>;
    const playbackRate = [0.5, 0.75, 1, 1.25, 1.5, 2].includes(
      Number(parsed.playbackRate),
    )
      ? Number(parsed.playbackRate)
      : DEFAULT_PLAYBACK_RATE;
    const rawSync = Number(parsed.audioSync);
    return {
      playbackRate,
      audioSync: Number.isFinite(rawSync) ? clampSync(rawSync) : 0,
      ...(typeof parsed.subtitleLanguage === "string" ||
      parsed.subtitleLanguage === null
        ? { subtitleLanguage: parsed.subtitleLanguage }
        : {}),
    };
  } catch {
    return defaultPlaybackPreferences();
  }
}

export const serializePlaybackPreferences = (value: PlaybackPreferences) =>
  JSON.stringify({
    ...value,
    audioSync: Math.round(clampSync(value.audioSync) * 10) / 10,
  });
