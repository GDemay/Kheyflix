import { writeLog } from "./observability";

const API_ROOT = 'https://api.alldebrid.com';
const VIDEO_EXTENSIONS = new Set(['mp4','m4v','webm','mkv','mov','avi','ts','m2ts']);

export class AllDebridError extends Error {
  constructor(
    message:string,
    public code='ALLDEBRID_ERROR',
    public status=502,
    public retryable=false,
  ) { super(message); }
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
  __kheyflixStreamRequests?:Map<string,Promise<{url:string;name:string;size:number}>>;
  __kheyflixAllDebridHealth?:CacheEntry<boolean>;
  __kheyflixAllDebridHealthRequest?:Promise<boolean>;
};
const CATALOG_FRESH_MS=5*60_000;
const CATALOG_STALE_MS=24*60*60_000;
const STREAM_FRESH_MS=10*60_000;
const STREAM_CACHE_MAX=128;
const STREAM_REQUEST_MAX=64;
const API_TIMEOUT_MS=15_000;
// Resolving a playable URL performs two dependent provider operations. Keep
// one deadline across both so a slow file lookup cannot spend another full
// provider timeout on an unlock that can no longer help startup.
const RESOLVE_TIMEOUT_MS=20_000;
const HEALTH_TIMEOUT_MS=2_000;
const HEALTH_FRESH_MS=60_000;

const apiKey = () => {
  const key = process.env.ALLDEBRID_API_KEY;
  if (!key) throw new AllDebridError('AllDebrid is not configured. Set ALLDEBRID_API_KEY on the server.', 'ALLDEBRID_NOT_CONFIGURED', 503);
  return key;
};

