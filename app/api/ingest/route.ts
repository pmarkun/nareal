import {canEditWorkspace} from '../../../lib/access';
import {isSameOrigin} from '../../../lib/http';
import {rawDatabase} from '../../../lib/database';
import {publicJobs} from '../../../lib/ingestion';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:Request){if(!await canEditWorkspace(req.headers))return Response.json({error:'Login necessário.'},{status:401});const videoId=new URL(req.url).searchParams.get('videoId')||'';if(!/^[\w-]{11}$/.test(videoId))return Response.json({error:'Vídeo inválido.'},{status:400});const db=rawDatabase();const worker=db.prepare('SELECT last_seen FROM ingestion_workers WHERE id=?').get('main');return Response.json({jobs:publicJobs(videoId),workerOnline:Date.now()-Number(worker?.last_seen||0)<45000,configured:Boolean(process.env.INGEST_WORKER_TOKEN),obs:process.env.OBS_PUBLISH_SERVER&&process.env.OBS_PUBLISH_KEY?{server:process.env.OBS_PUBLISH_SERVER,key:process.env.OBS_PUBLISH_KEY}:null},{headers:{'Cache-Control':'no-store'}});}
export async function POST(req:Request){if(!await canEditWorkspace(req.headers))return Response.json({error:'Login necessário.'},{status:401});if(!isSameOrigin(req))return Response.json({error:'Origem não autorizada.'},{status:403});try{const raw=await req.text();if(raw.length>4000)throw Error('Requisição muito grande.');const body=JSON.parse(raw);const db=rawDatabase();const now=Date.now();
 if(body.action==='stop'){if(typeof body.id!=='string')throw Error('Processamento inválido.');db.prepare("UPDATE ingestion_jobs SET status='stopped',phase='Parado pelo revisor',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status IN ('queued','running')").run(now,body.id);return Response.json({ok:true});}
 if(!process.env.INGEST_WORKER_TOKEN)return Response.json({error:'O transcritor do servidor ainda não está configurado.'},{status:503});
 const {videoId,source}=body;const start=Number(body.startSeconds??0);
 if(typeof videoId!=='string'||!/^[\w-]{11}$/.test(videoId)||!['youtube','obs'].includes(source)||!Number.isFinite(start)||start<0||start>86400)throw Error('Entrada ou horário inválido.');
 if(source==='obs'&&!process.env.OBS_PUBLISH_SERVER)throw Error('A entrada OBS ainda não foi configurada.');
 if(Number(db.prepare("SELECT count(*) AS n FROM ingestion_jobs WHERE status IN ('queued','running')").get()?.n)>=10)throw Error('A fila já tem dez processamentos. Pare um deles antes de continuar.');
 const id=crypto.randomUUID();try{db.prepare('INSERT INTO ingestion_jobs(id,video_id,source,start_seconds,cursor_seconds,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id,videoId,source,start,start,now,now);}catch{return Response.json({error:'Esta transmissão já tem um processamento ativo.'},{status:409});}
 return Response.json({id},{status:201});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Não foi possível iniciar.'},{status:400});}}
