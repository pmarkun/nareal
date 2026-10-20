import {verifyPassword} from '../../../../lib/passwords';
import {createSession} from '../../../../lib/access';
import {rawDatabase} from '../../../../lib/database';
import {isSameOrigin,requestKey} from '../../../../lib/http';
export const runtime='nodejs';
export async function POST(request:Request){
 if(!isSameOrigin(request))return Response.json({error:'Origem não autorizada.'},{status:403});
 const configured=process.env.ADMIN_PASSWORD_HASH;if(!configured)return Response.json({error:'O login ainda não foi configurado no servidor.'},{status:503});
 try{const raw=await request.text();if(raw.length>4096)return Response.json({error:'Dados inválidos.'},{status:400});const body=JSON.parse(raw);const username=typeof body.username==='string'?body.username.trim():'';const password=typeof body.password==='string'?body.password:'';if(!username||username.length>128||password.length>1024)return Response.json({error:'Usuário ou senha inválidos.'},{status:401});
 const db=rawDatabase();const now=Date.now();const key=requestKey(request);const identity='user:'+username.toLowerCase();db.prepare('DELETE FROM login_attempts WHERE created_at<?').run(now-15*60*1000);const rate=db.prepare('SELECT COUNT(*) AS count FROM login_attempts WHERE key=? AND created_at>?').get(key,now-60000);const total=db.prepare('SELECT COUNT(*) AS count FROM login_attempts WHERE key=? AND created_at>?').get(identity,now-60000);if(Number(rate?.count)>=5||Number(total?.count)>=30)return Response.json({error:'Muitas tentativas. Aguarde um minuto.'},{status:429});
 db.prepare('INSERT INTO login_attempts(key,created_at) VALUES (?,?),(?,?)').run(key,now,identity,now);
 const passwordValid=await verifyPassword(password,configured);if(!passwordValid||username!==(process.env.ADMIN_USERNAME||'admin'))return Response.json({error:'Usuário ou senha inválidos.'},{status:401});
 db.prepare('DELETE FROM login_attempts WHERE key=? OR key=?').run(key,identity);return Response.json({ok:true},{headers:{'Set-Cookie':createSession(username),'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Não foi possível entrar.'},{status:400});}
}
