import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {developmentFixture} from './fixtures/development-component.mjs';
const execute=promisify(execFile),cli=fileURLToPath(new URL('../dist/index.js',import.meta.url)),origin='https://studio.example';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'pf-dev-owner-')),dir=join(root,'components','one');await developmentFixture(dir,'title');
 const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));manifest.id='@demo/one';await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));
 await writeFile(join(root,'promptframe-workspace.json'),JSON.stringify({schemaVersion:'promptframe-workspace.v0.1.0',components:[{id:'@demo/one',path:'components/one'}]}));return root;
}
function start(root,args=[]){
 const child=spawn(process.execPath,[cli,'dev',root,'--studio-origin',origin,...args],{cwd:root,env:{NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
 let output='',stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stderr}));});
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536)reject(Error('oversized CLI output'));try{resolve(JSON.parse(output));}catch{}});void exited.then(result=>reject(Error(JSON.stringify(result))));});
 return{child,exited,ready:Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('CLI start unconfirmed')),15000).unref())])};
}
async function stop(root){return JSON.parse((await execute(process.execPath,[cli,'dev','stop',root],{timeout:35000})).stdout);}
async function noLock(root){await assert.rejects(access(join(root,'.promptframe/dev/owner.json')),error=>error.code==='ENOENT');}
async function normalCleanup(root,processes){
 for(const p of processes)if(p.child.exitCode===null&&p.child.signalCode===null){await stop(root);await p.exited;}
 await rm(root,{recursive:true,force:true});
}
test('real workspace CLI: one instance, exact local stop/replace, stable identity/port, fresh credentials, and no persisted secret', {timeout:60000},async()=>{
 const root=await fixture(),processes=[];
 try{
  const first=start(root);processes.push(first);const a=await first.ready;
  assert.equal(a.contractVersion,'promptframe-development.v2');assert.match(a.connectionId,/^[a-f0-9]{32}$/);assert(Number(new URL(a.url).port)>=24000&&Number(new URL(a.url).port)<=24999);assert.equal(a.lifecycle.idleTimeoutSeconds,1800);
  for(const name of['state.json','owner.json']){const raw=await readFile(join(root,'.promptframe/dev',name),'utf8');assert(!raw.includes(a.credential));}
  await assert.rejects(execute(process.execPath,[cli,'dev',root,'--studio-origin',origin],{timeout:10000}),error=>/already_running/.test(error.stderr));
  const replacement=start(root,['--replace']);processes.push(replacement);const b=await replacement.ready;
  assert.equal((await first.exited).code,0);assert.equal(b.url,a.url);assert.equal(b.connectionId,a.connectionId);assert.notEqual(b.credential,a.credential);
  assert.equal((await stop(root)).stopped,true);assert.equal((await replacement.exited).code,0);await noLock(root);
  await assert.rejects(fetch(b.url+'/__promptframe/registry',{signal:AbortSignal.timeout(1000)}));
  const third=start(root,['--idle-timeout','0.002']);processes.push(third);const c=await third.ready;
  assert.equal(c.url,a.url);assert.equal(c.connectionId,a.connectionId);const result=await third.exited;assert.equal(result.code,0);assert.match(result.stderr,/idle interval/);await noLock(root);
 }finally{await normalCleanup(root,processes);}
});
test('a reused PID is never signalled; stale local metadata is replaced and default conflict stays in its port range', {timeout:60000},async()=>{
 const root=await fixture(),processes=[];let occupied;
 try{
  const first=start(root);processes.push(first);const a=await first.ready;await stop(root);assert.equal((await first.exited).code,0);
  const directory=join(root,'.promptframe/dev');await writeFile(join(directory,'owner.json'),JSON.stringify({version:1,rootDigest:createHash('sha256').update(root).digest('hex'),instanceId:'e'.repeat(32),connectionId:a.connectionId,pid:process.pid,birth:'not-this-process'}));
  occupied=createServer();await new Promise(resolve=>occupied.listen(Number(new URL(a.url).port),'127.0.0.1',resolve));
  const second=start(root);processes.push(second);const b=await second.ready;assert.equal(b.connectionId,a.connectionId);assert.notEqual(b.url,a.url);assert(Number(new URL(b.url).port)>=24000&&Number(new URL(b.url).port)<=24999);
  await stop(root);assert.equal((await second.exited).code,0);await noLock(root);
  const third=start(root,['--port','0']);processes.push(third);const c=await third.ready;assert.equal(c.connectionId,a.connectionId);assert(Number(new URL(c.url).port)>0);await stop(root);assert.equal((await third.exited).code,0);
 }finally{if(occupied)await new Promise(resolve=>occupied.close(resolve));await normalCleanup(root,processes);}
});

test('two real starters cannot both reclaim one stale owner, and stop works after editable workspace config breaks',{timeout:60000},async()=>{
 const root=await fixture(),processes=[];
 try{
  const initial=start(root);processes.push(initial);const original=await initial.ready;await stop(root);await initial.exited;
  await writeFile(join(root,'.promptframe/dev/owner.json'),JSON.stringify({version:1,rootDigest:createHash('sha256').update(root).digest('hex'),instanceId:'e'.repeat(32),connectionId:original.connectionId,pid:process.pid,birth:'stale-incarnation'}));
  const a=start(root),b=start(root);processes.push(a,b);
  const outcomes=await Promise.allSettled([a.ready,b.ready]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  await writeFile(join(root,'promptframe-workspace.json'),'broken during editing');assert.equal((await stop(root)).stopped,true);
  assert.equal((await a.exited).code===0||(await b.exited).code===0,true);await noLock(root);
 }finally{await normalCleanup(root,processes);}
});
