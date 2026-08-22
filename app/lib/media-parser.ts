import { catalogIdentity, catalogOverride } from "./catalog-overrides";

export type DebridFile = {
  index: number;
  name: string;
  size: number;
  path: string;
};
export type DebridMagnetRecord = {
  id: number;
  filename: string;
  statusCode: number;
  uploadDate?: number;
  videoFiles: DebridFile[];
};
export type CatalogEpisode = {
  magnetId: number;
  file: number;
  name: string;
  season: number;
  episode: number;
  size: number;
  needsAudioCompatibility: boolean;
};
export type CatalogTitle = {
  id: string;
  title: string;
  category: "movie" | "series";
  year?: number;
  seasonCount: number;
  episodes: CatalogEpisode[];
  addedAt: number;
};

const releaseNoise =
  /\b(?:2160p|1080p|720p|576p|480p|4k|uhd|hdtv|hdlight|bluray|blu-ray|web[ ._-]?dl|webrip|brrip|dvdrip|remux|hdr|hevc|x26[45]|h26[45]|av1|aac|eac3|dts|atmos|multi|truefrench|french|vostfr|vof|vff|voa|full[ ._-]?sbs|proper|repack|extended|unrated|directors?[ ._-]+cut|10bit).*$/i;
const episodePattern =
  /(?:^|[^a-z0-9])(?:S(\d{1,2})E(\d{1,3})(?:[ ._-]*E?(\d{1,3}))?|(\d{1,2})x(\d{1,3}))(?:[^a-z0-9]|$)/i;
const seasonPattern =
  /(?:^|[^a-z0-9])(?:S(?:eason)?[ ._-]?)(\d{1,2})(?:[ ._-]*(?:-|to)[ ._-]*S?(\d{1,2}))?/i;

