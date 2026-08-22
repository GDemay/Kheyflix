import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllDebridError, contentTypeFor, listMagnets, resolveVideo, uploadMagnet } from './alldebrid';

afterEach(()=>{delete process.env.ALLDEBRID_API_KEY;vi.unstubAllGlobals()});

describe('AllDebrid server integration',()=>{
  it('never runs without a server-side key',async()=>{
    await expect(listMagnets()).rejects.toMatchObject({code:'ALLDEBRID_NOT_CONFIGURED',status:503});
  });

  it('rejects malformed magnets before transmitting them',async()=>{
    await expect(uploadMagnet('https://example.com/movie')).rejects.toBeInstanceOf(AllDebridError);
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
});