const providerOperation = (path:string) =>
  path.replace(/^\/v4(?:\.1)?\//,'').replaceAll('/','.');

const waitForRetry = (milliseconds:number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const resolutionTimeout = () =>
  new AllDebridError(
    "The media service took too long to prepare this stream. Try again shortly.",
    "STREAM_RESOLUTION_TIMEOUT",
    504,
  );

async function request<T>(
  path:string,
  fields:Record<string,string|string[]> = {},
  timeoutMs=API_TIMEOUT_MS,
  retryable=false,
  deadlineAt?:number,
):Promise<T> {
  const body = new URLSearchParams();
  Object.entries(fields).forEach(([key,value]) => Array.isArray(value) ? value.forEach(item=>body.append(`${key}[]`,item)) : body.set(key,value));
  const startedAt = performance.now(), operation = providerOperation(path);
  let lastError:unknown;
  const attempts = retryable ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const elapsed = performance.now() - startedAt,
      remaining = Math.min(
        timeoutMs - elapsed,
        deadlineAt === undefined ? Number.POSITIVE_INFINITY : deadlineAt - Date.now(),
      );
    if (remaining <= 0) {
      if (deadlineAt !== undefined) throw resolutionTimeout();
      break;
    }
    try {
      const response = await fetch(`${API_ROOT}${path}`, { method:'POST', headers:{ Authorization:`Bearer ${apiKey()}`, 'Content-Type':'application/x-www-form-urlencoded' }, body, cache:'no-store', signal:AbortSignal.timeout(Math.max(1, Math.floor(Math.min(7_500, remaining)))) });
      const envelope = await response.json() as ApiEnvelope<T>;
      if (deadlineAt !== undefined && Date.now() >= deadlineAt)
        throw resolutionTimeout();
      if (!response.ok || envelope.status !== 'success' || !envelope.data) {
        // AllDebrid can report application errors in an HTTP 200 envelope. Never
        // forward that 200 to media consumers: FFmpeg would otherwise try to
        // decode the JSON error body as video and loop on "invalid data".
        const status = response.ok ? 502 : response.status;
        throw new AllDebridError(
          envelope.error?.message || 'AllDebrid request failed.',
          envelope.error?.code,
          status,
          response.status === 429 || response.status >= 500,
        );
      }
      writeLog('info','alldebrid.request.completed',{operation,status:response.status,durationMs:Number((performance.now() - startedAt).toFixed(1)),attempt:attempt + 1});
      return envelope.data;
    } catch (error) {
      lastError = error;
      if (deadlineAt !== undefined && Date.now() >= deadlineAt)
        throw resolutionTimeout();
      const elapsedAfterFailure = performance.now() - startedAt,
        remainingAfterFailure = Math.min(
          timeoutMs - elapsedAfterFailure,
          deadlineAt === undefined
            ? Number.POSITIVE_INFINITY
            : deadlineAt - Date.now(),
        ),
        canRetry =
          retryable &&
          attempt + 1 < attempts &&
          remainingAfterFailure > 200 &&
          (!(error instanceof AllDebridError) || error.retryable);
      if (canRetry) {
        await waitForRetry(Math.min(200 * (attempt + 1), remainingAfterFailure));
        continue;
      }
      const durationMs = Number((performance.now() - startedAt).toFixed(1));
      if (error instanceof AllDebridError) {
        writeLog('warn','alldebrid.request.failed',{operation,status:error.status,durationMs,errorCode:error.code,attempt:attempt + 1});
        throw error;
      }
      writeLog('error','alldebrid.request.failed',{
        operation,
        durationMs,
        attempt:attempt + 1,
        error:error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AllDebrid request timed out.');
}

export async function isAllDebridReady() {
  if (!process.env.ALLDEBRID_API_KEY?.trim()) return false;
  const now = Date.now(), cached = shared.__kheyflixAllDebridHealth;
  if (
    process.env.NODE_ENV !== "test" &&
    cached &&
    now - cached.updatedAt < HEALTH_FRESH_MS
  )
    return cached.value;
  if (shared.__kheyflixAllDebridHealthRequest)
    return shared.__kheyflixAllDebridHealthRequest;
  const healthRequest = request<unknown>("/v4/user", {}, HEALTH_TIMEOUT_MS, true)
    .then(() => true)
    .catch(() => false)
    .then((value) => {
      shared.__kheyflixAllDebridHealth = { value, updatedAt: Date.now() };
      return value;
    })
    .finally(() => {
      shared.__kheyflixAllDebridHealthRequest = undefined;
    });
  shared.__kheyflixAllDebridHealthRequest = healthRequest;
  return healthRequest;
}

export const clearAllDebridHealthForTests = () => {
  shared.__kheyflixAllDebridHealth = undefined;
  shared.__kheyflixAllDebridHealthRequest = undefined;
};

const flattenFiles = (nodes:FileNode[], parent=''):Array<{name:string;size:number;link:string;path:string}> => nodes.flatMap((node) => {
  const path = parent ? `${parent}/${node.n}` : node.n;
  if (node.e) return flattenFiles(node.e,path);
  return node.l ? [{name:node.n,size:node.s || 0,link:node.l,path}] : [];
});

const isVideo = (name:string) => VIDEO_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() || '');

async function filesForMagnet(id:number, deadlineAt?:number) {
  const data = await request<{magnets:Array<{id:string|number;files?:FileNode[];error?:{message:string}}>}>('/v4/magnet/files',{id:[String(id)]},API_TIMEOUT_MS,true,deadlineAt);
  const magnet = data.magnets[0];
  if (!magnet || magnet.error) throw new AllDebridError(magnet?.error?.message || 'Magnet files are unavailable.','MAGNET_FILES_UNAVAILABLE',404);
  return flattenFiles(magnet.files || []).filter(file=>isVideo(file.name)).sort((a,b)=>b.size-a.size);
}

async function filesForMagnets(ids:number[]) {
  if (!ids.length) return new Map<number,DebridVideoFile[]>();
  const data = await request<{magnets:Array<{id:string|number;files?:FileNode[];error?:{message:string}}>}>('/v4/magnet/files',{id:ids.map(String)},API_TIMEOUT_MS,true);
  return new Map((data.magnets || []).map(magnet => {
    const videos = magnet.error ? [] : flattenFiles(magnet.files || []).filter(file=>isVideo(file.name)).sort((a,b)=>b.size-a.size).map(({name,size,path},index)=>({index,name,size,path}));
    return [Number(magnet.id),videos] as const;
  }));
}

async function fetchMagnets():Promise<DebridMagnet[]> {
  const data=await request<{magnets:Array<Omit<DebridMagnet,'videoFiles'>>}>('/v4.1/magnet/status',{},API_TIMEOUT_MS,true);
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

const pruneStreamCache = (now=Date.now()) => {
  const cache=shared.__kheyflixStreamCache;
  if(!cache)return;
  for(const[key,entry]of cache)if(now-entry.updatedAt>=STREAM_FRESH_MS)cache.delete(key);
  while(cache.size>STREAM_CACHE_MAX)cache.delete(cache.keys().next().value as string);
};

export async function resolveVideo(id:number,index:number,clientIp?:string,refresh=false) {
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(index) || index < 0) throw new AllDebridError('Invalid media selection.','INVALID_MEDIA',400);
  const key=`${id}:${index}:${clientIp||'server'}`,now=Date.now();pruneStreamCache(now);
  const cache=shared.__kheyflixStreamCache??=new Map(),cached=cache.get(key);
  const requests=shared.__kheyflixStreamRequests??=new Map(),pending=requests.get(key);
  if(pending)return pending;
  if(refresh)cache.delete(key);
  if(!refresh&&cached&&now-cached.updatedAt<STREAM_FRESH_MS){cache.delete(key);cache.set(key,cached);return cached.value}
  if(requests.size>=STREAM_REQUEST_MAX)throw new AllDebridError('The playback resolver is busy. Try again shortly.','STREAM_RESOLVER_BUSY',429);
  const deadlineAt=Date.now()+RESOLVE_TIMEOUT_MS;
  const resolve=(async()=>{
    const videos = await filesForMagnet(id,deadlineAt);
    const selected = videos[index];
    if (!selected) throw new AllDebridError('Video file not found.','VIDEO_NOT_FOUND',404);
    const unlocked = await request<{link?:string;filename?:string;filesize?:number;delayed?:number}>('/v4/link/unlock',{link:selected.link,...(clientIp?{ip:clientIp}:{})},API_TIMEOUT_MS,true,deadlineAt);
    if (!unlocked.link) throw new AllDebridError(unlocked.delayed ? 'The stream is still being prepared. Try again shortly.' : 'The stream could not be unlocked.','STREAM_PREPARING',409);
    const value={url:unlocked.link,name:unlocked.filename||selected.name,size:unlocked.filesize||selected.size};
    cache.set(key,{value,updatedAt:Date.now()});pruneStreamCache();return value;
  })().finally(()=>{
    if(requests.get(key)===resolve)requests.delete(key);
  });
  requests.set(key,resolve);return resolve;
}

export const contentTypeFor = (filename:string) => {
  const ext=filename.split('.').pop()?.toLowerCase();
  return ext==='webm'?'video/webm':ext==='mkv'?'video/x-matroska':ext==='m4v'?'video/x-m4v':ext==='mov'?'video/quicktime':'video/mp4';
};
