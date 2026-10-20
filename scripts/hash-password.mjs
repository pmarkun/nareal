import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {randomBytes,scryptSync} from 'node:crypto';
let password='';
if(process.stdin.isTTY){process.stdout.write('Senha administrativa (mínimo 12 caracteres, entrada oculta): ');const output=new Writable({write(chunk,encoding,callback){callback();}});const reader=createInterface({input:process.stdin,output,terminal:true});password=await new Promise(resolve=>reader.question('',answer=>{reader.close();resolve(answer);}));process.stdout.write('\n');}else{for await(const chunk of process.stdin)password+=chunk;password=password.replace(/\r?\n$/,'');}
if(password.length<12||password.length>1024){process.stderr.write('Use uma senha entre 12 e 1024 caracteres.\n');process.exit(1);}
const salt=randomBytes(16);const key=scryptSync(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});process.stdout.write(`scrypt$${salt.toString('hex')}$${key.toString('hex')}\n`);
