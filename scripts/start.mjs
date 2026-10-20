import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
const standalone=existsSync('./server.js');
const args=standalone?['server.js']:['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',process.env.PORT||'3000'];
const child=spawn(process.execPath,args,{stdio:'inherit',env:{...process.env,HOSTNAME:'0.0.0.0',PORT:process.env.PORT||'3000'}});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
