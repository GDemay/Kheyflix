export const FAVORITES_KEY = "kheyflix:favorites:v1";

export function parseFavorites(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === "string"))]
      : [];
  } catch {
    return [];
  }
}

export function toggleFavorite(favorites: string[], id: string): string[] {
  return favorites.includes(id)
    ? favorites.filter((favorite) => favorite !== id)
    : [id, ...favorites];
}

export function friendsFirst<T extends { title: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => Number(/\bfriends\b/i.test(b.title)) - Number(/\bfriends\b/i.test(a.title)),
  );
}
