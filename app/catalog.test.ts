import { describe, expect, it } from 'vitest';
import { catalog, getTitle, searchCatalog } from './catalog';

describe('Kheyflix catalog', () => {
  it('returns known content for title and metadata queries', () => {
    expect(searchCatalog('bunny').map((item) => item.id)).toContain('big-buck-bunny');
    expect(searchCatalog('animation').map((item) => item.id)).toContain('big-buck-bunny');
    expect(searchCatalog('Sacha Goedegebure').map((item) => item.id)).toEqual(['big-buck-bunny']);
  });

  it('handles empty and unmatched searches', () => {
    expect(searchCatalog('')).toEqual([]);
    expect(searchCatalog('not-a-kheyflix-title')).toEqual([]);
  });

  it('advertises playback only when a legal source exists', () => {
    const playable = catalog.filter((item) => item.playable);
    expect(playable).toHaveLength(1);
    expect(playable[0].source?.url).toMatch(/^https:\/\//);
    expect(getTitle('neon-divide')?.playable).not.toBe(true);
  });
});
