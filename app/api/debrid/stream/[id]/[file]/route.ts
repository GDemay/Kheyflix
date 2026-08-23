import { AllDebridError, contentTypeFor, resolveVideo } from '../../../../../lib/alldebrid';

const clientIp = (request:Request) => {
  const value=request.headers.get('x-real-ip')?.trim();
  if(!value||value.length>45||value.includes(',')||!/^[0-9a-f:.]+$/i.test(value))return undefined;
  if(value.includes(':'))return value;
  const octets=value.split('.').map(Number);
  return octets.length===4&&octets.every(part=>Number.isInteger(part)&&part>=0&&part<=255)?value:undefined;
};

async function handle(request:Request,{params}:{params:Promise<{id:string;file:string}>}) {
  try {
    const {id,file}=await params;
    // Relay by default so one account is never unlocked against every
    // viewer's changing phone, laptop, VPN, or mobile-network IP address.
    // Direct mode is an explicit opt-in for deployments with provider-safe
    // network controls.
    const relay=process.env.KHEYFLIX_STREAM_MODE!=='direct';
    const media=await resolveVideo(Number(id),Number(file),relay?undefined:clientIp(request));
    if(new URL(media.url).protocol!=='https:')throw new AllDebridError('The media service returned an unsafe stream URL.','STREAM_URL_UNSAFE',502);
    if(!relay)return new Response(null,{status:307,headers:{Location:media.url,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Kheyflix-Stream':'direct'}});
    const range=request.headers.get('range');
    const upstream=await fetch(media.url,{method:request.method,headers:range?{Range:range}:{},redirect:'follow',signal:request.signal});
    if(!upstream.ok || (!upstream.body&&request.method!=='HEAD')){await upstream.body?.cancel();return Response.json({error:{code:'STREAM_UPSTREAM_FAILED',message:'The media source is temporarily unavailable.'}},{status:upstream.status || 502})}
    const headers=new Headers();
    ['content-length','content-range','accept-ranges','etag','last-modified'].forEach(key=>{const value=upstream.headers.get(key);if(value)headers.set(key,value)});
    headers.set('Content-Type',upstream.headers.get('content-type') || contentTypeFor(media.name));
    headers.set('Cache-Control','private, no-store');
    headers.set('Content-Disposition',`inline; filename="${media.name.replaceAll('"','')}"`);
    if(request.method==='HEAD'){await upstream.body?.cancel();return new Response(null,{status:upstream.status,headers})}
    return new Response(upstream.body,{status:upstream.status,headers});
  } catch(error) {
    const known=error instanceof AllDebridError?error:new AllDebridError('Unexpected streaming error.');
    return Response.json({error:{code:known.code,message:known.message}},{status:known.status});
  }
}

export const GET=handle;
export const HEAD=handle;
