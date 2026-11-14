import assert from'node:assert/strict';import test from'node:test';import{execFile,spawn}from'node:child_process';import{promisify}from'node:util';import{mkdtemp,rm}from'node:fs/promises';import http from'node:http';import os from'node:os';import path from'node:path';
import{fileURLToPath}from'node:url';
import{BuildStatusReadError,readyBuildReference,waitForOriginalBuild}from'../dist/build-status-wait.js';
const execute=promisify(execFile),cli=fileURLToPath(new URL('../dist/index.js',import.meta.url)),buildId='build-original',h=x=>'sha256:'+x.repeat(64);
const ref={provider:'project_private',id:'@example/probe',version:'1.0.0',sourceHash:h('a'),schemaHash:h('b'),bundleHash:h('c')};
const ready=()=>({success:true,build:{buildId,componentId:ref.id,version:ref.version,status:'succeeded',previewStatus:'ready',securityReview:{decision:'allow'},receipt:{buildId,componentRef:ref,sourceHash:ref.sourceHash,schemaHash:ref.schemaHash,bundleHash:ref.bundleHash,objectStore:{status:'mirrored'}}}});

test('wait reads only the original build serially with backoff, then returns its exact ready reference',async()=>{
 let clock=0,reads=0,active=0,maxActive=0;const pauses=[];
 const result=await waitForOriginalBuild({buildId,timeoutMs:10_000,now:()=>clock,sleep:async ms=>{pauses.push(ms);clock+=ms;},read:async()=>{active++;maxActive=Math.max(active,maxActive);await Promise.resolve();reads++;active--;return reads<4?{success:true,build:{buildId,status:reads===1?'queued':'running'}}:ready();}});
 assert.equal(result.state,'ready');assert.equal(result.reads,4);assert.equal(maxActive,1);assert.deepEqual(pauses,[500,1000,2000]);assert.deepEqual(result.componentRef,ref);assert.equal(result.buildId,buildId);
});

test('a terminal label or mismatched receipt is not a usable locked reference',()=>{
 for(const edit of [x=>{x.build.previewStatus='queued';},x=>{x.build.receipt.objectStore.status='failed';},x=>{delete x.build.receipt.objectStore;},x=>{x.build.receipt.bundleHash=h('d');},x=>{delete x.build.receipt.componentRef.schemaHash;},x=>{x.build.receipt.buildId='other';},x=>{x.build.componentId='@example/other';},x=>{x.build.securityReview.decision='manual_review';}]){const value=structuredClone(ready());edit(value);assert.equal(readyBuildReference(value.build),undefined);}
 const prerelease=structuredClone(ready());prerelease.build.version='1.0.0-beta.1+build.2';prerelease.build.receipt.componentRef.version=prerelease.build.version;assert.equal(readyBuildReference(prerelease.build)?.version,prerelease.build.version);
});

test('invalid budgets are rejected before any read and pre-cancelled observers read nothing',async()=>{
 let reads=0;for(const timeoutMs of [0,99,1_800_001,Infinity])await assert.rejects(()=>waitForOriginalBuild({buildId,timeoutMs,read:async()=>{reads++;return ready();}}),/status.wait.timeout_invalid/u);
 const c=new AbortController();c.abort();const r=await waitForOriginalBuild({buildId,timeoutMs:1000,signal:c.signal,read:async()=>{reads++;return ready();}});assert.equal(r.state,'cancelled');assert.equal(reads,0);
});

test('failed, manual, unknown identity and denied observations stop without a new attempt',async()=>{
 for(const [payload,state,reason]of[[{build:{buildId,status:'failed'}},'failed','failed'],[{build:{buildId,status:'running',securityReview:{decision:'manual_review'}}},'action_required','manual_review'],[{build:{buildId,status:'succeeded',previewStatus:'failed'}},'action_required','preview_failed'],[{build:{buildId:'other',status:'running'}},'unconfirmed','build_identity_unconfirmed']]){
  let reads=0;const r=await waitForOriginalBuild({buildId,timeoutMs:1000,read:async()=>{reads++;return payload;}});assert.equal(r.state,state);assert.equal(r.reason,reason);assert.equal(reads,1);assert.equal(r.componentRef,undefined);
 }
 const denied=await waitForOriginalBuild({buildId,timeoutMs:1000,read:async()=>{throw new BuildStatusReadError(403);}});assert.equal(denied.state,'unconfirmed');assert.equal(denied.reason,'status_read_denied');assert.equal(denied.httpStatus,403);
});

