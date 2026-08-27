type SeasonCoordinate = { season: number };

export type MissingSeason = { season: number };

export function findNextMissingSeason(
  available: SeasonCoordinate[],
  episodeNames?: Record<string, string>,
): MissingSeason | undefined {
  if (!episodeNames) return undefined;
  const ready = new Set(
    available
      .map(({ season }) => season)
      .filter((season) => Number.isSafeInteger(season) && season > 0),
  );
  const known = [...new Set(
    Object.keys(episodeNames)
      .map((key) => Number(key.split(":")[0]))
      .filter((season) => Number.isSafeInteger(season) && season > 0),
  )].sort((left, right) => left - right);
  const season = known.find((candidate) => !ready.has(candidate));
  return season ? { season } : undefined;
}
