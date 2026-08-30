import { AllDebridError } from '../../../../../lib/alldebrid';
import { requireProviderAccess } from '../../../../../lib/access';
import { observeApi, publicErrorMessage, writeRequestLog } from '../../../../../lib/observability';

const handleGet=async(request:Request,{params}:{params:Promise<{id:string;file:string}>})=>{
  const blocked=await requireProviderAccess(request);if(blocked)return blocked;
  try{
    const{id,file}=await params;if(!/^\d+$/.test(id)||!/^\d+$/.test(file))throw new AllDebridError('Invalid media selection.','INVALID_MEDIA',400);
    const url=new URL(request.url),rawStart=Number(url.searchParams.get('start')||0),start=Number.isFinite(rawStart)?Math.max(0,rawStart):0,rawAudio=Number(url.searchParams.get('audio')||1),audio=Number.isFinite(rawAudio)?Math.max(0,Math.floor(rawAudio)):1,rawSubtitle=url.searchParams.get('subtitle'),subtitle=rawSubtitle!==null&&/^\d+$/.test(rawSubtitle)?`&subtitle=${rawSubtitle}`:'',video=url.searchParams.get('video')==='copy'?'&video=copy':'',quality=new Set(['bootstrap','480','720','1080','original']).has(url.searchParams.get('quality')||'')?url.searchParams.get('quality'):'original',rawSync=Number(url.searchParams.get('sync')||0),sync=Number.isFinite(rawSync)?Math.max(-5,Math.min(5,Math.round(rawSync*10)/10)):0;const base=process.env.KHEYFLIX_TRANSCODER_URL||'http://127.0.0.1:3101',requestedToken=(url.searchParams.get('session')||'').replace(/[^a-z0-9-]/gi,''),token=requestedToken||crypto.randomUUID();request.signal.addEventListener('abort',()=>{void fetch(`${base}/stop/${token}`,{method:'POST'}).catch(()=>undefined)},{once:true});const upstream=await fetch(`${base}/transcode/${id}/${file}?start=${start}&audio=${audio}&sync=${sync}&token=${token}${subtitle}${video}&quality=${quality}`,{cache:'no-store',signal:request.signal});
    if(!upstream.ok||!upstream.body)return Response.json({error:{code:'TRANSCODER_UNAVAILABLE',message:'The compatible audio stream is temporarily unavailable.'}},{status:upstream.status||502,headers:upstream.headers.get('retry-after')?{'Retry-After':upstream.headers.get('retry-after')!}:{}});
    const reader=upstream.body.getReader();
    const stop=()=>fetch(`${base}/stop/${token}`,{method:'POST'}).catch(()=>undefined);
    const body=new ReadableStream<Uint8Array>({
      async pull(controller){
        try{const{done,value}=await reader.read();if(done)controller.close();else controller.enqueue(value)}
        catch(error){controller.error(error)}
      },
      async cancel(reason){await reader.cancel(reason).catch(()=>undefined);await stop()},
    });
    return new Response(body,{headers:{'Content-Type':'video/mp4','Cache-Control':'private, no-store','X-Kheyflix-Audio':'aac-stereo','X-Kheyflix-Quality':quality||'original'}});
  }catch(error){const known=error instanceof AllDebridError?error:new AllDebridError('The compatible audio stream is temporarily unavailable.');writeRequestLog(known.status >= 500 ? 'error' : 'warn','debrid.transcode.failed',request,{code:known.code,status:known.status,error:error instanceof Error?error:new Error(String(error))});return Response.json({error:{code:known.code,message:publicErrorMessage(known.message,'The compatible audio stream is temporarily unavailable.')}},{status:known.status})}
};

const handlePost=async(request:Request)=>{const blocked=await requireProviderAccess(request);if(blocked)return blocked;const token=(new URL(request.url).searchParams.get('session')||'').replace(/[^a-z0-9-]/gi,'');if(!token)return Response.json({error:{code:'SESSION_REQUIRED',message:'Playback session is required.'}},{status:400});const base=process.env.KHEYFLIX_TRANSCODER_URL||'http://127.0.0.1:3101';try{const upstream=await fetch(`${base}/stop/${token}`,{method:'POST',signal:AbortSignal.timeout(3_000)});const retryAfter=upstream.headers.get('retry-after');if(upstream.status===204)return new Response(null,{status:204});if(upstream.status===202)return new Response(null,{status:202,headers:retryAfter?{'Retry-After':retryAfter}:{}});return Response.json({error:{code:'TRANSCODER_STOP_UNAVAILABLE',message:'The previous stream is still being released.'}},{status:upstream.status>=400?upstream.status:502,headers:retryAfter?{'Retry-After':retryAfter}:{}})}catch{return Response.json({error:{code:'TRANSCODER_STOP_UNAVAILABLE',message:'The previous stream is still being released.'}},{status:503})}};

const handlePatch=async(request:Request)=>{const blocked=await requireProviderAccess(request);if(blocked)return blocked;const token=(new URL(request.url).searchParams.get('session')||'').replace(/[^a-z0-9-]/gi,'');if(!token)return Response.json({error:{code:'SESSION_REQUIRED',message:'Playback session is required.'}},{status:400});const base=process.env.KHEYFLIX_TRANSCODER_URL||'http://127.0.0.1:3101';await fetch(`${base}/touch/${token}`,{method:'POST'}).catch(()=>undefined);return new Response(null,{status:204})};

export const GET=observeApi('/api/debrid/transcode/:id/:file',handleGet);
export const POST=observeApi('/api/debrid/transcode/:id/:file',handlePost);
export const PATCH=observeApi('/api/debrid/transcode/:id/:file',handlePatch);
