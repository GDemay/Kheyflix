export type CatalogKind = "movie" | "series";

type CatalogOverride = {
  match: RegExp;
  title: string;
  year?: number;
};

// The library contains release names in several languages and from several
// uploaders. Keep the human decisions here: parsing remains generic, while
// known aliases always converge on the same title and metadata lookup.
const SERIES_OVERRIDES: CatalogOverride[] = [
  { match: /\b(?:the[ ._-]+)?o[ ._-]*c\b|\boc[ ._-]+season\b/i, title: "The O.C.", year: 2003 },
  { match: /\bmalcolm[ ._-]+in[ ._-]+the[ ._-]+middle(?:[ ._-]+life'?s[ ._-]+still[ ._-]+unfair)?\b/i, title: "Malcolm in the Middle", year: 2000 },
  { match: /\bsouth[ ._-]+park\b/i, title: "South Park", year: 1997 },
  { match: /\bsquid[ ._-]+game\b/i, title: "Squid Game", year: 2021 },
  { match: /\brick[ ._-]+and[ ._-]+morty\b/i, title: "Rick and Morty", year: 2013 },
  { match: /\bgame[ ._-]+of[ ._-]+thrones\b/i, title: "Game of Thrones", year: 2011 },
  { match: /\bbreaking[ ._-]+bad\b/i, title: "Breaking Bad", year: 2008 },
  { match: /\b(?:lost|les[ ._-]+disparus)\b/i, title: "Lost", year: 2004 },
  { match: /\b(?:la[ ._-]+chronique[ ._-]+des[ ._-]+)?bridgerton\b/i, title: "Bridgerton", year: 2020 },
  { match: /\b(?:star[ ._-]+wars[ ._-]+)?obi[ ._-]+wan[ ._-]+kenobi\b/i, title: "Obi-Wan Kenobi", year: 2022 },
  { match: /\bbluey\b/i, title: "Bluey", year: 2018 },
  { match: /\bspace[ ._-]+force\b/i, title: "Space Force", year: 2020 },
  { match: /\bthe[ ._-]+norm[ ._-]+show\b/i, title: "The Norm Show", year: 1999 },
  { match: /\bkaamelott\b/i, title: "Kaamelott", year: 2005 },
  { match: /\bzootopia(?:[ ._-]+plus)?\b/i, title: "Zootopia+", year: 2022 },
  { match: /\bcareme\b/i, title: "Carême", year: 2025 },
  { match: /\bthe[ ._-]+mentalist\b/i, title: "The Mentalist", year: 2008 },
  { match: /\bheroes\b/i, title: "Heroes", year: 2006 },
];

const MOVIE_OVERRIDES: CatalogOverride[] = [
  { match: /\bstar[ ._-]+wars\b.*\b(?:episode[ ._-]+(?:1|i)\b.*phantom[ ._-]+menace|phantom[ ._-]+menace)\b/i, title: "Star Wars: Episode I – The Phantom Menace", year: 1999 },
  { match: /\bstar[ ._-]+wars\b.*\b(?:episode[ ._-]+(?:2|ii)\b.*attack[ ._-]+of[ ._-]+the[ ._-]+clones|attack[ ._-]+of[ ._-]+the[ ._-]+clones)\b/i, title: "Star Wars: Episode II – Attack of the Clones", year: 2002 },
  { match: /\bstar[ ._-]+wars\b.*\b(?:episode[ ._-]+(?:3|iii)\b.*revenge[ ._-]+of[ ._-]+the[ ._-]+sith|revenge[ ._-]+of[ ._-]+the[ ._-]+sith)\b/i, title: "Star Wars: Episode III – Revenge of the Sith", year: 2005 },
  { match: /\bstar[ ._-]+wars\b.*\b(?:episode[ ._-]+(?:4|iv)\b.*(?:a[ ._-]+)?new[ ._-]+hope|(?:a[ ._-]+)?new[ ._-]+hope)\b/i, title: "Star Wars: Episode IV – A New Hope", year: 1977 },
  { match: /\bstar[ ._-]+wars\b.*\b(?:episode[ ._-]+(?:5|v)\b.*empire[ ._-]+strikes[ ._-]+back|empire[ ._-]+strikes[ ._-]+back)\b/i, title: "Star Wars: Episode V – The Empire Strikes Back", year: 1980 },
  { match: /\bstar[ ._-]+wars\b.*\b(?:episode[ ._-]+(?:6|vi)\b.*return[ ._-]+of[ ._-]+the[ ._-]+jedi|return[ ._-]+of[ ._-]+the[ ._-]+jedi)\b/i, title: "Star Wars: Episode VI – Return of the Jedi", year: 1983 },
  { match: /\bstar[ ._-]+wars\b.*\b(?:episode[ ._-]+(?:7|vii)\b.*force[ ._-]+awakens|force[ ._-]+awakens)\b/i, title: "Star Wars: Episode VII – The Force Awakens", year: 2015 },
  { match: /\bstar[ ._-]+wars\b.*\b(?:episode[ ._-]+(?:8|viii)\b.*last[ ._-]+jedi|the[ ._-]+last[ ._-]+jedi)\b/i, title: "Star Wars: Episode VIII – The Last Jedi", year: 2017 },
  { match: /\bstar[ ._-]+wars\b.*\b(?:episode[ ._-]+(?:9|ix)\b.*rise[ ._-]+of[ ._-]+skywalker|rise[ ._-]+of[ ._-]+skywalker)\b/i, title: "Star Wars: Episode IX – The Rise of Skywalker", year: 2019 },
  { match: /\bshrek(?:[ ._-]+1)?(?:[ ._-]+animation)?[ ._-]+2001\b/i, title: "Shrek", year: 2001 },
  { match: /\bshrek[ ._-]+2(?:[ ._-]+animation)?[ ._-]+2004\b/i, title: "Shrek 2", year: 2004 },
  { match: /\bshrek(?:[ ._-]+3|[ ._-]+the[ ._-]+third)(?:[ ._-]+animation)?[ ._-]+2007\b/i, title: "Shrek the Third", year: 2007 },
  { match: /\bshrek(?:[ ._-]+4|[ ._-]+forever[ ._-]+after)(?:[ ._-]+animation)?[ ._-]+2010\b/i, title: "Shrek Forever After", year: 2010 },
  { match: /\bone[ ._-]+battle[ ._-]+after[ ._-]+another\b|\b一战再战\b/i, title: "One Battle After Another", year: 2025 },
  { match: /\bpirates?(?:[ ._-]+des[ ._-]+caraibes)?[ ._-]+.*(?:curse[ ._-]+of[ ._-]+the[ ._-]+black[ ._-]+pearl|black[ ._-]+pearl)\b/i, title: "Pirates of the Caribbean: The Curse of the Black Pearl", year: 2003 },
  { match: /\b(?:le[ ._-]+)?comte[ ._-]+de[ ._-]+monte[ ._-]+cristo\b/i, title: "The Count of Monte Cristo", year: 2024 },
  { match: /\b(?:le[ ._-]+)?loup[ ._-]+de[ ._-]+wall[ ._-]+street\b/i, title: "The Wolf of Wall Street", year: 2013 },
  { match: /\b(?:inside[ ._-]+out[ ._-]+2|vice[ ._-]+versa[ ._-]+2)\b/i, title: "Inside Out 2", year: 2024 },
  { match: /\b(?:la[ ._-]+reine[ ._-]+des[ ._-]+neiges|frozen)\b/i, title: "Frozen", year: 2013 },
];

export function catalogOverride(
  source: string,
  kind: CatalogKind,
): { title: string; year?: number } | undefined {
  const rule = (kind === "series" ? SERIES_OVERRIDES : MOVIE_OVERRIDES).find(
    ({ match }) => match.test(source),
  );
  return rule && { title: rule.title, year: rule.year };
}

export const catalogIdentity = (title: string, year?: number) =>
  `${title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}:${year || ""}`;
