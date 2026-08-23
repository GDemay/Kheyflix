import { beforeEach, describe, expect, it, vi } from 'vitest';

const {resolveVideo}=vi.hoisted(()=>({resolveVideo:vi.fn()}));
vi.mock('../../../../../lib/alldebrid',()=>({
  AllDebridError:class AllDebridError extends Error {code='ALLDEBRID_ERROR';status=502},
  contentTypeFor:()=> 'video/mp4',
  resolveVideo,
}));

import { GET, HEAD } from './route';

const context={params:Promise.resolve({id:'42',file:'0'})};

describe('direct debrid streaming',()=>{
  beforeEach(()=>{
    delete process.env.KHEYFLIX_STREAM_MODE;
    resolveVideo.mockReset().mockResolvedValue({url:'https://cdn.test/signed/movie.mp4',name:'Movie.mp4',size:4096});
  });

  it.each([{handler:GET,method:'GET'},{handler:HEAD,method:'HEAD'}])('hands the $method media data plane directly to AllDebrid only when explicitly configured',async({handler,method})=>{
    process.env.KHEYFLIX_STREAM_MODE='direct';
    const response=await handler(new Request('https://kheyflix.test/api/debrid/stream/42/0',{method,headers:{'x-real-ip':'203.0.113.7'}}),context);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://cdn.test/signed/movie.mp4');
    expect(response.headers.get('x-kheyflix-stream')).toBe('direct');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(resolveVideo).toHaveBeenCalledWith(42,0,'203.0.113.7');
  });

  it('does not trust malformed forwarding headers in direct mode',async()=>{
    process.env.KHEYFLIX_STREAM_MODE='direct';
    await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0',{headers:{'x-real-ip':'203.0.113.7, 10.0.0.1'}}),context);
    expect(resolveVideo).toHaveBeenCalledWith(42,0,undefined);
  });

  it('uses an abort-aware relay by default',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response('data',{headers:{'content-type':'video/mp4','content-length':'4'}}));
    vi.stubGlobal('fetch',fetchMock);
    const request=new Request('https://kheyflix.test/api/debrid/stream/42/0',{headers:{range:'bytes=0-3'}});
    const response=await GET(request,context);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('data');
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.test/signed/movie.mp4',expect.objectContaining({method:'GET',headers:{Range:'bytes=0-3'},signal:request.signal}));
    vi.unstubAllGlobals();
  });

  it('resolves relay URLs for the server and preserves HEAD semantics',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(null,{status:206,headers:{'content-length':'4'}}));
    vi.stubGlobal('fetch',fetchMock);
    const request=new Request('https://kheyflix.test/api/debrid/stream/42/0',{method:'HEAD',headers:{'x-real-ip':'203.0.113.7',range:'bytes=0-3'}});
    const response=await HEAD(request,context);
    expect(resolveVideo).toHaveBeenCalledWith(42,0,undefined);
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.test/signed/movie.mp4',expect.objectContaining({method:'HEAD'}));
    expect(response.body).toBeNull();
    vi.unstubAllGlobals();
  });
});
