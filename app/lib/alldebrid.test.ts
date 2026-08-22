import { afterEach, describe, expect, it } from 'vitest';
import { AllDebridError, contentTypeFor, listMagnets, uploadMagnet } from './alldebrid';

afterEach(()=>{delete process.env.ALLDEBRID_API_KEY});

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
});
