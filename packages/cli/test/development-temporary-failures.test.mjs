import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createDevelopmentTemporary,cleanupDevelopmentTemporaries} from '../dist/development-temporary.js';
import {runDevelopmentProcess} from '../dist/development-process.js';
import {validateDevelopmentContents} from '../dist/development-validation.js';
import {captureDevelopmentFiles} from '../dist/development-files.js';
import {developmentFixture,developmentLimits} from './fixtures/development-component.mjs';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function exited(pid){try{const fields=fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ').at(-1).split(' ');return ['Z','X'].includes(fields[0]);}catch(error){return error.code==='ENOENT';}}
function workerFiles(cwd){
  fs.writeFileSync(join(cwd,'owned-descendant.mjs'),`import fs from 'node:fs';fs.writeFileSync('descendant-ready.json',JSON.stringify({pid:process.pid}));const deadline=Date.now()+8000;const timer=setInterval(()=>{if(fs.existsSync('release')){fs.writeFileSync('descendant-final','done');clearInterval(timer);}else{fs.writeFileSync('descendant-writing','alive');if(Date.now()>deadline){clearInterval(timer);process.exitCode=2;}}},10);`);
  const worker=join(cwd,'owned-leader.mjs');
  fs.writeFileSync(worker,`import{spawn}from'node:child_process';spawn(process.execPath,['owned-descendant.mjs'],{cwd:process.cwd(),stdio:'ignore',env:{}});setInterval(()=>{},1000);`);return worker;
}
for(const kind of ['build','validation'])for(const fault of ['identity','marker']){
  test(`${kind}: failed ${fault} registration plus leader close cannot retire a live descendant`,{skip:process.platform!=='linux',timeout:15000},async t=>{
    const parent=fs.mkdtempSync(join(tmpdir(),'pf-owned-temp-fault-')),temporaryParent=join(parent,'temporaries');fs.mkdirSync(temporaryParent,{mode:0o700});
    let workerPid,descendantPid,content,temporary,injected=false;
    const originalSpawn=cp.spawn,originalRead=fs.readFileSync,originalFsync=fs.fsyncSync;
    const descendantsReady=()=>{const until=Date.now()+5000;while(Date.now()<until){try{descendantPid=JSON.parse(originalRead(join(content,'descendant-ready.json'),'utf8')).pid;return;}catch{}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}throw Error('fixture.descendant_not_ready');};
    try{
      const paths=await developmentFixture(join(parent,'source'));
      const capture=captureDevelopmentFiles(join(parent,'source'),paths,developmentLimits);
      if(kind==='build'){temporary=await createDevelopmentTemporary('build',temporaryParent);content=temporary.directory;}
      t.mock.method(cp,'spawn',(command,args,options)=>{
        content=options.cwd;const worker=workerFiles(content);
        if(kind==='validation')assert.equal(args[1],'validate');
        const child=originalSpawn(command,kind==='validation'?[worker]:args,options);workerPid=child.pid;return child;
      });
      t.mock.method(fs,'readFileSync',(path,...args)=>{
        if(fault==='identity'&&!injected&&String(path)==='/proc/'+workerPid+'/stat'){
          descendantsReady();injected=true;throw Object.assign(Error('fixture.birth_read_failed'),{code:'EACCES'});
        }return originalRead(path,...args);
      });
      t.mock.method(fs,'fsyncSync',fd=>{
        if(fault==='marker'&&!injected&&content&&fs.readlinkSync('/proc/self/fd/'+fd)===dirname(content)
          &&JSON.parse(originalRead(join(dirname(content),'.promptframe-temporary.json'),'utf8')).phase==='running'){
          descendantsReady();injected=true;throw Object.assign(Error('fixture.marker_write_failed'),{code:'EIO'});
        }return originalFsync(fd);
      });
      syncBuiltinESMExports();
      const produce=kind==='build'?runDevelopmentProcess({worker:workerFiles(content),cwd:content,input:'',timeoutMs:7000,maximumOutputBytes:4096,temporary}):validateDevelopmentContents(capture,{temporaryParent,timeoutMs:7000});
      await assert.rejects(produce,fault==='identity'?/identity_unavailable/:/marker_write_failed/);
      if(temporary)try{temporary.release();}catch{/* First producer error is retained; cleanup must remain uncertain. */}
      assert.equal(injected,true);assert.equal(exited(workerPid),true);assert.equal(exited(descendantPid),false);
      assert(fs.existsSync(content),'leader close is not proof of the unrecorded descendant exit');
      assert.equal((await cleanupDevelopmentTemporaries(temporaryParent)).removed,0);
      const record=JSON.parse(originalRead(join(dirname(content),'.promptframe-temporary.json'),'utf8'));
      assert(record.phase==='launching'&&record.worker===null||record.phase==='running'&&record.worker.pid===workerPid);
      fs.writeFileSync(join(content,'release'),'normal fixture exit');
      for(let i=0;i<300&&!exited(descendantPid);i++)await wait(10);
      assert.equal(exited(descendantPid),true);assert.equal(originalRead(join(content,'descendant-final'),'utf8'),'done');
      assert.equal((await cleanupDevelopmentTemporaries(temporaryParent)).removed,0,'a live creator is not retired by this test observing its child');
    }finally{
      t.mock.restoreAll();syncBuiltinESMExports();
      if(content&&fs.existsSync(content))fs.writeFileSync(join(content,'release'),'normal fixture exit');
      if(descendantPid)for(let i=0;i<900&&!exited(descendantPid);i++)await wait(10);
      if(!descendantPid||exited(descendantPid))fs.rmSync(parent,{recursive:true,force:true});
      else throw Error('fixture.descendant_exit_unconfirmed_root_retained');
    }
  });
}
test('legacy joined/null remains uncertain while an actual spawn error can retire its never-created worker', {skip:process.platform!=='linux',timeout:10000},async()=>{
 const parent=fs.mkdtempSync(join(tmpdir(),'pf-owned-temp-no-start-'));
 try{
  const legacy=await createDevelopmentTemporary('build',parent),marker=join(dirname(legacy.directory),'.promptframe-temporary.json');legacy.beforeSpawn();
  const record=JSON.parse(fs.readFileSync(marker,'utf8'));record.phase='joined';fs.writeFileSync(marker,JSON.stringify(record)+'\n',{mode:0o600});
  try{legacy.release();}catch{}
  assert(fs.existsSync(legacy.directory));assert.equal((await cleanupDevelopmentTemporaries(parent)).removed,0);
  const absent=await createDevelopmentTemporary('build',parent);
  await assert.rejects(runDevelopmentProcess({worker:join(parent,'not-a-worker.mjs'),cwd:join(parent,'missing-cwd'),input:'',timeoutMs:1000,maximumOutputBytes:4096,temporary:absent}),error=>error.code==='ENOENT');
  const noStart=JSON.parse(fs.readFileSync(join(dirname(absent.directory),'.promptframe-temporary.json'),'utf8'));
  assert.equal(noStart.phase,'not-started');assert.equal(noStart.worker,null);absent.release();assert.equal(fs.existsSync(absent.directory),false);
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
