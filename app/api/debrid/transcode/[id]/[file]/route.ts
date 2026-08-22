import { AllDebridError } from '../../../../../lib/alldebrid';

export async function GET(request:Request,{params}:{params:Promise<{id:string;file:string}>}){
  try{
    const{id,file}=await params;if(!/^\d+$/.test(id)||!/^\d+$/.test(file))throw new AllDebridError('Invalid media selection.','INVALID_MEDIA',400);
    const url=new URL(request.url);const start=Math.max(0,Number(url.searchParams.get('start')||0)),audio=Math.max(0,Math.floor(Number(url.searchParams.get('audio')||1))),rawSubtitle=url.searchParams.get('subtitle'),subtitle=rawSubtitle!==null&&/^\d+$/.test(rawSubtitle)?`&subtitle=${rawSubtitle}`:'',video=url.searchParams.get('video')==='copy'?'&video=copy':'',rawSync=Number(url.searchParams.get('sync')||0),sync=Number.isFinite(rawSync)?Math.max(-5,Math.min(5,Math.round(rawSync*10)/10)):0;const base=process.env.KHEYFLIX_TRANSCODER_URL||'http://127.0.0.1:3101';const token=(url.searchParams.get('session')||crypto.randomUUID()).replace(/[^a-z0-9-]/gi,'');request.signal.addEventListener('abort',()=>{void fetch(`${base}/stop/${token}`,{method:'POST'}).catch(()=>undefined)},{once:true});const upstream=await fetch(`${base}/transcode/${id}/${file}?start=${start}&audio=${audio}&sync=${sync}&token=${token}${subtitle}${video}`,{cache:'no-store',signal:request.signal});
    if(!upstream.ok||!upstream.body)return Response.json({error:{code:'TRANSCODER_UNAVAILABLE',message:'The compatible audio stream is temporarily unavailable.'}},{status:upstream.status||502});
    const reader=upstream.body.getReader();
    const stop=()=>fetch(`${base}/stop/${token}`,{method:'POST'}).catch(()=>undefined);
    const body=new ReadableStream<Uint8Array>({
      async pull(controller){
        try{const{done,value}=await reader.read();if(done)controller.close();else controller.enqueue(value)}
        catch(error){controller.error(error)}
      },
      async cancel(reason){await reader.cancel(reason).catch(()=>undefined);await stop()},
    });
    return new Response(body,{headers:{'Content-Type':'video/mp4','Cache-Control':'private, no-store','X-Kheyflix-Audio':'aac-stereo'}});
  }catch(error){const known=error instanceof AllDebridError?error:new AllDebridError('The compatible audio stream is temporarily unavailable.');return Response.json({error:{code:known.code,message:known.message}},{status:known.status})}
}

export async function POST(request:Request){const token=(new URL(request.url).searchParams.get('session')||'').replace(/[^a-z0-9-]/gi,'');if(!token)return Response.json({error:{code:'SESSION_REQUIRED',message:'Playback session is required.'}},{status:400});const base=process.env.KHEYFLIX_TRANSCODER_URL||'http://127.0.0.1:3101';await fetch(`${base}/stop/${token}`,{method:'POST'}).catch(()=>undefined);return new Response(null,{status:204})}
