import {createHash} from 'node:crypto';
import {rawDatabase} from './database';
import {groupBySpeaker,type TranscriptSegment} from './transcript';
export function transcriptRows(videoId:string){return rawDatabase().prepare('SELECT id,video_id AS videoId,start_seconds AS start,end_seconds AS end,speaker,text FROM transcript_blocks WHERE video_id=? AND archived_at IS NULL ORDER BY COALESCE(start_seconds,1e99),created_at,id').all(videoId);}
// Caller owns the transaction, so a worker checkpoint and its blocks commit together.
export function insertTranscript(videoId:string,segments:TranscriptSegment[]){
 const db=rawDatabase();const grouped=groupBySpeaker(segments);
 const count=Number(db.prepare('SELECT count(*) AS n FROM transcript_blocks WHERE video_id=? AND archived_at IS NULL').get(videoId)?.n||0);
 if(count+grouped.length>10000)throw Error('O vídeo atingiu o limite de 10 mil blocos.');
 const statement=db.prepare('INSERT INTO transcript_blocks(id,video_id,start_seconds,end_seconds,speaker,text,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET archived_at=NULL WHERE transcript_blocks.archived_at IS NOT NULL');let inserted=0;
 for(const [i,b] of grouped.entries()){const id=createHash('sha256').update(JSON.stringify([videoId,b.start,b.end,b.text])).digest('hex');inserted+=Number(statement.run(id,videoId,b.start,b.end,b.speaker,b.text,Date.now()+i).changes);}
 return {inserted,unidentified:grouped.filter(b=>b.speaker==='Falante não identificado').length};
}
