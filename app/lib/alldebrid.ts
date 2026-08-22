const API_ROOT = 'https://api.alldebrid.com';
const VIDEO_EXTENSIONS = new Set(['mp4','m4v','webm','mkv','mov','avi','ts','m2ts']);

export class AllDebridError extends Error {
  constructor(message:string, public code='ALLDEBRID_ERROR', public status=502) { super(message); }
}

type ApiEnvelope<T> = { status:'success'|'error'; data?:T; error?:{code:string;message:string} };
type FileNode = { n:string; s?:number; l?:string; e?:FileNode[] };
export type DebridVideoFile = { index:number; name:string; size:number; path:string };
export type DebridMagnet = { id:number; filename:string; size:number; status:string; statusCode:number; downloaded?:number; downloadSpeed?:number; videoFiles:DebridVideoFile[] };

type CacheEntry<T> = { value:T; updatedAt:number };
const shared = globalThis as typeof globalThis & {
  __kheyflixMagnetCache?:CacheEntry<DebridMagnet[]>;
  __kheyflixMagnetRequest?:Promise<DebridMagnet[]>;
  __kheyflixStreamCache?:Map<string,CacheEntry<{url:string;name:string;size:number}>>;
};
const CATALOG_FRESH_MS=5*60_000;
const CATALOG_STALE_MS=24*60*60_000;
const STREAM_FRESH_MS=10*60_000;

const apiKey = () => {
  const key = process.env.ALLDEBRID_API_KEY;
  if (!key) throw new AllDebridError('AllDebrid is not configured. Set ALLDEBRID_API_KEY on the server.', 'ALLDEBRID_NOT_CONFIGURED', 503);
  return key;
};

async function request<T>(path:string, fields:Record<string,string|string[]> = {}):Promise<T> {
  const body = new URLSearchParams();
  Object.entries(fields).forEach(([key,value]) => Array.isArray(value) ? value.forEach(item=>body.append(`${key}[]`,item)) : body.set(key,value));
  const response = await fetch(`${API_ROOT}${path}`, { method:'POST', headers:{ Authorization:`Bearer ${apiKey()}`, 'Content-Type':'application/x-www-form-urlencoded' }, body, cache:'no-store' });
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!response.ok || envelope.status !== 'success' || !envelope.data) throw new AllDebridError(envelope.error?.message || 'AllDebrid request failed.', envelope.error?.code, response.status || 502);
  return envelope.data;
}

const flattenFiles = (nodes:FileNode[], parent=''):Array<{name:string;size:number;link:string;path:string}> => nodes.flatMap((node) => {
  const path = parent ? `${parent}/${node.n}` : node.n;
  if (node.e) return flattenFiles(node.e,path);
  return node.l ? [{name:node.n,size:node.s || 0,link:node.l,path}] : [];
});

const isVideo = (name:string) => VIDEO_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() || '');

async function filesForMagnet(id:number) {
  const data = await request<{magnets:Array<{id:string|number;files?:FileNode[];error?:{message:string}}>}>('/v4/magnet/files',{id:[String(id)]});
  const magnet = data.magnets[0];
  if (!magnet || magnet.error) throw new AllDebridError(magnet?.error?.message || 'Magnet files are unavailable.','MAGNET_FILES_UNAVAILABLE',404);
  return flattenFiles(magnet.files || []).filter(file=>isVideo(file.name)).sort((a,b)=>b.size-a.size);
}

async function filesForMagnets(ids:number[]) {
  if (!ids.length) return new Map<number,DebridVideoFile[]>();
  const data = await request<{magnets:Array<{id:string|number;files?:FileNode[];error?:{message:string}}>}>('/v4/magnet/files',{id:ids.map(String)});
  return new Map((data.magnets || []).map(magnet => {
    const videos = magnet.error ? [] : flattenFiles(magnet.files || []).filter(file=>isVideo(file.name)).sort((a,b)=>b.size-a.size).map(({name,size,path},index)=>({index,name,size,path}));
    return [Number(magnet.id),videos] as const;
  }));
}

async function fetchMagnets():Promise<DebridMagnet[]> {
  const data=await request<{magnets:Array<Omit<DebridMagnet,'videoFiles'>>}>('/v4.1/magnet/status');
  const magnets=data.magnets||[];
  const files=await filesForMagnets(magnets.filter(magnet=>magnet.statusCode===4).map(magnet=>magnet.id));
  return magnets.map(magnet=>({...magnet,videoFiles:files.get(magnet.id)||[]}));
}

export async function listMagnetsCached(force=false):Promise<{magnets:DebridMagnet[];cached:boolean;stale:boolean}> {
  const now=Date.now();const cached=shared.__kheyflixMagnetCache;
  if(!force&&cached&&now-cached.updatedAt<CATALOG_FRESH_MS)return{magnets:cached.value,cached:true,stale:false};
  if(!shared.__kheyflixMagnetRequest){
    shared.__kheyflixMagnetRequest=fetchMagnets().then(value=>{shared.__kheyflixMagnetCache={value,updatedAt:Date.now()};return value}).finally(()=>{shared.__kheyflixMagnetRequest=undefined});
  }
  try{return{magnets:await shared.__kheyflixMagnetRequest,cached:false,stale:false}}
  catch(error){if(cached&&now-cached.updatedAt<CATALOG_STALE_MS)return{magnets:cached.value,cached:true,stale:true};throw error}
}

export async function listMagnets():Promise<DebridMagnet[]>{return(await listMagnetsCached()).magnets}

export async function uploadMagnet(magnet:string) {
  const normalized = magnet.trim();
  if (!/^magnet:\?xt=urn:btih:[a-zA-Z0-9]+/i.test(normalized)) throw new AllDebridError('Enter a valid BitTorrent magnet URI.','MAGNET_INVALID_URI',400);
  const data = await request<{magnets:Array<{id?:number;name?:string;hash?:string;size?:number;ready?:boolean;error?:{code:string;message:string}}>}>('/v4/magnet/upload',{magnets:[normalized]});
  const result = data.magnets[0];
  if (!result || result.error || !result.id) throw new AllDebridError(result?.error?.message || 'The magnet could not be added.',result?.error?.code,400);
  return result;
}

export async function resolveVideo(id:number,index:number) {
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(index) || index < 0) throw new AllDebridError('Invalid media selection.','INVALID_MEDIA',400);
  const key=`${id}:${index}`;const cached=shared.__kheyflixStreamCache?.get(key);
  if(cached&&Date.now()-cached.updatedAt<STREAM_FRESH_MS)return cached.value;
  const videos = await filesForMagnet(id);
  const selected = videos[index];
  if (!selected) throw new AllDebridError('Video file not found.','VIDEO_NOT_FOUND',404);
  const unlocked = await request<{link?:string;filename?:string;filesize?:number;delayed?:number}>('/v4/link/unlock',{link:selected.link});
  if (!unlocked.link) throw new AllDebridError(unlocked.delayed ? 'The stream is still being prepared. Try again shortly.' : 'The stream could not be unlocked.','STREAM_PREPARING',409);
  const value={url:unlocked.link,name:unlocked.filename||selected.name,size:unlocked.filesize||selected.size};
  (shared.__kheyflixStreamCache??=new Map()).set(key,{value,updatedAt:Date.now()});
  return value;
}

export const contentTypeFor = (filename:string) => {
  const ext=filename.split('.').pop()?.toLowerCase();
  return ext==='webm'?'video/webm':ext==='mkv'?'video/x-matroska':ext==='m4v'?'video/x-m4v':ext==='mov'?'video/quicktime':'video/mp4';
};
