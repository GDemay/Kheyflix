export type ReleaseMetadata = {
  displayTitle: string;
  year?: number;
  resolution?: "2160p" | "1080p" | "720p" | "480p";
  season?: number;
  episode?: number;
  episodeEnd?: number;
  seasonPack: boolean;
  videoCodec?: "AV1" | "H.265" | "H.264" | "Xvid";
  sourceType?: "Blu-ray" | "WEB-DL" | "WEBRip" | "HDTV" | "DVD";
  audioLanguages: string[];
  subtitleLanguages: string[];
};

const unique = (values: Array<string | undefined>) => [...new Set(values.filter(Boolean) as string[])];

const firstMatch = (value: string, expressions: RegExp[]) =>
  expressions.map((expression) => value.match(expression)?.[1]).find(Boolean);

const languageTags = [
  { name: "German", token: "GERMAN|GER|DE|DEUTSCH", audioToken: "GERMAN|GER|DEUTSCH" },
  { name: "English", token: "ENGLISH|ENG|EN", audioToken: "ENGLISH|ENG" },
  { name: "French", token: "FRENCH|FRE|FR|TRUEFRENCH", audioToken: "FRENCH|FRE|TRUEFRENCH" },
  { name: "Spanish", token: "SPANISH|SPA|ES|CASTELLANO", audioToken: "SPANISH|SPA|CASTELLANO" },
  { name: "Italian", token: "ITALIAN|ITA|IT", audioToken: "ITALIAN|ITA" },
  { name: "Portuguese", token: "PORTUGUESE|POR|PT|PTBR|BR", audioToken: "PORTUGUESE|POR|PTBR" },
  { name: "Russian", token: "RUSSIAN|RUS", audioToken: "RUSSIAN|RUS" },
  { name: "Ukrainian", token: "UKRAINIAN|UKR", audioToken: "UKRAINIAN|UKR" },
  { name: "Norwegian", token: "NORWEGIAN|NOR", audioToken: "NORWEGIAN|NOR" },
  { name: "Hindi", token: "HINDI|HIN", audioToken: "HINDI|HIN" },
] as const;

export function parseReleaseTitle(rawTitle: string): ReleaseMetadata {
  const normalized = rawTitle
    .replace(/^www\.[\w.-]+\s*-\s*/i, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const seasonEpisode = normalized.match(/\bS(\d{1,2})E(\d{1,3})(?:[\s-]*E?(\d{1,3}))?\b/i);
  const seasonWord = normalized.match(/\bSeason[ ._-]*(\d{1,2})\b/i);
  const season = Number(seasonEpisode?.[1] || seasonWord?.[1]) || undefined;
  const episode = Number(seasonEpisode?.[2]) || undefined;
  const episodeEnd = Number(seasonEpisode?.[3]) || undefined;
  const yearMatch = normalized.match(/(?:^|[\s([])((?:19|20)\d{2})(?=$|[\s)\]])/);
  const resolution = firstMatch(normalized, [/(2160p|1080p|720p|480p)/i])?.toLowerCase() as ReleaseMetadata["resolution"];
  const source = firstMatch(normalized, [/(UHD[ ._-]*BluRay|BluRay|BDRip|BRRip|WEB[ ._-]*DL|WEBRip|HDTV|DVDRip|DVD)/i]);
  const sourceType = source
    ? /blu|bd|br/i.test(source) ? "Blu-ray"
      : /web[ ._-]*dl/i.test(source) ? "WEB-DL"
        : /webrip/i.test(source) ? "WEBRip"
          : /hdtv/i.test(source) ? "HDTV" : "DVD"
    : undefined;
  const codecTag = firstMatch(normalized, [/(AV1|x265|h[ .]?265|HEVC|x264|h[ .]?264|AVC|Xvid)/i]);
  const videoCodec = codecTag
    ? /av1/i.test(codecTag) ? "AV1"
      : /265|hevc/i.test(codecTag) ? "H.265"
        : /264|avc/i.test(codecTag) ? "H.264" : "Xvid"
    : undefined;

  const hasSubtitleTag = (names: string) =>
    new RegExp(`\\b(?:${names})[ ._-]*(?:SUBS?|SUBBED)\\b|\\bVOST(?:${names})\\b`, "i").test(normalized);
  const multiSubs = /\bMULTI[ ._-]*SUBS?\b/i.test(normalized);
  const subtitleLanguages = unique(languageTags.map(({ name, token }) =>
    hasSubtitleTag(token) || (name === "English" && /\bE[ ._-]*SUBS?\b/i.test(normalized)) ||
      (name === "Norwegian" && /\bNOR[ ._-]*TEKST\b/i.test(normalized))
      ? name : undefined,
  ).concat(multiSubs ? ["Multiple"] : []));
  const withoutSubtitleTags = normalized
    .replace(/\b(?:GERMAN|GER|DE|DEUTSCH|ENGLISH|ENG|EN|FRENCH|FRE|FR|TRUEFRENCH|SPANISH|SPA|ES|CASTELLANO|ITALIAN|ITA|IT|PORTUGUESE|POR|PT|PTBR|BR|RUSSIAN|RUS|UKRAINIAN|UKR|NORWEGIAN|NOR|HINDI|HIN|MULTI)[ ._-]*(?:SUBS?|SUBBED|TEKST)\b|\bVOST(?:GERMAN|GER|DE|DEUTSCH|ENGLISH|ENG|EN|FRENCH|FRE|FR|TRUEFRENCH|SPANISH|SPA|ES|CASTELLANO|ITALIAN|ITA|IT|PORTUGUESE|POR|PT|PTBR|BR)\b|\bE[ ._-]*SUBS?\b/gi, " ");
  const detectedAudioLanguages = unique(languageTags.map(({ name, audioToken }) =>
    new RegExp(`\\b(?:${audioToken})\\b`, "i").test(withoutSubtitleTags) ? name : undefined,
  ));
  const audioLanguages = detectedAudioLanguages.length > 0
    ? detectedAudioLanguages
    : unique([/\b(?:DUAL[ ._-]*AUDIO|MULTI(?:LINGUAL)?)\b/i.test(withoutSubtitleTags) ? "Multiple" : undefined]);

  const technicalStart = normalized.search(
    /\b(?:S\d{1,2}E\d{1,3}|Season[ ._-]*\d{1,2}|(?:19|20)\d{2}|2160p|1080p|720p|480p|UHD|BluRay|BDRip|BRRip|WEB[ ._-]*DL|WEBRip|HDTV|DVDRip|x26[45]|h[ .]?26[45]|HEVC|AVC|AV1)\b/i,
  );
  const displayTitle = (technicalStart > 0 ? normalized.slice(0, technicalStart) : normalized)
    .replace(/[\s([\-:]+$/, "")
    .trim() || normalized;

  return {
    displayTitle,
    year: yearMatch ? Number(yearMatch[1]) : undefined,
    resolution,
    season,
    episode,
    episodeEnd,
    seasonPack: Boolean(season && !episode) || /\b(?:complete|season pack)\b/i.test(normalized),
    videoCodec,
    sourceType,
    audioLanguages,
    subtitleLanguages,
  };
}
