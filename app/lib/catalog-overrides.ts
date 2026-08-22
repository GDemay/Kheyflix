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
  { match: /\bdirty[ ._-]+magazine\b.*\bvictor'?s[ ._-]+other[ ._-]+family\b|\bforbidden[ ._-]+girlfriend\b.*\bkicked[ ._-]+out\b/i, title: "Malcolm in the Middle", year: 2000 },
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
  { match: /\bnow[ ._-]+you[ ._-]+see[ ._-]+me[ ._-]+now[ ._-]+you[ ._-]+don'?t\b/i, title: "Now You See Me: Now You Don't", year: 2025 },
  { match: /\bbatman[ ._-]+begins\b/i, title: "Batman Begins", year: 2005 },
  { match: /\bbatman[ ._-]+(?:the[ ._-]+)?dark[ ._-]+knight\b/i, title: "The Dark Knight", year: 2008 },
  { match: /\bpirates?(?:[ ._-]+des[ ._-]+caraibes)?[ ._-]+.*(?:curse[ ._-]+of[ ._-]+the[ ._-]+black[ ._-]+pearl|black[ ._-]+pearl)\b/i, title: "Pirates of the Caribbean: The Curse of the Black Pearl", year: 2003 },
  { match: /\bpirates?[ ._-]+of[ ._-]+the[ ._-]+caribbean\b.*\bdead[ ._-]+man'?s[ ._-]+chest\b/i, title: "Pirates of the Caribbean: Dead Man's Chest", year: 2006 },
  { match: /\bpirates?[ ._-]+of[ ._-]+the[ ._-]+caribbean\b.*\bat[ ._-]+world'?s[ ._-]+end\b/i, title: "Pirates of the Caribbean: At World's End", year: 2007 },
  { match: /\bpirates?[ ._-]+of[ ._-]+the[ ._-]+caribbean\b.*\bon[ ._-]+stranger[ ._-]+tides\b/i, title: "Pirates of the Caribbean: On Stranger Tides", year: 2011 },
  { match: /\bpirates?[ ._-]+of[ ._-]+the[ ._-]+caribbean\b.*\bdead[ ._-]+men[ ._-]+tell[ ._-]+no[ ._-]+tales\b/i, title: "Pirates of the Caribbean: Dead Men Tell No Tales", year: 2017 },
  { match: /\b(?:le[ ._-]+)?comte[ ._-]+de[ ._-]+monte[ ._-]+cristo\b/i, title: "The Count of Monte Cristo", year: 2024 },
  { match: /\b(?:le[ ._-]+)?loup[ ._-]+de[ ._-]+wall[ ._-]+street\b/i, title: "The Wolf of Wall Street", year: 2013 },
  { match: /\b(?:inside[ ._-]+out[ ._-]+2|vice[ ._-]+versa[ ._-]+2)\b/i, title: "Inside Out 2", year: 2024 },
  { match: /\b(?:la[ ._-]+reine[ ._-]+des[ ._-]+neiges|frozen)\b/i, title: "Frozen", year: 2013 },
  { match: /\binterstellar\b/i, title: "Interstellar", year: 2014 },
  { match: /\bthe[ ._-]+hunger[ ._-]+games[ ._-]+(?:1\b|2012\b)/i, title: "The Hunger Games", year: 2012 },
  { match: /\bthe[ ._-]+hunger[ ._-]+games[ ._-]+2[ ._-]+catching[ ._-]+fire\b/i, title: "The Hunger Games: Catching Fire", year: 2013 },
  { match: /\bthe[ ._-]+hunger[ ._-]+games[ ._-]+3[ ._-]+mockingjay[ ._-]+part[ ._-]+1\b/i, title: "The Hunger Games: Mockingjay – Part 1", year: 2014 },
  { match: /\bthe[ ._-]+hunger[ ._-]+games[ ._-]+4[ ._-]+mockingjay[ ._-]+part[ ._-]+2\b/i, title: "The Hunger Games: Mockingjay – Part 2", year: 2015 },
  { match: /\bsolo[ ._-]+a[ ._-]+star[ ._-]+wars[ ._-]+story\b/i, title: "Solo: A Star Wars Story", year: 2018 },
  { match: /\b(?:monstres[ ._-]+et[ ._-]+cie|monsters?[ ._-]+inc)\b/i, title: "Monsters, Inc.", year: 2001 },
  { match: /\bnausicaa[ ._-]+de[ ._-]+la[ ._-]+vallee[ ._-]+du[ ._-]+vent\b/i, title: "Nausicaä of the Valley of the Wind", year: 1984 },
  { match: /\bmerlin[ ._-]+l[' ._-]*enchanteur\b/i, title: "The Sword in the Stone", year: 1963 },
  { match: /\brobin[ ._-]+des[ ._-]+bois\b/i, title: "Robin Hood", year: 1973 },
  { match: /\bpeau[ ._-]+d[ ._-]*ane\b/i, title: "Donkey Skin", year: 1970 },
  { match: /\bun[ ._-]+conte[ ._-]+peut[ ._-]+en[ ._-]+cacher[ ._-]+un[ ._-]+autre\b/i, title: "Revolting Rhymes", year: 2016 },
  { match: /\bmickey[ ._-]+il[ ._-]+etait[ ._-]+deux[ ._-]+fois[ ._-]+noel\b/i, title: "Mickey's Twice Upon a Christmas", year: 2004 },
  { match: /\boscar[ ._-]+1967\b/i, title: "Oscar", year: 1967 },
  { match: /\btante[ ._-]+hilda\b/i, title: "Aunt Hilda!", year: 2013 },
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
