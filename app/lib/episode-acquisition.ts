type EpisodeCoordinate = { season: number; episode: number };

export type MissingEpisode = EpisodeCoordinate & { title: string };

export function findNextMissingEpisode(
  available: EpisodeCoordinate[],
  episodeNames?: Record<string, string>,
): MissingEpisode | undefined {
  if (!episodeNames) return undefined;
  const ready = new Set(
    available.map(({ season, episode }) => `${season}:${episode}`),
  );
  return Object.entries(episodeNames)
    .map(([key, title]) => {
      const [season, episode] = key.split(":").map(Number);
      return { season, episode, title };
    })
    .filter(
      ({ season, episode }) =>
        Number.isSafeInteger(season) &&
        season > 0 &&
        Number.isSafeInteger(episode) &&
        episode > 0 &&
        !ready.has(`${season}:${episode}`),
    )
    .sort((left, right) =>
      left.season === right.season
        ? left.episode - right.episode
        : left.season - right.season,
    )[0];
}
