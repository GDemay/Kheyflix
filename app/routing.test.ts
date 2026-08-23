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
    expect(parseRoute('/discover')).toEqual({ section:'discover' });
    expect(parseRoute('/stream/123/0?title=Open%20Movie')).toEqual({ section:'stream', id:'123', file:0, title:'Open Movie', compat:false });
    expect(parseRoute('/stream/123/0?title=Open%20Movie&compat=1')).toEqual({ section:'stream', id:'123', file:0, title:'Open Movie', compat:true });
    expect(parseRoute('/debrid/123/2?title=My%20Movie')).toEqual({ section:'debrid', id:'123', file:2, title:'My Movie' });
    expect(parseRoute('/search?q=Big%20Buck')).toEqual({ section:'search', query:'Big Buck' });
  });

  it('creates encoded, refreshable paths', () => {
    expect(routePath({section:'search',query:'sci fi'})).toBe('/search?q=sci%20fi');
    expect(routePath({section:'discover'})).toBe('/discover');
    expect(routePath({section:'watch',id:'big-buck-bunny'})).toBe('/watch/big-buck-bunny');
    expect(routePath({section:'stream',id:'123',file:0,title:'Open Movie'})).toBe('/stream/123/0/open-movie');
    expect(routePath({section:'stream',id:'123',file:0,title:'Open Movie',compat:true})).toBe('/stream/123/0/open-movie?compat=1');
    expect(routePath({section:'debrid',id:'123',file:2,title:'My Movie'})).toBe('/debrid/123/2?title=My%20Movie');
  });

  it('normalizes whitespace in search URLs and parsed routes', () => {
    expect(routePath({section:'search',query:'   '})).toBe('/search');
    expect(routePath({section:'search',query:'  Star\t  Wars  '})).toBe('/search?q=Star%20Wars');
    expect(parseRoute('/search?q=%20%20%20')).toEqual({section:'search',query:''});
    expect(parseRoute('/search?q=Star%09%20%20Wars')).toEqual({section:'search',query:'Star Wars'});
  });
});
