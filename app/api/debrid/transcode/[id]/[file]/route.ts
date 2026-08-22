import { AllDebridError } from '../../../../../lib/alldebrid';

export async function GET(request:Request,{params}:{params:Promise<{id:string;file:string}>}){
  try{
    const{id,file}=await params;if(!/^\d+$/.test(id)||!/^\d+$/.test(file))throw new AllDebridError('Invalid media selection.','INVALID_MEDIA',400);
    const url=new URL(request.url);const start=Math.max(0,Number(url.searchParams.get('start')||0)),audio=Math.max(0,Math.floor(Number(url.searchParams.get('audio')||1)));const base=process.env.KHEYFLIX_TRANSCODER_URL||'http://127.0.0.1:3101';const token=(url.searchParams.get('session')||crypto.randomUUID()).replace(/[^a-z0-9-]/gi,'');request.signal.addEventListener('abort',()=>{void fetch(`${base}/stop/${token}`,{method:'POST'}).catch(()=>undefined)},{once:true});const upstream=await fetch(`${base}/transcode/${id}/${file}?start=${start}&audio=${audio}&token=${token}`,{cache:'no-store',signal:request.signal});
    if(!upstream.ok||!upstream.body)return Response.json({error:{code:'TRANSCODER_UNAVAILABLE',message:'The compatible audio stream is temporarily unavailable.'}},{status:upstream.status||502});
    return new Response(upstream.body,{headers:{'Content-Type':'video/mp4','Cache-Control':'private, no-store','X-Kheyflix-Audio':'aac-stereo'}});
  }catch(error){const known=error instanceof AllDebridError?error:new AllDebridError('The compatible audio stream is temporarily unavailable.');return Response.json({error:{code:known.code,message:known.message}},{status:known.status})}
}

export async function POST(request:Request){const token=(new URL(request.url).searchParams.get('session')||'').replace(/[^a-z0-9-]/gi,'');if(!token)return Response.json({error:{code:'SESSION_REQUIRED',message:'Playback session is required.'}},{status:400});const base=process.env.KHEYFLIX_TRANSCODER_URL||'http://127.0.0.1:3101';await fetch(`${base}/stop/${token}`,{method:'POST'}).catch(()=>undefined);return new Response(null,{status:204})}
