import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {lookup,resolveVideo}=vi.hoisted(()=>({lookup:vi.fn(),resolveVideo:vi.fn()}));
vi.mock('../../../../../lib/alldebrid',()=>({
  AllDebridError:class AllDebridError extends Error {
    code:string;
    status:number;
    retryable:boolean;
    constructor(message:string,code='ALLDEBRID_ERROR',status=502,retryable=false) {
      super(message);
      this.code=code;
      this.status=status;
      this.retryable=retryable;
    }
  },
  contentTypeFor:()=> 'video/mp4',
  resolveVideo,
}));
vi.mock('node:dns/promises',()=>({lookup}));

import { createPinnedHttpsConnector, GET, HEAD } from './route';

const context={params:Promise.resolve({id:'42',file:'0'})};

describe('direct debrid streaming',()=>{
  beforeEach(()=>{
    delete process.env.KHEYFLIX_STREAM_MODE;
    delete process.env.KHEYFLIX_ACCESS_TOKEN;
    delete process.env.KHEYFLIX_SESSION_SECRET;
    delete process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN;
    delete process.env.KHEYFLIX_STREAM_FIRST_BYTE_TIMEOUT_MS;
    lookup.mockReset();
    lookup.mockResolvedValue([{address:'8.8.8.8',family:4}]);
    resolveVideo.mockReset().mockResolvedValue({url:'https://cdn.test/signed/movie.mp4',name:'Movie.mp4',size:4096});
  });

  afterEach(()=>vi.unstubAllGlobals());

  it('pins a validated provider hostname to its approved address while preserving TLS identity',()=>{
    const calls:Array<{hostname:string;host?:string;servername?:string}>=[];
    const connector=createPinnedHttpsConnector(
      {hostname:'cdn.test',addresses:[{address:'8.8.8.8',family:4}]},
      ((options,callback)=>{
        calls.push(options);
        callback(null,{} as never);
      }) as never,
    );
    let callbackError:Error|null|undefined;
    connector(
      {hostname:'cdn.test',host:'cdn.test',protocol:'https:',port:'443'} as never,
      ((error)=>{callbackError=error;}) as never,
    );

    expect(callbackError).toBeNull();
    expect(calls).toEqual([
      expect.objectContaining({
        hostname:'8.8.8.8',
        host:'8.8.8.8',
        servername:'cdn.test',
      }),
    ]);
  });

  it("denies an anonymous request before resolving provider media when access is configured",async()=>{
    process.env.KHEYFLIX_ACCESS_TOKEN='test-access-code';
    process.env.KHEYFLIX_SESSION_SECRET='test-session-secret';
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN='test-internal-token';
    const fetchMock=vi.fn().mockResolvedValue(new Response('data'));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({error:{code:'ACCESS_REQUIRED'}});
    expect(resolveVideo).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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
    const fetchMock=vi.fn().mockResolvedValue(new Response('data',{status:206,headers:{'content-type':'video/mp4','content-length':'4','content-range':'bytes 0-3/4096'}}));
    vi.stubGlobal('fetch',fetchMock);
    const request=new Request('https://kheyflix.test/api/debrid/stream/42/0',{headers:{range:'bytes=0-3'}});
    const response=await GET(request,context);
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('data');
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.test/signed/movie.mp4',expect.objectContaining({method:'GET',headers:expect.objectContaining({Range:'bytes=0-3','Accept-Encoding':'identity'}),redirect:'manual'}));
    const options=fetchMock.mock.calls[0][1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal).not.toBe(request.signal);
    expect((options as RequestInit & {dispatcher?:unknown}).dispatcher).toBeTruthy();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(response.headers.get('server-timing')).toContain('provider;dur=');
  });

  it('keeps ordinary un-ranged relay requests as ordinary upstream GETs',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response('data',{status:200,headers:{'content-type':'video/mp4','content-length':'4'}}));
    vi.stubGlobal('fetch',fetchMock);
    const request=new Request('https://kheyflix.test/api/debrid/stream/42/0');
    const response=await GET(request,context);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('data');
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.test/signed/movie.mp4',expect.objectContaining({method:'GET',headers:{'Accept-Encoding':'identity'},redirect:'manual'}));
  });

  it('resolves relay URLs for the server and preserves HEAD semantics',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(null,{status:206,headers:{'content-length':'4','content-range':'bytes 0-3/4096'}}));
    vi.stubGlobal('fetch',fetchMock);
    const request=new Request('https://kheyflix.test/api/debrid/stream/42/0',{method:'HEAD',headers:{'x-real-ip':'203.0.113.7',range:'bytes=0-3'}});
    const response=await HEAD(request,context);
    expect(resolveVideo).toHaveBeenCalledWith(42,0,undefined);
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.test/signed/movie.mp4',expect.objectContaining({method:'HEAD'}));
    expect(response.body).toBeNull();
  });

  it('refreshes the signed link once when the provider is slow before the first byte',async()=>{
    process.env.KHEYFLIX_STREAM_FIRST_BYTE_TIMEOUT_MS='250';
    resolveVideo
      .mockResolvedValueOnce({url:'https://cdn.test/signed/slow.mp4',name:'Movie.mp4',size:4096})
      .mockResolvedValueOnce({url:'https://cdn.test/signed/fresh.mp4',name:'Movie.mp4',size:4096});
    let attempts=0;
    const fetchMock=vi.fn((_url:string,options:RequestInit)=>{
      attempts+=1;
      if(attempts===1)return new Promise<Response>((_resolve,reject)=>{
        options.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
      });
      return Promise.resolve(new Response('fresh-data',{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 20-4095/4096'}}));
    });
    vi.stubGlobal('fetch',fetchMock);
    const request=new Request('https://kheyflix.test/api/debrid/stream/42/0',{headers:{range:'bytes=20-'}});

    const response=await GET(request,context);

    expect(response.status).toBe(206);
    expect(await response.text()).toBe('fresh-data');
    expect(resolveVideo).toHaveBeenNthCalledWith(1,42,0,undefined);
    expect(resolveVideo).toHaveBeenNthCalledWith(2,42,0,undefined,true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({'Accept-Encoding':'identity',Range:'bytes=20-'});
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({'Accept-Encoding':'identity',Range:'bytes=20-'});
  });

  it('retries when headers arrive but the provider body stalls before a media byte',async()=>{
    process.env.KHEYFLIX_STREAM_FIRST_BYTE_TIMEOUT_MS='250';
    resolveVideo
      .mockResolvedValueOnce({url:'https://cdn.test/signed/stalled.mp4',name:'Movie.mp4',size:4096})
      .mockResolvedValueOnce({url:'https://cdn.test/signed/recovered.mp4',name:'Movie.mp4',size:4096});
    let attempts=0;
    const fetchMock=vi.fn((_url:string,options:RequestInit)=>{
      attempts+=1;
      if(attempts===1)return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          options.signal?.addEventListener('abort',()=>controller.error(new DOMException('aborted','AbortError')),{once:true});
        },
      }),{headers:{'content-type':'video/mp4'}}));
      return Promise.resolve(new Response('recovered-data',{headers:{'content-type':'video/mp4'}}));
    });
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('recovered-data');
    expect(resolveVideo).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not refresh after the viewer cancels before the first media byte',async()=>{
    process.env.KHEYFLIX_STREAM_FIRST_BYTE_TIMEOUT_MS='250';
    const client=new AbortController();
    const fetchMock=vi.fn((_url:string,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      options.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
    }));
    vi.stubGlobal('fetch',fetchMock);
    const pending=GET(new Request('https://kheyflix.test/api/debrid/stream/42/0',{signal:client.signal}),context);
    await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
    client.abort();

    const response=await pending;

    expect(response.status).toBe(499);
    expect(await response.json()).toMatchObject({error:{code:'STREAM_REQUEST_ABORTED'}});
    expect(resolveVideo).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a bounded safe timeout after one unsuccessful recovery attempt',async()=>{
    process.env.KHEYFLIX_STREAM_FIRST_BYTE_TIMEOUT_MS='250';
    const fetchMock=vi.fn((_url:string,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      options.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
    }));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({error:{code:'STREAM_UPSTREAM_TIMEOUT'}});
    expect(resolveVideo).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes an expired provider response once and then preserves the recovered media',async()=>{
    resolveVideo
      .mockResolvedValueOnce({url:'https://cdn.test/signed/expired.mp4',name:'Movie.mp4',size:4096})
      .mockResolvedValueOnce({url:'https://cdn.test/signed/recovered.mp4',name:'Movie.mp4',size:4096});
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response('expired',{status:403}))
      .mockResolvedValueOnce(new Response('recovered-data',{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 5-4095/4096'}}));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0',{headers:{range:'bytes=5-'}}),context);

    expect(response.status).toBe(206);
    expect(await response.text()).toBe('recovered-data');
    expect(resolveVideo).toHaveBeenNthCalledWith(2,42,0,undefined,true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({'Accept-Encoding':'identity',Range:'bytes=5-'});
  });

  it('does not make a third upstream attempt when recovery returns a retryable provider status',async()=>{
    process.env.KHEYFLIX_STREAM_FIRST_BYTE_TIMEOUT_MS='250';
    const fetchMock=vi.fn((_url:string,options:RequestInit)=>{
      if(fetchMock.mock.calls.length===1)return new Promise<Response>((_resolve,reject)=>{
        options.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
      });
      return Promise.resolve(new Response('still unavailable',{status:503}));
    });
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(503);
    expect(resolveVideo).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {status:416,headers:{'content-range':'bytes */4096'}},
    {status:429,headers:{'retry-after':'2'}},
  ])('does not refresh a provider $status response and preserves its retry metadata',async({status,headers})=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(null,{status,headers}));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(status);
    expect(resolveVideo).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if(status===416)expect(response.headers.get('content-range')).toBe('bytes */4096');
    else expect(response.headers.get('retry-after')).toBe('2');
  });

  it('rejects a provider hostname that resolves to both public and private addresses',async()=>{
    lookup.mockResolvedValue([
      {address:'8.8.8.8',family:4},
      {address:'127.0.0.1',family:4},
    ]);
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({error:{code:'STREAM_URL_UNSAFE'}});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsafe refreshed link before issuing a second provider request',async()=>{
    process.env.KHEYFLIX_STREAM_FIRST_BYTE_TIMEOUT_MS='250';
    resolveVideo
      .mockResolvedValueOnce({url:'https://cdn.test/signed/slow.mp4',name:'Movie.mp4',size:4096})
      .mockResolvedValueOnce({url:'http://cdn.test/signed/unsafe.mp4',name:'Movie.mp4',size:4096});
    const fetchMock=vi.fn((_url:string,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      options.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
    }));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({error:{code:'STREAM_URL_UNSAFE'}});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an insecure provider redirect before following it',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(null,{status:302,headers:{location:'http://cdn.test/unsafe.mp4'}}));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({error:{code:'STREAM_URL_UNSAFE'}});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://127.0.0.1/internal.mp4',
    'https://[::1]/internal.mp4',
    'https://[::ffff:127.0.0.1]/internal.mp4',
    'https://[::ffff:7f00:1]/internal.mp4',
    'https://[::ffff:a00:1]/internal.mp4',
    'https://[::7f00:1]/internal.mp4',
    'https://localhost/internal.mp4',
  ])('rejects a private provider URL without issuing an upstream request',async(url)=>{
    resolveVideo.mockResolvedValue({url,name:'Movie.mp4',size:4096});
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({error:{code:'STREAM_URL_UNSAFE'}});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects a private redirect before following it',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(null,{status:302,headers:{location:'https://127.0.0.1/internal.mp4'}}));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({error:{code:'STREAM_URL_UNSAFE'}});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a non-identity provider response before forwarding media bytes',async()=>{
    resolveVideo
      .mockResolvedValueOnce({url:'https://cdn.test/signed/compressed.mp4',name:'Movie.mp4',size:4096})
      .mockResolvedValueOnce({url:'https://cdn.test/signed/identity.mp4',name:'Movie.mp4',size:4096});
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response('compressed',{headers:{'content-encoding':'gzip'}}))
      .mockResolvedValueOnce(new Response('identity-data',{headers:{'content-type':'video/mp4','content-length':'13'}}));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-length')).toBe('13');
    expect(await response.text()).toBe('identity-data');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({'Accept-Encoding':'identity'});
  });

  it('preserves a valid single-range 206 response byte-for-byte',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response('data',{status:206,headers:{'content-type':'video/mp4','content-length':'4','content-range':'bytes 0-3/4096','accept-ranges':'bytes'}}));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0',{headers:{range:'bytes=0-3'}}),context);

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-3/4096');
    expect(response.headers.get('content-length')).toBe('4');
    expect(await response.text()).toBe('data');
  });

  it('recovers once, then fails closed when a ranged request gets an unbounded 200 response',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response('whole-file',{status:200,headers:{'content-type':'video/mp4'}}));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0',{headers:{range:'bytes=100-'}}),context);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({error:{code:'STREAM_UPSTREAM_RANGE'}});
    expect(resolveVideo).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves a valid suffix-range response',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response('tail',{status:206,headers:{'content-type':'video/mp4','content-length':'4','content-range':'bytes 4092-4095/4096'}}));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0',{headers:{range:'bytes=-500'}}),context);

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 4092-4095/4096');
    expect(await response.text()).toBe('tail');
  });

  it('does not reflect an upstream HTML type into the same-origin player response',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<script>bad</script>',{headers:{'content-type':'text/html'}})));

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it.each([204,304])('maps an unusable GET provider %s response to a safe 502',async(status)=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(null,{status}));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({error:{code:status===204?'STREAM_UPSTREAM_EMPTY':'STREAM_UPSTREAM_FAILED'}});
  });

  it('rejects multipart provider ranges before resolving provider media',async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0',{headers:{range:'bytes=0-3,6-9'}}),context);

    expect(response.status).toBe(416);
    expect(await response.json()).toMatchObject({error:{code:'INVALID_RANGE'}});
    expect(resolveVideo).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a zero-length suffix range before resolving provider media',async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0',{headers:{range:'bytes=-0'}}),context);

    expect(response.status).toBe(416);
    expect(await response.json()).toMatchObject({error:{code:'INVALID_RANGE'}});
    expect(resolveVideo).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recovers once, then fails closed when a range response has a mismatched content length',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response('data',{status:206,headers:{'content-type':'video/mp4','content-length':'3','content-range':'bytes 0-3/4096'}}));
    vi.stubGlobal('fetch',fetchMock);

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0',{headers:{range:'bytes=0-3'}}),context);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({error:{code:'STREAM_UPSTREAM_RANGE'}});
    expect(resolveVideo).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forwards a primed chunk once and cancels the provider body when the viewer leaves',async()=>{
    const encoder=new TextEncoder();
    let canceled=false;
    const source=new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('first-chunk'));
      },
      pull() {
        return new Promise<void>(()=>{});
      },
      cancel() {
        canceled=true;
      },
    });
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(source,{headers:{'content-type':'video/mp4'}})));

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);
    const reader=response.body?.getReader();
    expect(new TextDecoder().decode((await reader?.read()).value)).toBe('first-chunk');
    await reader?.cancel();

    expect(canceled).toBe(true);
    expect(resolveVideo).toHaveBeenCalledTimes(1);
  });

  it('cancels the provider body when the request aborts after the first chunk',async()=>{
    const client=new AbortController();
    const encoder=new TextEncoder();
    let canceled=false;
    const source=new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('first-chunk'));
      },
      pull() {
        return new Promise<void>(()=>{});
      },
      cancel() {
        canceled=true;
      },
    });
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(source,{headers:{'content-type':'video/mp4'}})));

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0',{signal:client.signal}),context);
    const reader=response.body?.getReader();
    await reader?.read();
    client.abort();

    await vi.waitFor(()=>expect(canceled).toBe(true));
    expect(resolveVideo).toHaveBeenCalledTimes(1);
  });

  it('uses a safe inline filename for provider-controlled media names',async()=>{
    resolveVideo.mockResolvedValue({url:'https://cdn.test/signed/movie.mp4',name:'Movie"\\r\\nInjected: header.mp4',size:4096});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('data',{headers:{'content-type':'video/mp4'}})));

    const response=await GET(new Request('https://kheyflix.test/api/debrid/stream/42/0'),context);

    expect(response.headers.get('content-disposition')).toBe('inline; filename="MoviernInjected: header.mp4"');
  });
});
