import {database} from '../../../lib/database';
import {isSameOrigin,requestKey} from '../../../lib/http';
import {youtubeId} from '../../../lib/core';
import { initialState } from '../../../lib/data';
import {canEditWorkspace} from '../../../lib/access';
import {workspaceSchema} from '../../../lib/validation';
export const runtime='nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control':'no-store' };
export async function GET(req:Request){
 try { const row = await database().prepare('SELECT payload,revision FROM workspaces WHERE id = ?').bind('main').first<{payload:string,revision:number}>(); const canEdit=await canEditWorkspace(req.headers); const state=row?JSON.parse(row.payload):structuredClone(initialState); if(!state.videoUrl){state.videoUrl=initialState.videoUrl;state.title=initialState.title;state.videoMode='recorded';} if(!canEdit||new URL(req.url).searchParams.get('view')==='public'){state.claims=state.claims.filter((c:any)=>c.status==='approved'&&c.videoId===youtubeId(state.videoUrl)).map((c:any)=>({...c,history:[],context:c.text}));const sourceIds=new Set(state.claims.flatMap((c:any)=>c.sourceIds));state.sources=state.sources.filter((s:any)=>sourceIds.has(s.id)).map((s:any)=>({...s,excerpt:''}));} return Response.json({state,revision:row?.revision??0,canEdit,modelConfigured:Boolean(process.env.MODEL_BASE_URL&&process.env.MODEL_NAME)},{headers}); }
 catch { return Response.json({error:'Não foi possível carregar os dados salvos. Tente novamente.'},{status:503,headers}); }
}
export async function POST(req:Request){
 try {
  if(!await canEditWorkspace(req.headers))return Response.json({error:'Entre com a conta autorizada para salvar ou revisar checagens.'},{status:401});
  if (!isSameOrigin(req)) return Response.json({error:'Origem não autorizada.'},{status:403});
  if(Number(req.headers.get('content-length')||0)>1500000)return Response.json({error:'Limite de 1,5 MB por atualização.'},{status:413});
  const body=await req.json() as any; const {revision,action}=body; const parsed=workspaceSchema.safeParse(body.state); if(!parsed.success)return Response.json({error:'Dados inválidos. Verifique os campos, fontes e critérios de aprovação.'},{status:400}); const state=parsed.data;
  if(!state || !Array.isArray(state.claims) || !Array.isArray(state.sources)||!Number.isInteger(revision)||state.claims.length>1500||state.sources.length>500)return Response.json({error:'Dados inválidos ou limite da sala atingido.'},{status:400});
  const payload=JSON.stringify(state);if(payload.length>1500000)return Response.json({error:'Sala muito grande. Exporte os dados e inicie outra sessão.'},{status:413});
  const now=new Date().toISOString();
  await database().prepare('INSERT OR IGNORE INTO workspaces (id,payload,revision,updated_at) VALUES (?,?,?,?)').bind('main',JSON.stringify(initialState),0,now).run();
  const actor='admin';
  const results=await database().batch([database().prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(payload,now,'main',revision),database().prepare('INSERT INTO audit (id,action,actor,at,snapshot) SELECT ?,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),String(action||'atualização').slice(0,300),actor,now,payload)]);
  if(!results[0].meta.changes)return Response.json({error:'Outra revisão foi salva. Recarregue os dados antes de salvar novamente.'},{status:409});
  return Response.json({revision:revision+1},{headers});
 }catch{return Response.json({error:'Não foi possível salvar. Seus dados continuam na tela para tentar novamente.'},{status:500});}
}