test('observation budget aborts an in-flight read and cancellation fences a late success',async()=>{
 let reads=0;const r=await waitForOriginalBuild({buildId,timeoutMs:100,read:signal=>{reads++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 assert.equal(r.state,'timed_out');assert.equal(reads,1);assert.equal(r.componentRef,undefined);
 const c=new AbortController(),late=await waitForOriginalBuild({buildId,timeoutMs:1000,signal:c.signal,read:async()=>{c.abort();return ready();}});assert.equal(late.state,'cancelled');assert.equal(late.componentRef,undefined);
});

async function serve(handler){const requests=[];const server=http.createServer((req,res)=>{requests.push({method:req.method,path:req.url});handler(req,res,requests.length);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{requests,url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};}
const json=(res,body)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(body));};
async function isolated(t){const dir=await mkdtemp(path.join(os.tmpdir(),'promptframe-status-wait-'));t.after(()=>rm(dir,{recursive:true,force:true}));return{PATH:process.env.PATH,PROMPTFRAME_CONFIG:path.join(dir,'not-created.json')};}

test('public CLI wait emits one final JSON, only original GETs, and a usable reference',async t=>{
 const env=await isolated(t),s=await serve((_req,res,count)=>json(res,count===1?{success:true,build:{buildId,status:'running'}}:ready()));t.after(s.close);
 const r=await execute(process.execPath,[cli,'status',buildId,'--endpoint',s.url,'--wait','--timeout-seconds','2','--json'],{env});const out=JSON.parse(r.stdout);
 assert.equal(out.wait.state,'ready');assert.deepEqual(out.componentRef,ref);assert.equal(out.buildId,buildId);assert.equal(out.diagnostic.code,'status.wait.ready');assert.equal(out.wait.reads,2);assert.equal(r.stderr.trim().split('\n').length,2);
 assert.deepEqual(s.requests,[1,2].map(()=>({method:'GET',path:'/components/marketplace/builds/'+buildId})));
});

test('CLI wait reports failure, manual action, timeout and HTTP refusal with nonzero exit',async t=>{
 const env=await isolated(t);
 for(const [response,state,exit,timeout]of[[{success:true,build:{buildId,status:'failed'}},'failed',1,'1'],[{success:true,build:{buildId,status:'running',securityReview:{decision:'manual_review'}}},'action_required',2,'1'],[{success:true,build:{buildId,status:'running'}},'timed_out',3,'0.1']]){
  const s=await serve((_req,res)=>json(res,response));try{await assert.rejects(execute(process.execPath,[cli,'status',buildId,'--endpoint',s.url,'--wait','--timeout-seconds',timeout,'--json'],{env}),e=>{const out=JSON.parse(e.stdout);assert.equal(e.code,exit);assert.equal(out.wait.state,state);assert.equal(out.componentRef,undefined);assert.equal(out.buildId,buildId);return true;});assert(s.requests.every(x=>x.method==='GET'));}finally{await s.close();}
 }
 const s=await serve((_req,res)=>{res.statusCode=403;json(res,{error:'private diagnostic must not be copied'});});try{await assert.rejects(execute(process.execPath,[cli,'status',buildId,'--endpoint',s.url,'--wait','--json'],{env}),e=>{const out=JSON.parse(e.stdout);assert.equal(e.code,2);assert.equal(out.wait.reason,'status_read_denied');assert.equal(out.wait.httpStatus,403);assert.doesNotMatch(e.stdout+e.stderr,/private diagnostic/);return true;});}finally{await s.close();}
});

test('SIGINT stops the owned CLI observer and leaves the original build untouched',{timeout:5000},async t=>{
 const env=await isolated(t);let first;const seen=new Promise(resolve=>{first=resolve;});const s=await serve((_req,res)=>{json(res,{success:true,build:{buildId,status:'running'}});first();});t.after(s.close);
 const child=spawn(process.execPath,[cli,'status',buildId,'--endpoint',s.url,'--wait','--json'],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const joined=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');});
 await Promise.race([seen,joined.then(()=>{throw Error('observer exited before its original status request');})]);child.kill('SIGINT');const end=await joined;assert.deepEqual(end,{code:130,signal:null});const out=JSON.parse(stdout);assert.equal(out.wait.state,'cancelled');assert.equal(out.buildId,buildId);assert.equal(out.componentRef,undefined);assert(s.requests.every(x=>x.method==='GET'));assert(!stderr.includes('upload'));
});

test('human and JSON status retain the same relative compiler location, stage, hint and bounded excerpt',async t=>{
 const env=await isolated(t),payload=ready();payload.build.diagnostics=[{code:'compile.syntax',severity:'error',stage:'build',message:'src/Component.tsx:12:7 unexpected token',repairHint:'Fix the syntax at this location.'}];payload.build.logs=[{title:'Compile',lines:['src/Component.tsx:12:7','12 | return <Panel />;'],truncated:true}];
 const s=await serve((_req,res)=>json(res,payload));t.after(s.close);
 const human=await execute(process.execPath,[cli,'status',buildId,'--endpoint',s.url],{env}),structured=await execute(process.execPath,[cli,'status',buildId,'--endpoint',s.url,'--json'],{env});
 assert.match(human.stdout,/ERROR \[build\] compile\.syntax/u);assert.match(human.stdout,/src\/Component\.tsx:12:7/u);assert.match(human.stdout,/Hint: Fix/u);assert.match(human.stdout,/12 \| return <Panel \/>;/u);assert.match(human.stdout,/excerpt truncated/u);
 assert.deepEqual(JSON.parse(structured.stdout).build.logs,payload.build.logs);assert.equal(s.requests.length,2);
});
