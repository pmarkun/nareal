import {deleteSession} from '../../../../lib/access';
import {isSameOrigin} from '../../../../lib/http';
export const runtime='nodejs';
export async function POST(request:Request){if(!isSameOrigin(request))return Response.json({error:'Origem não autorizada.'},{status:403});return Response.json({ok:true},{headers:{'Set-Cookie':deleteSession(request.headers),'Cache-Control':'no-store'}});}
