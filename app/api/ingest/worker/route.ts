import {rawDatabase} from '../../../../lib/database';
import {workerAuthorized,claimJob,type IngestJob} from '../../../../lib/ingestion';
import {parseTranscript} from '../../../../lib/transcript';
import {insertTranscript} from '../../../../lib/transcript-store';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(req:Request){if(!workerAuthorized(req))return Response.json({error:'Acesso negado.'},{status:401});try{const raw=await req.text();if(raw.length>1500000)return Response.json({error:'Lote muito grande.'},{status:413});const body=JSON.parse(raw);if(body.action==='claim')return Response.json({job:claimJob()},{headers:{'Cache-Control':'no-store'}});
 const db=rawDatabase();const job=db.prepare('SELECT * FROM ingestion_jobs WHERE id=?').get(String(body.id||'')) as IngestJob|undefined;
 if(!job||job.status!=='running'||job.lease_token!==body.lease||Number(job.lease_until)<Date.now())return Response.json({error:'Processamento parado ou lease vencido.',stop:true},{status:409});
 const phase=typeof body.phase==='string'?body.phase.slice(0,300):job.phase;const cursor=body.cursor===undefined?job.cursor_seconds:Number(body.cursor);const duration=body.duration==null?job.duration_seconds:Number(body.duration);
 if(!Number.isFinite(cursor)||cursor<job.cursor_seconds||cursor>604800||duration!==null&&(!Number.isFinite(duration)||duration<0))throw Error('Checkpoint inválido.');
 const segments=body.segments?parseTranscript(JSON.stringify(body.segments),'json'):[];if(segments.length>500)throw Error('Lote muito grande.');
 const status=['completed','failed'].includes(body.status)?body.status:'running';const error=typeof body.error==='string'?body.error.slice(0,500):'';let inserted=0;db.exec('BEGIN IMMEDIATE');try{if(segments.length)inserted=insertTranscript(job.video_id,segments).inserted;db.prepare('UPDATE ingestion_jobs SET phase=?,cursor_seconds=?,duration_seconds=?,status=?,error=?,updated_at=?,lease_until=? WHERE id=?').run(phase,cursor,duration,status,error,Date.now(),Date.now()+120000,job.id);db.prepare('UPDATE ingestion_workers SET last_seen=? WHERE id=?').run(Date.now(),'main');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return Response.json({ok:true,inserted});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Falha ao atualizar processamento.'},{status:400});}}
