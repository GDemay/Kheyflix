import { AllDebridError, listMagnetsCached, uploadMagnet } from '../../../lib/alldebrid';

const failure = (error:unknown) => {
  const known = error instanceof AllDebridError ? error : new AllDebridError('Unexpected media service error.');
  return Response.json({error:{code:known.code,message:known.message}},{status:known.status});
};

export async function GET(request:Request) {
  try { const result=await listMagnetsCached(new URL(request.url).searchParams.get('refresh')==='1');return Response.json(result,{headers:{'Cache-Control':'private, max-age=60, stale-while-revalidate=300','X-Kheyflix-Cache':result.stale?'stale':result.cached?'hit':'miss'}}); }
  catch(error) { return failure(error); }
}

export async function POST(request:Request) {
  try {
    const body=await request.json() as {magnet?:string;rightsConfirmed?:boolean};
    if(body.rightsConfirmed!==true)return Response.json({error:{code:'RIGHTS_CONFIRMATION_REQUIRED',message:'Confirm that you are authorized to stream this content.'}},{status:400});
    if(!body.magnet)return Response.json({error:{code:'MAGNET_REQUIRED',message:'A magnet URI is required.'}},{status:400});
    return Response.json({magnet:await uploadMagnet(body.magnet)},{status:201});
  } catch(error) { return failure(error); }
}
