import assert from 'node:assert/strict';
import test from 'node:test';
import {fork} from 'node:child_process';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile,symlink,utimes,lstat,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanupDevelopmentTemporaries,createDevelopmentTemporary} from '../dist/development-temporary.js';
const fixture=fileURLToPath(new URL('./fixtures/development-temporary-producer.mjs',import.meta.url));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function interrupted(parent,mode){
  const child=fork(fixture,[parent,mode],{env:{NO_COLOR:'1'},stdio:['ignore','ignore','ignore','ipc']});
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  const message=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('owned producer did not become ready')),7000);
    child.once('message',value=>{clearTimeout(timer);resolve(value);});child.once('error',error=>{clearTimeout(timer);reject(error);});});
  assert.equal(child.kill('SIGKILL'),true);assert.equal((await closed).signal,'SIGKILL');return message;
}

test('live owned roots, old mtimes and unmarked or symlink paths do not authorize cleanup; marker is outside captured contents',{
  skip:process.platform!=='linux',timeout:10_000,
},async()=>{
  const parent=await mkdtemp(join(tmpdir(),'pf-own-temp-safety-'));const active=await createDevelopmentTemporary('check',parent);
  try{
    assert.deepEqual(await readdir(active.directory),[],'host producer metadata never enters captured validation input');
    const root=dirname(active.directory);await utimes(root,new Date(0),new Date(0));
    const foreign=join(parent,'promptframe-build-foreign');await mkdir(foreign,{mode:0o700});await writeFile(join(foreign,'do-not-delete'),'own fixture');
    await symlink(foreign,join(parent,'promptframe-check-link'));
    const copied=join(parent,'promptframe-check-copy');await mkdir(copied,{mode:0o700});
    await writeFile(join(copied,'.promptframe-temporary.json'),await readFile(join(root,'.promptframe-temporary.json')),{mode:0o600});
    const result=await cleanupDevelopmentTemporaries(parent);assert.equal(result.removed,0);assert(result.retained>=1);assert(result.unknown>=2);
    assert.equal(await readFile(join(foreign,'do-not-delete'),'utf8'),'own fixture');assert((await lstat(root)).isDirectory());
    active.release();assert.equal((await readdir(parent)).includes(root.split('/').at(-1)),false);
  }finally{await rm(parent,{recursive:true,force:true});}
});
test('confirmed dead pre-spawn owner is recovered under one kernel lock; concurrent cleanup does not steal a live root',{
  skip:process.platform!=='linux',timeout:15_000,
},async()=>{
  const parent=await mkdtemp(join(tmpdir(),'pf-own-temp-retire-'));let live;
  try{
    const retired=await interrupted(parent,'preparing');live=await createDevelopmentTemporary('check',parent);
    assert.equal((await readdir(parent)).length,1,'the ordinary next capture already reclaimed only the dead pre-spawn root');
    const result=await Promise.all([cleanupDevelopmentTemporaries(parent),cleanupDevelopmentTemporaries(parent)]);
    assert(result.some(value=>value.lock==='busy'));assert(result.every(value=>value.removed===0));
    assert((await lstat(live.directory)).isDirectory());await assert.rejects(lstat(retired.directory),{code:'ENOENT'});live.release();
    assert.deepEqual(await readdir(parent),[]);
  }finally{live?.release();await rm(parent,{recursive:true,force:true});}
});
test('a joined record without an observed isolated group is retained, and an unprotected writable parent is rejected',{
  skip:process.platform!=='linux',timeout:10_000,
},async()=>{
  const parent=await mkdtemp(join(tmpdir(),'pf-own-temp-unknown-'));
  try{
    const own=await createDevelopmentTemporary('build',parent);own.beforeSpawn();own.spawned(process.pid);own.joined();own.release();
    assert((await lstat(own.directory)).isDirectory(),'joining one leader is not a group exit proof');
    assert.equal((await cleanupDevelopmentTemporaries(parent)).removed,0);
    const shared=await mkdtemp(join(tmpdir(),'pf-own-temp-writable-'));
    try{await chmod(shared,0o775);await assert.rejects(createDevelopmentTemporary('check',shared),/identity_unconfirmed/);}
    finally{await rm(shared,{recursive:true,force:true});}
  }finally{await rm(parent,{recursive:true,force:true});}
});
test('an interrupted launch with no recorded worker identity remains unknown, never treated as NoStart by cleanup',{
  skip:process.platform!=='linux',timeout:15_000,
},async()=>{
  const parent=await mkdtemp(join(tmpdir(),'pf-own-temp-launch-'));
  try{const retained=await interrupted(parent,'launching'),result=await cleanupDevelopmentTemporaries(parent);
    assert.equal(result.removed,0);assert.equal(result.retained,1);assert((await lstat(retained.directory)).isDirectory());
  }finally{await rm(parent,{recursive:true,force:true});}
});
test('original worker exit does not retire a live compiler descendant; its real final write/exit precedes cleanup',{
  skip:process.platform!=='linux',timeout:20_000,
},async()=>{
  const parent=await mkdtemp(join(tmpdir(),'pf-own-temp-descendant-'));let retained;
  try{
    retained=await interrupted(parent,'descendant');const root=dirname(retained.directory),record=JSON.parse(await readFile(join(root,'.promptframe-temporary.json'),'utf8'));
    assert.equal(record.phase,'joined');assert.equal(record.worker.group,record.worker.pid);
    const first=await cleanupDevelopmentTemporaries(parent);assert.equal(first.removed,0);assert.equal(first.retained,1);
    await writeFile(join(retained.directory,'release'),'normal own child exit');
    for(let n=0;n<200;n++){try{if(await readFile(join(retained.directory,'child-final.txt'),'utf8')==='original child finished')break;}catch{}await wait(10);}
    assert.equal(await readFile(join(retained.directory,'child-final.txt'),'utf8'),'original child finished');
    let removed=0;for(let n=0;n<200&&removed===0;n++){removed+=(await cleanupDevelopmentTemporaries(parent)).removed;if(!removed)await wait(10);}
    assert.equal(removed,1);assert.deepEqual(await readdir(parent),[]);retained=undefined;
  }finally{
    if(retained){try{await writeFile(join(retained.directory,'release'),'normal own child exit');}catch{}await wait(100);}
    // Only the roots and scripts created by this isolated fixture are removed.
    await rm(parent,{recursive:true,force:true});
  }
});
