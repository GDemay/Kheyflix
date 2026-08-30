import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllDebridError, contentTypeFor, listMagnets, resolveVideo, uploadMagnet } from './alldebrid';

afterEach(()=>{delete process.env.ALLDEBRID_API_KEY;vi.restoreAllMocks();vi.unstubAllGlobals()});

const deferred=<T>()=>{
  let resolve!:(value:T|PromiseLike<T>)=>void;
  let reject!:(reason?:unknown)=>void;
  const promise=new Promise<T>((nextResolve,nextReject)=>{
    resolve=nextResolve;
    reject=nextReject;
  });
  return {promise,resolve,reject};
};

describe('AllDebrid server integration',()=>{
  it('never runs without a server-side key',async()=>{
    await expect(listMagnets()).rejects.toMatchObject({code:'ALLDEBRID_NOT_CONFIGURED',status:503});
  });

  it('rejects malformed magnets before transmitting them',async()=>{
    await expect(uploadMagnet('https://example.com/movie')).rejects.toBeInstanceOf(AllDebridError);
  });

  it('maps HTTP 200 provider errors to a failing gateway status',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'error',error:{code:'AUTH_USER_BANNED',message:'This account is banned'}}),{status:200})));
    await expect(resolveVideo(999_999,0)).rejects.toMatchObject({code:'AUTH_USER_BANNED',status:502,message:'This account is banned'});
  });

  it('maps common movie containers to browser media types',()=>{
    expect(contentTypeFor('movie.webm')).toBe('video/webm');
    expect(contentTypeFor('movie.mkv')).toBe('video/x-matroska');
    expect(contentTypeFor('movie.mp4')).toBe('video/mp4');
  });

  it('turns ready account magnets into indexed playable video files',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{magnets:[{id:42,filename:'Example.Show.S01',size:3000,status:'Ready',statusCode:4}]}}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{magnets:[{id:42,files:[{n:'Season 1',e:[{n:'Example.Show.S01E01.mp4',s:2000,l:'https://files.test/episode-1'},{n:'poster.jpg',s:100,l:'https://files.test/poster'}]}]}]}}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    await expect(listMagnets()).resolves.toEqual([{id:42,filename:'Example.Show.S01',size:3000,status:'Ready',statusCode:4,videoFiles:[{index:0,name:'Example.Show.S01E01.mp4',size:2000,path:'Season 1/Example.Show.S01E01.mp4'}]}]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/v4.1/magnet/status');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-only-key');
  });

  it('resolves a selected account file to an unlocked stream URL',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{magnets:[{id:42,files:[{n:'Movie.webm',s:4096,l:'https://files.test/movie'}]}]}}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{link:'https://cdn.test/movie.webm',filename:'Movie.webm',filesize:4096}}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    await expect(resolveVideo(42,0)).resolves.toEqual({url:'https://cdn.test/movie.webm',name:'Movie.webm',size:4096});
    expect(fetchMock.mock.calls[1][0]).toContain('/v4/link/unlock');
  });

  it('records provider response timing without provider links or credentials',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    const output=vi.spyOn(console,'info').mockImplementation(()=>undefined);
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{magnets:[{id:77,files:[{n:'Movie.mp4',s:4096,l:'https://files.test/private-link'}]}]}}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{link:'https://cdn.test/private-link',filename:'Movie.mp4',filesize:4096}}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);

    await resolveVideo(77,0);

    const events=output.mock.calls.map(([entry])=>JSON.parse(String(entry)));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({event:'alldebrid.request.completed',operation:'magnet.files',status:200,durationMs:expect.any(Number)}),
      expect.objectContaining({event:'alldebrid.request.completed',operation:'link.unlock',status:200,durationMs:expect.any(Number)}),
    ]));
    const serialized=JSON.stringify(events);
    expect(serialized).not.toContain('test-only-key');
    expect(serialized).not.toContain('private-link');
  });

  it('can refresh an expired unlocked stream URL',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    const files={status:'success',data:{magnets:[{id:43,files:[{n:'Pilot.mkv',s:4096,l:'https://files.test/pilot'}]}]}};
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(files),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{link:'https://cdn.test/old.mkv'}}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify(files),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{link:'https://cdn.test/fresh.mkv'}}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    await expect(resolveVideo(43,0)).resolves.toMatchObject({url:'https://cdn.test/old.mkv'});
    await expect(resolveVideo(43,0,undefined,true)).resolves.toMatchObject({url:'https://cdn.test/fresh.mkv'});
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('shares one deadline across file lookup and unlock without starting a late unlock',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    let now=1_000;
    vi.spyOn(Date,'now').mockImplementation(()=>now);
    const fetchMock=vi.fn().mockImplementationOnce(async()=>{
      now+=20_000;
      return new Response(JSON.stringify({status:'success',data:{magnets:[{id:910003,files:[{n:'Late.Movie.mp4',s:4096,l:'https://files.test/late'}]}]}}),{status:200});
    });
    vi.stubGlobal('fetch',fetchMock);

    await expect(resolveVideo(910003,0)).rejects.toMatchObject({code:'STREAM_RESOLUTION_TIMEOUT',status:504});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/v4/magnet/files');
  });

  it('gives unlock only the resolver time remaining after file lookup',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    let now=1_000;
    vi.spyOn(Date,'now').mockImplementation(()=>now);
    const timeout=vi.spyOn(AbortSignal,'timeout');
    const fetchMock=vi.fn()
      .mockImplementationOnce(async()=>{
        now+=15_000;
        return new Response(JSON.stringify({status:'success',data:{magnets:[{id:910004,files:[{n:'Budget.Movie.mp4',s:4096,l:'https://files.test/budget'}]}]}}),{status:200});
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{link:'https://cdn.test/budget.mp4'}}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);

    await expect(resolveVideo(910004,0)).resolves.toMatchObject({url:'https://cdn.test/budget.mp4'});

    expect(timeout).toHaveBeenNthCalledWith(1,7_500);
    expect(timeout).toHaveBeenNthCalledWith(2,5_000);
  });

  it('retries a transient provider failure within the request budget',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    const fetchMock=vi.fn()
      .mockRejectedValueOnce(new Error('temporary network interruption'))
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{magnets:[{id:910001,files:[{n:'Retry.Movie.mp4',s:4096,l:'https://files.test/retry'}]}]}}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{link:'https://cdn.test/retry.mp4',filename:'Retry.Movie.mp4',filesize:4096}}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);

    await expect(resolveVideo(910001,0)).resolves.toMatchObject({url:'https://cdn.test/retry.mp4'});
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('coalesces concurrent forced stream refreshes into one provider resolution',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{magnets:[{id:910002,files:[{n:'Shared.Movie.mp4',s:4096,l:'https://files.test/shared'}]}]}}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'success',data:{link:'https://cdn.test/shared.mp4',filename:'Shared.Movie.mp4',filesize:4096}}),{status:200}));
    vi.stubGlobal('fetch',fetchMock);

    const [first,second]=await Promise.all([
      resolveVideo(910002,0,undefined,true),
      resolveVideo(910002,0,undefined,true),
    ]);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lets one canceled viewer leave a coalesced resolution without aborting other viewers',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    const files=deferred<Response>();
    let calls=0;
    let providerSignal:AbortSignal|undefined;
    const fetchMock=vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>{
      calls+=1;
      if(calls===1){
        providerSignal=init?.signal as AbortSignal;
        return files.promise;
      }
      return Promise.resolve(new Response(JSON.stringify({status:'success',data:{link:'https://cdn.test/coalesced.mp4',filename:'Coalesced.mp4',filesize:4096}}),{status:200}));
    });
    vi.stubGlobal('fetch',fetchMock);
    const firstViewer=new AbortController();
    const secondViewer=new AbortController();
    const first=resolveVideo(910005,0,undefined,false,{signal:firstViewer.signal});
    const second=resolveVideo(910005,0,undefined,false,{signal:secondViewer.signal});
    let firstError:unknown;
    void first.catch((error)=>{firstError=error;});

    await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
    firstViewer.abort();

    await vi.waitFor(()=>expect(firstError).toMatchObject({code:'STREAM_REQUEST_ABORTED',status:499}));
    expect(providerSignal?.aborted).toBe(false);
    files.resolve(new Response(JSON.stringify({status:'success',data:{magnets:[{id:910005,files:[{n:'Coalesced.mp4',s:4096,l:'https://files.test/coalesced'}]}]}}),{status:200}));

    await expect(second).resolves.toEqual({url:'https://cdn.test/coalesced.mp4',name:'Coalesced.mp4',size:4096});
    await expect(resolveVideo(910005,0)).resolves.toEqual({url:'https://cdn.test/coalesced.mp4',name:'Coalesced.mp4',size:4096});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts the provider only after the final viewer leaves and ignores a late provider result',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    const files=deferred<Response>();
    let calls=0;
    let providerSignal:AbortSignal|undefined;
    const fetchMock=vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>{
      calls+=1;
      if(calls===1){
        providerSignal=init?.signal as AbortSignal;
        return files.promise;
      }
      if(calls===2)
        return Promise.resolve(new Response(JSON.stringify({status:'success',data:{magnets:[{id:910006,files:[{n:'Fresh.mp4',s:4096,l:'https://files.test/fresh'}]}]}}),{status:200}));
      return Promise.resolve(new Response(JSON.stringify({status:'success',data:{link:'https://cdn.test/fresh.mp4',filename:'Fresh.mp4',filesize:4096}}),{status:200}));
    });
    vi.stubGlobal('fetch',fetchMock);
    const viewer=new AbortController();
    const pending=resolveVideo(910006,0,undefined,false,{signal:viewer.signal});
    let viewerError:unknown;
    void pending.catch((error)=>{viewerError=error;});

    await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
    viewer.abort();

    await vi.waitFor(()=>expect(viewerError).toMatchObject({code:'STREAM_REQUEST_ABORTED',status:499}));
    expect(providerSignal?.aborted).toBe(true);
    files.resolve(new Response(JSON.stringify({status:'success',data:{magnets:[{id:910006,files:[{n:'Late.mp4',s:4096,l:'https://files.test/late'}]}]}}),{status:200}));
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(resolveVideo(910006,0)).resolves.toEqual({url:'https://cdn.test/fresh.mp4',name:'Fresh.mp4',size:4096});
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not mutate resolver state for an already canceled viewer',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    const viewer=new AbortController();
    viewer.abort();
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);

    await expect(resolveVideo(910007,0,undefined,false,{signal:viewer.signal})).rejects.toMatchObject({code:'STREAM_REQUEST_ABORTED',status:499});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops a retry delay when the final viewer leaves',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    const viewer=new AbortController();
    const fetchMock=vi.fn().mockRejectedValue(new Error('temporary provider failure'));
    vi.stubGlobal('fetch',fetchMock);
    const pending=resolveVideo(910008,0,undefined,false,{signal:viewer.signal});

    await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
    viewer.abort();

    await expect(pending).rejects.toMatchObject({code:'STREAM_REQUEST_ABORTED',status:499});
    await new Promise((resolve)=>setTimeout(resolve,250));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps resolver capacity reserved until abort-resistant provider requests settle',async()=>{
    process.env.ALLDEBRID_API_KEY='test-only-key';
    const providers:Array<(response:Response)=>void>=[];
    const fetchMock=vi.fn(()=>new Promise<Response>((resolve)=>providers.push(resolve)));
    vi.stubGlobal('fetch',fetchMock);
    const viewers=Array.from({length:64},()=>new AbortController());
    const pending=viewers.map((viewer,index)=>
      resolveVideo(920000+index,0,undefined,false,{signal:viewer.signal}),
    );

    await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(64));
    viewers.forEach((viewer)=>viewer.abort());
    const canceled=await Promise.all(pending.map((request)=>request.catch((error)=>error)));
    for(const error of canceled)
      expect(error).toMatchObject({code:'STREAM_REQUEST_ABORTED',status:499});

    await expect(resolveVideo(920100,0)).rejects.toMatchObject({code:'STREAM_RESOLVER_BUSY',status:429});
    expect(fetchMock).toHaveBeenCalledTimes(64);

    providers.forEach((resolve,index)=>resolve(new Response(JSON.stringify({status:'success',data:{magnets:[{id:920000+index,files:[{n:'Late.mp4',s:4096,l:'https://files.test/late'}]}]}}),{status:200})));
    const active=(globalThis as typeof globalThis & {__kheyflixStreamActiveRequests?:Set<unknown>}).__kheyflixStreamActiveRequests;
    await vi.waitFor(()=>expect(active?.size).toBe(0));

    const fresh=resolveVideo(920101,0);
    await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(65));
    providers[64]?.(new Response(JSON.stringify({status:'success',data:{magnets:[{id:920101,files:[{n:'Fresh.mp4',s:4096,l:'https://files.test/fresh'}]}]}}),{status:200}));
    await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(66));
    providers[65]?.(new Response(JSON.stringify({status:'success',data:{link:'https://cdn.test/fresh.mp4',filename:'Fresh.mp4',filesize:4096}}),{status:200}));
    await expect(fresh).resolves.toEqual({url:'https://cdn.test/fresh.mp4',name:'Fresh.mp4',size:4096});
  });
});
