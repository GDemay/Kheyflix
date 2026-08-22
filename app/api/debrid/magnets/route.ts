import { AllDebridError, listMagnets, uploadMagnet } from '../../../lib/alldebrid';

const failure = (error:unknown) => {
  const known = error instanceof AllDebridError ? error : new AllDebridError('Unexpected media service error.');
  return Response.json({error:{code:known.code,message:known.message}},{status:known.status});
};

export async function GET() {
  try { return Response.json({magnets:await listMagnets()},{headers:{'Cache-Control':'no-store'}}); }
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
