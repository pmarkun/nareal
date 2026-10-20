import {rawDatabase} from '../../../lib/database';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){try{rawDatabase().prepare('SELECT 1').get();return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({ok:false},{status:503});}}
