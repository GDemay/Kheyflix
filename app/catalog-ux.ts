export type CatalogSection = "movies" | "series";
export type CatalogSectionQueries = Record<CatalogSection, string>;

export const createCatalogSectionQueries = (): CatalogSectionQueries => ({
  movies: "",
  series: "",
});

export const updateCatalogSectionQuery = (
  queries: CatalogSectionQueries,
  section: CatalogSection,
  value: string,
): CatalogSectionQueries => ({ ...queries, [section]: value });

export const normalizeSearchQuery = (value: string) =>
  value.trim().replace(/\s+/g, " ");

export const episodeCountLabel = (count: number) =>
  `${count} ${count === 1 ? "episode" : "episodes"}`;
