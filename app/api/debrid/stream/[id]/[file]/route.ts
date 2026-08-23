import { AllDebridError, contentTypeFor, resolveVideo } from '../../../../../lib/alldebrid';

type MediaResolver = typeof resolveVideo;
type Fetcher = typeof fetch;

const validRange = (range:string|null) => !range || /^bytes=\d*-\d*$/.test(range);
const safeFilename = (name:string) => name.replace(/["\\\r\n]/g,'').trim() || 'video';

export async function proxyVideo(
  request:Request,
  params:Promise<{id:string;file:string}>,
  resolver:MediaResolver=resolveVideo,
  fetcher:Fetcher=fetch,
) {
  try {
    const {id,file}=await params;
    if(!/^\d+$/.test(id)||!/^\d+$/.test(file))throw new AllDebridError('Invalid media selection.','INVALID_MEDIA',400);
    const range=request.headers.get('range');
    if(!validRange(range))throw new AllDebridError('Invalid byte range.','INVALID_RANGE',416);
    const media=await resolver(Number(id),Number(file));
    const upstream=await fetcher(media.url,{headers:range?{Range:range}:{},redirect:'follow',signal:request.signal});
    if(!upstream.ok || !upstream.body)return Response.json({error:{code:'STREAM_UPSTREAM_FAILED',message:'The media source is temporarily unavailable.'}},{status:upstream.status || 502});
    const headers=new Headers();
    ['content-length','content-range','accept-ranges','etag','last-modified'].forEach(key=>{const value=upstream.headers.get(key);if(value)headers.set(key,value)});
    headers.set('Content-Type',upstream.headers.get('content-type') || contentTypeFor(media.name));
    headers.set('Cache-Control','private, no-store');
    headers.set('Content-Disposition',`inline; filename="${safeFilename(media.name)}"`);
    return new Response(upstream.body,{status:upstream.status,headers});
  } catch(error) {
    const known=error instanceof AllDebridError?error:new AllDebridError('Unexpected streaming error.');
    return Response.json({error:{code:known.code,message:known.message}},{status:known.status});
  }
}

export async function GET(request:Request,{params}:{params:Promise<{id:string;file:string}>}) {
  return proxyVideo(request,params);
}