export const cleanReleaseName = (value: string) =>
  value
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[._]+/g, " ")
    .replace(/\[[^\]]*]/g, " ")
    .replace(releaseNoise, "")
    .replace(/^\s*\d{1,2}[ ._-]+(?=[A-Z])/, "")
    .replace(
      /\s+(?:eng|fre|fra|ita|spa|deu|ger|multi|vostfr)(?:\s+(?:eng|fre|fra|ita|spa|deu|ger|multi|vostfr))*$/i,
      "",
    )
    .replace(/\s*\([^)]*$/, "")
    .replace(/\s*\[[^\]]*$/, "")
    .replace(/[\s([{\-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
export const cleanEpisodeName = (value: string, episode: number) => {
  const withoutPrefix = value
    .replace(/^.*?S\d{1,2}E\d{1,3}(?:[ ._-]*E?\d{1,3})?[ ._-]*/i, "")
    .replace(/^\s*\d{1,3}\s*(?=[A-Z])/, "");
  return cleanReleaseName(withoutPrefix) || `Episode ${episode}`;
};
const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
const yearFrom = (value: string) =>
  Number(value.match(/\b(19\d{2}|20\d{2})\b/)?.[1]) || undefined;
const seriesTitle = (value: string) =>
  cleanReleaseName(value.split(episodePattern)[0].split(seasonPattern)[0])
    .replace(/^www\s+[a-z0-9]+\s+(?:org|com)\s*-?\s*/i, "")
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/, "")
    .replace(/\s+(?:complete|collection)$/i, "")
    .trim();
const parsedEpisode = (value: string) => {
  const match = value.match(episodePattern);
  return match
    ? { season: Number(match[1] || match[4]), episode: Number(match[2] || match[5]) }
    : undefined;
};
const numberedAvatarEpisode = (value: string) => {
  if (!/\bavatar[ ._-]+le[ ._-]+dernier[ ._-]+maitre[ ._-]+de[ ._-]+l[' ._-]*air\b/i.test(value)) return undefined;
  const absolute = Number(value.match(/[ ._-]+(\d{1,2})(?:\.[a-z0-9]{2,5})?$/i)?.[1]);
  if (!absolute || absolute > 61) return undefined;
  if (absolute <= 20) return { season: 1, episode: absolute };
  if (absolute <= 40) return { season: 2, episode: absolute - 20 };
  return { season: 3, episode: absolute - 40 };
};
const movieTitle = (value: string) => {
  const cleaned = cleanReleaseName(value),
    year = yearFrom(cleaned);
  return (
    cleaned
      .replace(
        /\s*-\s*(?:animation|action|adventure|comedy|drama|horror|thriller|fantasy|romance)\s+(?:19|20)\d{2}$/i,
        "",
      )
      .replace(new RegExp(`\\s*\\(?${year || "0000"}\\)?\\s*$`), "")
      .trim() || cleaned
  );
};
const isAuxiliaryVideo = (value: string) =>
  /\b(?:trailer|sample|featurette|behind[ ._-]*the[ ._-]*scenes|roundtables?)\b/i.test(
    value,
  );
const hasMeaningfulTitle = (value: string) => /[a-z]{2,}/i.test(value);

export function groupDebridCatalog(
  magnets: DebridMagnetRecord[],
): CatalogTitle[] {
  const series = new Map<string, CatalogTitle>();
  const movies = new Map<string, CatalogTitle>();
  for (const magnet of magnets.filter((item) => item.statusCode === 4)) {
    const largestVideo = Math.max(0, ...magnet.videoFiles.map((file) => file.size));
    const looksSeries =
      episodePattern.test(magnet.filename) ||
      seasonPattern.test(magnet.filename) ||
      magnet.videoFiles.some((file) => episodePattern.test(file.name)) ||
      magnet.videoFiles.some((file) => numberedAvatarEpisode(file.name));
    if (looksSeries) {
      const parsedTitle =
        seriesTitle(magnet.filename) ||
        seriesTitle(magnet.videoFiles[0]?.name || "Series");
      const override = catalogOverride(
        `${magnet.filename} ${magnet.videoFiles.map((file) => file.name).join(" ")}`,
        "series",
      );
      const title = override?.title || parsedTitle;
      const year = override?.year || yearFrom(magnet.filename);
      const key = catalogIdentity(title, year);
      const existing = series.get(key) || {
        id: `series-${slug(title)}`,
        title,
        category: "series" as const,
        year,
        seasonCount: 0,
        episodes: [],
        addedAt: magnet.uploadDate || 0,
      };
      magnet.videoFiles.forEach((file) => {
        const parsed = parsedEpisode(file.name) || numberedAvatarEpisode(file.name);
        if (!parsed && /\bbonus\b/i.test(file.name)) return;
        const season = parsed?.season || Number(magnet.filename.match(seasonPattern)?.[1] || 1);
        const episode = parsed?.episode || file.index + 1;
        existing.episodes.push({
          magnetId: magnet.id,
          file: file.index,
          name: cleanReleaseName(file.name),
          season,
          episode,
          size: file.size,
          needsAudioCompatibility:
            /\b(?:e-?ac-?3|eac3|dts(?:-?hd)?|truehd|ac-?3)\b/i.test(
              `${magnet.filename} ${file.name}`,
            ),
        });
      });
      existing.addedAt = Math.max(existing.addedAt, magnet.uploadDate || 0);
      existing.seasonCount = new Set(
        existing.episodes.map((item) => item.season),
      ).size;
      series.set(key, existing);
    } else {
      magnet.videoFiles.forEach((file) => {
        if (
          magnet.videoFiles.length > 1 &&
          (isAuxiliaryVideo(file.name) || file.size < largestVideo * 0.2)
        ) return;
        const fileTitle = movieTitle(file.name);
        const parsedTitle = hasMeaningfulTitle(fileTitle)
          ? fileTitle
          : movieTitle(magnet.filename);
        const override = catalogOverride(`${file.name} ${magnet.filename}`, "movie");
        const title = override?.title || parsedTitle;
        const year = override?.year || yearFrom(file.name) || yearFrom(magnet.filename);
        const key = catalogIdentity(title, year);
        const candidate: CatalogTitle = {
          id: `movie-${magnet.id}-${file.index}`,
          title,
          category: "movie",
          year,
          seasonCount: 0,
          episodes: [
            {
              magnetId: magnet.id,
              file: file.index,
              name: title,
              season: 0,
              episode: 0,
              size: file.size,
              needsAudioCompatibility:
                /\b(?:e-?ac-?3|eac3|dts(?:-?hd)?|truehd|ac-?3)\b/i.test(
                  `${magnet.filename} ${file.name}`,
                ),
            },
          ],
          addedAt: magnet.uploadDate || 0,
        };
        const previous = movies.get(key);
        if (!previous || previous.episodes[0].size < file.size)
          movies.set(key, candidate);
      });
    }
  }
  return [...series.values(), ...movies.values()]
    .map((item) => {
      const episodes = [
        ...new Map(
          [...item.episodes]
            .sort(
              (a, b) =>
                a.size - b.size || b.magnetId - a.magnetId || b.file - a.file,
            )
            .map((episode) => [`${episode.season}:${episode.episode}`, episode]),
        ).values(),
      ].sort((a, b) => a.season - b.season || a.episode - b.episode);
      return {
        ...item,
        episodes,
        seasonCount:
          item.category === "series"
            ? new Set(episodes.map((episode) => episode.season)).size
            : 0,
      };
    })
    .sort((a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title));
}
