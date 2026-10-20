import {database} from '../../../lib/database';
import {isSameOrigin,requestKey} from '../../../lib/http';
import {chatInput} from '../../../lib/chat';
import {canEditWorkspace} from '../../../lib/access';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function GET(req:Request){
 try{const room=new URL(req.url).searchParams.get('room')||'';if(!/^[\w-]{11}$/.test(room))return Response.json({error:'Sala inválida.'},{status:400});const result=await database().prepare('SELECT id,room,name,body,created_at AS createdAt FROM chat_messages WHERE room=? AND deleted=0 ORDER BY id DESC LIMIT 100').bind(room).all();return Response.json({messages:result.results.reverse(),canModerate:await canEditWorkspace(req.headers)},{headers});}catch{return Response.json({error:'O chat está indisponível. Tente novamente.'},{status:503,headers});}
}
export async function POST(req:Request){
 try{
  if(!isSameOrigin(req))return Response.json({error:'Origem não autorizada.'},{status:403});
  if(!req.headers.get('content-type')?.includes('application/json'))return Response.json({error:'Formato inválido.'},{status:415});
  if(Number(req.headers.get('content-length')||0)>6000)return Response.json({error:'Mensagem muito grande.'},{status:413});
  const raw=await req.text();if(raw.length>6000)return Response.json({error:'Mensagem muito grande.'},{status:413});const body=JSON.parse(raw);
  if(body.action==='hide'){if(!await canEditWorkspace(req.headers))return Response.json({error:'A moderação exige a conta autorizada.'},{status:403});if(!Number.isSafeInteger(body.id)||body.id<1)return Response.json({error:'Mensagem inválida.'},{status:400});await database().prepare('UPDATE chat_messages SET deleted=1 WHERE id=?').bind(body.id).run();return Response.json({ok:true},{headers});}
  const parsed=chatInput.safeParse(body);if(!parsed.success)return Response.json({error:'Use um nome de 2 a 32 caracteres e uma mensagem de até 600 caracteres.'},{status:400});
  const {room,name,body:message}=parsed.data;
  const cookie=req.headers.get('cookie')?.match(/(?:^|;\s*)nareal_chat=([a-f0-9-]{36})/)?.[1];const id=cookie||crypto.randomUUID();
  const address=requestKey(req)+':'+id;const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('nareal-chat-v1:'+address));const actor=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');const now=Date.now();
  const sessionHeaders={...headers,...(!cookie?{'Set-Cookie':`nareal_chat=${id}; HttpOnly; SameSite=Lax; Path=/api/chat; Max-Age=86400${new URL(req.url).protocol==='https:'?'; Secure':''}`}:{})};
  const result=await database().prepare('INSERT INTO chat_messages (room,name,body,actor,created_at,deleted) SELECT ?,?,?,?,?,0 WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE actor=? AND created_at>?) AND (SELECT COUNT(*) FROM chat_messages WHERE actor=? AND created_at>?)<20 RETURNING id,room,name,body,created_at AS createdAt').bind(room,name,message,actor,now,actor,now-2500,actor,now-60000).first();
  if(!result)return Response.json({error:'Espere alguns segundos antes de enviar outra mensagem.'},{status:429,headers:sessionHeaders});
  return Response.json({message:result},{status:201,headers:sessionHeaders});
 }catch{return Response.json({error:'Não foi possível enviar. Tente novamente.'},{status:500,headers});}
}
