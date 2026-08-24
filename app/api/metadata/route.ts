import {getMetadata} from '../../lib/metadata';
import {observeApi,writeRequestLog} from '../../lib/observability';

const handleGet=async(request:Request)=>{const url=new URL(request.url);const title=url.searchParams.get('title')?.trim();const kind=url.searchParams.get('kind')==='series'?'series':'movie';const year=Number(url.searchParams.get('year'))||undefined;if(!title)return Response.json({error:{message:'A title is required.'}},{status:400});try{const result=await getMetadata(title,kind,year,url.searchParams.get('refresh')==='1');return Response.json(result,{headers:{'Cache-Control':'private, max-age=86400, stale-while-revalidate=2592000'}})}catch(error){writeRequestLog('warn','metadata.lookup.degraded',request,{kind,error:error instanceof Error?error:new Error('Unknown metadata error')});return Response.json({metadata:null,cached:false},{status:200,headers:{'Cache-Control':'private, max-age=300'}})}};

export const GET=observeApi('/api/metadata',handleGet);
