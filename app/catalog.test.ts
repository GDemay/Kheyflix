import { describe, expect, it } from 'vitest';
import { catalog, getTitle, searchCatalog } from './catalog';

describe('Kheyflix catalog', () => {
  it('returns known content for title and metadata queries', () => {
    expect(searchCatalog('neon').map((item) => item.id)).toContain('neon-divide');
    expect(searchCatalog('animation').map((item) => item.id)).toContain('paper-kingdom');
  });

  it('handles empty and unmatched searches', () => {
    expect(searchCatalog('')).toEqual([]);
    expect(searchCatalog('not-a-kheyflix-title')).toEqual([]);
  });

  it('does not advertise mock catalog titles as playable streams', () => {
    const playable = catalog.filter((item) => item.playable);
    expect(playable).toHaveLength(0);
    expect(getTitle('neon-divide')?.playable).not.toBe(true);
  });
});
