import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,scryptSync} from 'node:crypto';
import {once} from 'node:events';
const temp=mkdtempSync(join(tmpdir(),'nareal-test-'));
const password=randomBytes(24).toString('hex');const salt=randomBytes(16);const hash=`scrypt$${salt.toString('hex')}$${scryptSync(password,salt,64).toString('hex')}`;
const base='http://localhost:3139';
const workerToken=randomBytes(24).toString('hex');
let child,logs='';
async function start(){child=spawn(process.execPath,['scripts/start.mjs'],{env:{...process.env,NODE_ENV:'production',PORT:'3139',APP_URL:base,DATABASE_PATH:join(temp,'test.sqlite'),ADMIN_USERNAME:'reviewer',ADMIN_PASSWORD_HASH:hash,INGEST_WORKER_TOKEN:workerToken,OBS_PUBLISH_SERVER:'rtmp://obs.test:1935',OBS_PUBLISH_KEY:'test-only-key'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);for(let i=0;i<150;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('Server failed to start: '+logs);}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}}
async function post(path,body,cookie='',origin=base){return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});}
try{
 await start();
 assert.equal((await fetch(base+'/')).status,200);
 const redirect=await fetch(base+'/admin',{redirect:'manual'});assert.equal(redirect.status,307);assert.equal(redirect.headers.get('location'),'/admin/login');
 assert.equal((await post('/api/auth/login',{username:'reviewer',password},'','https://evil.invalid')).status,403);
 assert.equal((await post('/api/auth/login',{username:'reviewer',password:'wrong'})).status,401);
 const login=await post('/api/auth/login',{username:'reviewer',password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Lax/);
 const guest=await (await fetch(base+'/api/workspace',{headers:{'x-oai-user-id':'spoof'}})).json();assert.equal(guest.canEdit,false);
 const workspace=await (await fetch(base+'/api/workspace',{headers:{Cookie:cookie}})).json();assert.equal(workspace.canEdit,true);
 assert.equal((await post('/api/workspace',{state:workspace.state,revision:0})).status,401);
 assert.equal((await post('/api/workspace',{state:workspace.state,revision:0},cookie,'https://evil.invalid')).status,403);
 const videoId='Gqc1rQtzWUk';const input={videoId,format:'json',content:readFileSync('examples/transcricao.json','utf8')};
 assert.equal((await post('/api/transcript',input)).status,401);
 const imported=await post('/api/transcript',input,cookie);assert.equal(imported.status,200);const transcript=await imported.json();assert.equal(transcript.inserted,2);assert.equal(transcript.blocks[0].speaker,'Falante A');assert.equal(transcript.blocks[0].start,10);assert.equal(transcript.blocks[0].end,17);
 const duplicate=await (await post('/api/transcript',input,cookie)).json();assert.equal(duplicate.inserted,0);
 const edited=await post('/api/transcript',{action:'edit',videoId,id:transcript.blocks[1].id,speaker:'Revisor corrigiu',start:18,end:22},cookie);assert.equal(edited.status,200);

 // Jobs are durable, authenticated, fenced by lease and cancellable.
 assert.equal((await post('/api/ingest',{source:'youtube',videoId})).status,401);
 assert.equal((await post('/api/ingest',{source:'youtube',videoId},cookie,'https://evil.invalid')).status,403);
 assert.equal((await post('/api/ingest/worker',{action:'claim'})).status,401);
 async function worker(body){return fetch(base+'/api/ingest/worker',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+workerToken},body:JSON.stringify(body)});}
 const queued=await post('/api/ingest',{source:'youtube',videoId,startSeconds:5},cookie);assert.equal(queued.status,201);const queuedId=(await queued.json()).id;
 assert.equal((await post('/api/ingest',{source:'youtube',videoId},cookie)).status,409);
 const leased=(await (await worker({action:'claim'})).json()).job;assert.equal(leased.id,queuedId);assert.equal(leased.cursor_seconds,5);
 assert.equal((await (await worker({action:'claim'})).json()).job,null);
 const batch={id:leased.id,lease:leased.lease_token,cursor:8,phase:'Transcrevendo',segments:[{speaker:'Teste do worker',text:'Bloco vindo do transcritor no servidor.',start:5,end:8}]};
 assert.equal((await worker({...batch,lease:'wrong'})).status,409);
 assert.equal((await worker(batch)).status,200);assert.equal((await (await worker(batch)).json()).inserted,0);
 assert.equal((await worker({...batch,cursor:4})).status,400);
 const jobs=await (await fetch(base+'/api/ingest?videoId='+videoId,{headers:{Cookie:cookie}})).json();assert.equal(jobs.workerOnline,true);assert.equal(jobs.jobs[0].cursor_seconds,8);assert.equal('lease_token' in jobs.jobs[0],false);assert.equal(jobs.obs.key,'test-only-key');
 await stop();await start();const resumed=await (await fetch(base+'/api/ingest?videoId='+videoId,{headers:{Cookie:cookie}})).json();assert.equal(resumed.jobs[0].id,queuedId);assert.equal(resumed.jobs[0].cursor_seconds,8);
 assert.equal((await post('/api/ingest',{action:'stop',id:queuedId},cookie)).status,200);assert.equal((await worker({...batch,cursor:9})).status,409);
 const obs=await post('/api/ingest',{source:'obs',videoId},cookie);assert.equal(obs.status,201);const obsJob=(await (await worker({action:'claim'})).json()).job;assert.equal(obsJob.source,'obs');await post('/api/ingest',{action:'stop',id:obsJob.id},cookie);
 const b=transcript.blocks[0];const claim={id:'integration-claim',transcriptBlockId:b.id,videoId,text:b.text,context:b.text,speaker:b.speaker,topic:'Teste',time:'00:00:10',seconds:10,status:'pending',verdict:'Sem evidência',explanation:'Checagem de teste, aguardando revisão humana.',sourceIds:[],createdAt:Date.now(),demo:false,history:[]};
 let state={...workspace.state,claims:[claim]};const save=await post('/api/workspace',{state,revision:workspace.revision,action:'teste'},cookie);assert.equal(save.status,200);let revision=(await save.json()).revision;
 assert.equal((await post('/api/workspace',{state,revision:0,action:'stale'},cookie)).status,409);
 assert.equal((await (await fetch(base+'/api/workspace')).json()).state.claims.length,0);
 state={...state,claims:[{...claim,status:'approved',verdict:'Verdadeiro'}]};assert.equal((await post('/api/workspace',{state,revision},cookie)).status,400);
 state={...state,claims:[{...claim,status:'approved',time:''}]};assert.equal((await post('/api/workspace',{state,revision},cookie)).status,400);
 state={...state,claims:[{...claim,status:'approved',verdict:'Verdadeiro',sourceIds:[state.sources[0].id]}]};const approved=await post('/api/workspace',{state,revision,action:'aprovar'},cookie);assert.equal(approved.status,200);
 const publicState=await (await fetch(base+'/api/workspace')).json();assert.equal(publicState.state.claims.length,1);assert.deepEqual(publicState.state.claims[0].history,[]);
 await stop();await start();const persisted=await (await fetch(base+'/api/transcript?videoId='+videoId,{headers:{Cookie:cookie}})).json();assert.equal(persisted.blocks.length,3);assert.ok(persisted.blocks.some(b=>b.speaker==='Revisor corrigiu'));assert.equal((await (await fetch(base+'/api/workspace')).json()).state.claims.length,1);
 assert.equal((await post('/api/auth/logout',{},cookie)).status,200);assert.equal((await fetch(base+'/api/transcript?videoId='+videoId,{headers:{Cookie:cookie}})).status,401);
 for(let i=0;i<5;i++)assert.equal((await post('/api/auth/login',{username:'reviewer',password:'wrong'})).status,401);assert.equal((await post('/api/auth/login',{username:'reviewer',password:'wrong'})).status,429);
 console.log('Integration passed: login, CSRF, sessions, rate limits, speaker blocks, deduplication, edits, review, conflicts, public filtering restart persistence, worker leases/checkpoints, cancellation and OBS input.');
}finally{await stop();rmSync(temp,{recursive:true,force:true});}
