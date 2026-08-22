import { AllDebridError, contentTypeFor, resolveVideo } from '../../../../../lib/alldebrid';

export async function GET(request:Request,{params}:{params:Promise<{id:string;file:string}>}) {
  try {
    const {id,file}=await params;
    const media=await resolveVideo(Number(id),Number(file));
    const range=request.headers.get('range');
    const upstream=await fetch(media.url,{headers:range?{Range:range}:{},redirect:'follow'});
    if(!upstream.ok || !upstream.body)return Response.json({error:{code:'STREAM_UPSTREAM_FAILED',message:'The media source is temporarily unavailable.'}},{status:upstream.status || 502});
    const headers=new Headers();
    ['content-length','content-range','accept-ranges','etag','last-modified'].forEach(key=>{const value=upstream.headers.get(key);if(value)headers.set(key,value)});
    headers.set('Content-Type',upstream.headers.get('content-type') || contentTypeFor(media.name));
    headers.set('Cache-Control','private, no-store');
    headers.set('Content-Disposition',`inline; filename="${media.name.replaceAll('"','')}"`);
    return new Response(upstream.body,{status:upstream.status,headers});
  } catch(error) {
    const known=error instanceof AllDebridError?error:new AllDebridError('Unexpected streaming error.');
    return Response.json({error:{code:known.code,message:known.message}},{status:known.status});
  }
}
