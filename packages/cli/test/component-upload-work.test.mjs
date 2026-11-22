import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {COMPONENT_STANDARD_SOURCE_HASH} from '@promptframe/contracts';
import {componentUploadWorkTarget,assertComponentUploadWorkConfirmed} from '../dist/component-upload-work.js';

const run=promisify(execFile),cli=fileURLToPath(new URL('../dist/index.js',import.meta.url));
test('one command intent distinguishes archives and never guesses a changed target acknowledgement',()=>{
  const work={projectId:'own-project',sessionId:'own-work',intentId:'own-intent'};
  const first=componentUploadWorkTarget(work,'sha256:'+'a'.repeat(64));
  assert.deepEqual(first,componentUploadWorkTarget({...work},'sha256:'+'a'.repeat(64)));
  assert.notEqual(first.operationId,componentUploadWorkTarget(work,'sha256:'+'b'.repeat(64)).operationId);
  assertComponentUploadWorkConfirmed({success:true,contractVersion:'creation-component-upload/v1',target:first},first);
  for(const target of [{...first,sessionId:'other'},undefined])
    assert.throws(()=>assertComponentUploadWorkConfirmed({success:true,contractVersion:'creation-component-upload/v1',target},first),/did not confirm/);
  assert.equal(componentUploadWorkTarget({...work,sessionId:'s'.repeat(180)},'sha256:'+'a'.repeat(64)).sessionId.length,180);
});

async function fixture(t,mode,{work=true,changeConfig=false}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'owned-upload-work-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const config=path.join(dir,'config.json'),requests=[];
  await writeFile(path.join(dir,'own.zip'),'own isolated ZIP bytes');
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    requests.push({path:req.url,method:req.method,headers:req.headers,bytes:Buffer.concat(chunks).length});
    const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(req.url==='/cli/auth/whoami')return reply(200,{success:true});
    if(req.url==='/components/standard'){
      if(changeConfig)await writeFile(config,JSON.stringify({endpoint,credential:{endpoint,tokenSecret:'changed-token'},sessionId:'wrong-work',projectId:'other-project'}));
      return reply(200,{success:true,sourceVersion:'component-standard.v0.1.0',sourceHash:COMPONENT_STANDARD_SOURCE_HASH});
    }
    if(req.url==='/components/marketplace/upload-work-target'){
      if(mode==='old')return reply(404,{success:false});
      if(mode==='denied')return reply(403,{success:false,errorCode:'component_upload.activity_scope_denied'});
      const target=JSON.parse(req.headers['x-promptframe-upload-work']);
      return reply(200,{success:true,contractVersion:'creation-component-upload/v1',target:mode==='changed'?{...target,sessionId:'wrong-work'}:target});
    }
    if(req.url==='/components/marketplace/upload'){
      if(mode==='upload-redirect'){res.writeHead(307,{Location:'/unexpected-second-upload'});res.end();return;}
      return reply(202,{success:true,jobId:'component_build_own',status:'queued'});
    }
    reply(404,{});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const endpoint='http://127.0.0.1:'+server.address().port;
  await writeFile(config,JSON.stringify({endpoint,credential:{endpoint,tokenSecret:'own-token'},sessionId:'legacy-resource-work',projectId:'legacy-project'}));
  let result,exit=0;
  try{result=await run(process.execPath,[cli,'upload','own.zip','--endpoint',endpoint,'--json',
    ...(work?['--session-id','own-work','--project-id','own-project','--request-id','own-intent']:[])],{
      cwd:dir,env:{PATH:process.env.PATH,HOME:dir,XDG_CONFIG_HOME:dir,PROMPTFRAME_CONFIG:config,PROMPTFRAME_LANG:'en'},
    });}catch(error){result=error;exit=error.code;}
  return{requests,exit,text:result.stdout+result.stderr};
}
test('a work target is confirmed before ZIP bytes, with the credential and target frozen across config changes',async t=>{
  const r=await fixture(t,'ok',{changeConfig:true});assert.equal(r.exit,0,r.text);
  const check=r.requests.find(q=>q.path.endsWith('/upload-work-target')),upload=r.requests.find(q=>q.path.endsWith('/upload'));
  assert(check);assert(upload);assert.equal(check.bytes,0);assert(upload.bytes>0);
  assert.equal(check.headers.authorization,'Bearer own-token');assert.equal(upload.headers.authorization,check.headers.authorization);
  assert.equal(upload.headers['x-promptframe-upload-work'],check.headers['x-promptframe-upload-work']);
  assert.equal(JSON.parse(upload.headers['x-promptframe-upload-work']).sessionId,'own-work');
  assert.equal(upload.headers['x-request-id'],JSON.parse(upload.headers['x-promptframe-upload-work']).operationId);
});
for(const mode of ['denied','old','changed'])test(`${mode} work confirmation sends no upload or ZIP bytes`,async t=>{
  const r=await fixture(t,mode);assert.notEqual(r.exit,0,r.text);
  assert.equal(r.requests.filter(q=>q.path.endsWith('/upload')).length,0);assert.equal(r.requests.reduce((n,q)=>n+q.bytes,0),0);
});
test('an independent project upload does not adopt a legacy resource session or add an activity preflight',async t=>{
  const r=await fixture(t,'ok',{work:false});assert.equal(r.exit,0,r.text);
  assert.equal(r.requests.filter(q=>q.path.endsWith('/upload-work-target')).length,0);
  assert.equal(r.requests.find(q=>q.path.endsWith('/upload')).headers['x-promptframe-upload-work'],undefined);
});
test('a work upload redirect cannot replay ZIP bytes at a second operation',async t=>{
  const r=await fixture(t,'upload-redirect');assert.notEqual(r.exit,0);
  assert.equal(r.requests.filter(q=>q.path.endsWith('/upload')).length,1);
  assert.equal(r.requests.filter(q=>q.path==='/unexpected-second-upload').length,0);
});
