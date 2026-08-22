import {spawn} from 'node:child_process';
const children=[spawn(process.execPath,['scripts/transcoder.mjs'],{stdio:'inherit',env:process.env}),spawn('node_modules/.bin/vinext',['dev'],{stdio:'inherit',env:process.env})];
let stopping=false;const stop=signal=>{if(stopping)return;stopping=true;for(const child of children)if(!child.killed)child.kill(signal);setTimeout(()=>process.exit(0),250)};
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop(signal));for(const child of children)child.on('exit',code=>{if(!stopping&&code){stop('SIGTERM');process.exitCode=code}});
