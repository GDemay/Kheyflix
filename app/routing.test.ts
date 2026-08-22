import { describe, expect, it } from 'vitest';
import { parseRoute, routePath } from './routing';

describe('Kheyflix routing', () => {
  it('parses all public application routes', () => {
    expect(parseRoute('/')).toEqual({ section:'home' });
    expect(parseRoute('/movies')).toEqual({ section:'movies' });
    expect(parseRoute('/series')).toEqual({ section:'series' });
    expect(parseRoute('/title/big-buck-bunny')).toEqual({ section:'title', id:'big-buck-bunny' });
    expect(parseRoute('/watch/big-buck-bunny')).toEqual({ section:'watch', id:'big-buck-bunny' });
    expect(parseRoute('/profile')).toEqual({ section:'profile' });
    expect(parseRoute('/stream/123/0?title=Open%20Movie')).toEqual({ section:'stream', id:'123', file:0, title:'Open Movie' });
    expect(parseRoute('/debrid/123/2?title=My%20Movie')).toEqual({ section:'debrid', id:'123', file:2, title:'My Movie' });
    expect(parseRoute('/search?q=Big%20Buck')).toEqual({ section:'search', query:'Big Buck' });
  });

  it('creates encoded, refreshable paths', () => {
    expect(routePath({section:'search',query:'sci fi'})).toBe('/search?q=sci%20fi');
    expect(routePath({section:'watch',id:'big-buck-bunny'})).toBe('/watch/big-buck-bunny');
    expect(routePath({section:'stream',id:'123',file:0,title:'Open Movie'})).toBe('/stream/123/0?title=Open%20Movie');
    expect(routePath({section:'debrid',id:'123',file:2,title:'My Movie'})).toBe('/debrid/123/2?title=My%20Movie');
  });
});
