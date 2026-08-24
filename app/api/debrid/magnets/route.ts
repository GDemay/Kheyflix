import { AllDebridError, listMagnetsCached, uploadMagnet } from '../../../lib/alldebrid';
import { observeApi, publicErrorMessage, requestIdFor, writeLog } from '../../../lib/observability';

const failure = (request:Request,error:unknown) => {
  const known = error instanceof AllDebridError ? error : new AllDebridError('Unexpected media service error.');
  writeLog('error','debrid.operation.failed',{requestId:requestIdFor(request),code:known.code,status:known.status,error:error instanceof Error?error:new Error(String(error))});
  return Response.json({error:{code:known.code,message:publicErrorMessage(known.message,'The media service is temporarily unavailable.')}},{status:known.status});
};

const handleGet = async (request:Request) => {
  try { const result=await listMagnetsCached(new URL(request.url).searchParams.get('refresh')==='1');writeLog('info','debrid.catalog.completed',{requestId:requestIdFor(request),resultCount:result.magnets.length,cache:result.stale?'stale':result.cached?'hit':'miss'});return Response.json(result,{headers:{'Cache-Control':'private, max-age=60, stale-while-revalidate=300','X-Kheyflix-Cache':result.stale?'stale':result.cached?'hit':'miss'}}); }
  catch(error) { return failure(request,error); }
};

const handlePost = async (request:Request) => {
  try {
    const body=await request.json() as {magnet?:string;rightsConfirmed?:boolean};
    if(body.rightsConfirmed!==true)return Response.json({error:{code:'RIGHTS_CONFIRMATION_REQUIRED',message:'Confirm that you are authorized to stream this content.'}},{status:400});
    if(!body.magnet)return Response.json({error:{code:'MAGNET_REQUIRED',message:'A magnet URI is required.'}},{status:400});
    const magnet=await uploadMagnet(body.magnet);
    writeLog('info','debrid.magnet.upload.completed',{requestId:requestIdFor(request),magnetId:magnet.id,ready:Boolean(magnet.ready)});
    return Response.json({magnet},{status:201});
  } catch(error) { return failure(request,error); }
};

export const GET=observeApi('/api/debrid/magnets',handleGet);
export const POST=observeApi('/api/debrid/magnets',handlePost);
