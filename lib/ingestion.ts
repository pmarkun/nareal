import {randomBytes,timingSafeEqual} from 'node:crypto';
import {rawDatabase} from './database';
export type IngestJob={id:string,video_id:string,source:'youtube'|'obs',status:string,phase:string,start_seconds:number,cursor_seconds:number,duration_seconds:number|null,error:string,created_at:number,updated_at:number,lease_token?:string,lease_until?:number,attempts:number};
export function workerAuthorized(req:Request){const expected=process.env.INGEST_WORKER_TOKEN||'';const received=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';const a=Buffer.from(received);const b=Buffer.from(expected);return expected.length>=32&&a.length===b.length&&timingSafeEqual(a,b);}
export function publicJobs(videoId:string){return rawDatabase().prepare('SELECT id,video_id,source,status,phase,start_seconds,cursor_seconds,duration_seconds,error,created_at,updated_at,attempts FROM ingestion_jobs WHERE video_id=? ORDER BY created_at DESC LIMIT 10').all(videoId);}
export function claimJob(){const db=rawDatabase();const now=Date.now();db.prepare('INSERT INTO ingestion_workers(id,last_seen) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen').run('main',now);db.exec('BEGIN IMMEDIATE');try{
 // Expired work resumes from the last committed checkpoint. Old leases cannot write.
 db.prepare("UPDATE ingestion_jobs SET status='failed',phase='Interrompido',error='O processamento reiniciou muitas vezes. Inicie novamente.',lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<? AND attempts>=5").run(now);
 db.prepare("UPDATE ingestion_jobs SET status='queued',phase='Retomando após reinício',lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<? AND attempts<5").run(now);
 const active=db.prepare("SELECT id FROM ingestion_jobs WHERE status='running' LIMIT 1").get();
 const job=active?null:db.prepare("SELECT * FROM ingestion_jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get() as IngestJob|undefined;
 if(job){job.lease_token=randomBytes(24).toString('hex');job.status='running';db.prepare("UPDATE ingestion_jobs SET status='running',phase='Preparando entrada',lease_token=?,lease_until=?,updated_at=?,attempts=attempts+1 WHERE id=?").run(job.lease_token,now+120000,now,job.id);}
 db.exec('COMMIT');return job||null;
 }catch(e){db.exec('ROLLBACK');throw e;}}
