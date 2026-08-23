import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllDebridError } from '../../../lib/alldebrid';
import { proxyVideo } from './[id]/[file]/route';

const params = Promise.resolve({id:'42',file:'0'});
const media = vi.fn(async()=>({url:'https://cdn.test/movie.mp4',name:'Movie.mp4',size:4096}));

describe('AllDebrid byte-range proxy',()=>{
  beforeEach(()=>vi.clearAllMocks());
  it('forwards iOS media byte ranges and preserves seek headers',async()=>{
    const upstream=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      expect(new Headers(init?.headers).get('range')).toBe('bytes=100-199');
      return new Response(new Uint8Array(100),{status:206,headers:{
        'Content-Type':'video/mp4','Content-Length':'100','Content-Range':'bytes 100-199/4096','Accept-Ranges':'bytes',
      }});
    });
    const response=await proxyVideo(new Request('http://local/stream',{headers:{Range:'bytes=100-199'}}),params,media,upstream as typeof fetch);
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 100-199/4096');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect((await response.arrayBuffer()).byteLength).toBe(100);
  });

  it('rejects malformed or multi-part byte ranges before contacting AllDebrid',async()=>{
    const response=await proxyVideo(new Request('http://local/stream',{headers:{Range:'bytes=0-1,4-5'}}),params,media,vi.fn() as typeof fetch);
    expect(response.status).toBe(416);
    expect(media).not.toHaveBeenCalled();
  });

  it('preserves actionable AllDebrid failures',async()=>{
    const resolver=vi.fn(async()=>{throw new AllDebridError('Account access denied.','AUTH_USER_BANNED',401)});
    const response=await proxyVideo(new Request('http://local/stream'),params,resolver,vi.fn() as typeof fetch);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({error:{code:'AUTH_USER_BANNED',message:'Account access denied.'}});
  });

  it('sanitizes upstream filenames used in response headers',async()=>{
    const resolver=vi.fn(async()=>({url:'https://cdn.test/movie',name:'Movie\r\n".mp4',size:1}));
    const upstream=vi.fn(async()=>new Response(new Uint8Array([1]),{status:200}));
    const response=await proxyVideo(new Request('http://local/stream'),params,resolver,upstream as typeof fetch);
    expect(response.headers.get('content-disposition')).toBe('inline; filename="Movie.mp4"');
  });
});
