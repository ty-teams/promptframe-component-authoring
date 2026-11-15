import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,rm,unlink,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {capturePnpmWorkspaceLock} from '../dist/workspace-lockfile.js';
import {captureDevelopmentModule,startDevelopmentWorkspace} from '../dist/development-workspace.js';
import {developmentFixture} from './fixtures/development-component.mjs';

async function fixture() {
 const root=await mkdtemp(join(tmpdir(),'pf-nested-lock-')),works=[];
 const importers={};
 for(const name of ['octopus','roadtrip']){
  const work=join(root,'works',name),module={id:'@demo/'+name,path:'components/model'};
  const dir=join(work,module.path);await developmentFixture(dir,name);await unlink(join(dir,'pnpm-lock.yaml'));
  const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));manifest.id=module.id;await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));
  await writeFile(join(work,'promptframe-workspace.json'),JSON.stringify({schemaVersion:'promptframe-workspace.v0.1.0',sharedDirectories:[],components:[module]}));
  await writeFile(join(work,'pnpm-workspace.yaml'),'packages: [components/*]\n');
  const pkg=JSON.parse(await readFile(join(dir,'package.json'),'utf8')),entry={};
  for(const group of ['dependencies','devDependencies','optionalDependencies'])if(pkg[group]){
   entry[group]=Object.fromEntries(Object.entries(pkg[group]).map(([key,specifier])=>[key,{specifier,version:specifier.replace(/^[~^]/,'')}]));
  }
  importers['works/'+name+'/'+module.path]=entry;works.push({work,module,dir});
 }
 const lock={lockfileVersion:'9.0',importers};
 await writeFile(join(root,'pnpm-workspace.yaml'),'packages: [works/*, works/*/components/*]\n');
 await writeFile(join(root,'pnpm-lock.yaml'),JSON.stringify(lock));
 return{root,works,lock,cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('one pnpm owner supplies both nested works without capturing sibling source or raw locks in their packages',async()=>{
 const f=await fixture();try{
  for(const item of f.works){
   const lock=capturePnpmWorkspaceLock(item.dir);assert.equal(lock.root,f.root);
   assert.equal(lock.importer,'works/'+item.work.split('/').at(-1)+'/components/model');lock.verifyUnchanged();
   const snapshot=captureDevelopmentModule(item.work,item.module),files=snapshot.readFiles();
   const evidence=files.find(file=>file.path.endsWith('/promptframe-lockfile-evidence.json'));assert(evidence);
   const parsed=JSON.parse(Buffer.from(evidence.bytes).toString());assert.equal(parsed.lockfiles[0].relativePath,'../../../../pnpm-lock.yaml');
   assert(files.every(file=>!file.path.includes(item===f.works[0]?'roadtrip':'octopus')));
   assert(!files.some(file=>file.path==='pnpm-lock.yaml'));
  }
 }finally{await f.cleanup();}
});

test('wrong coverage, missing importer, stale specifications, symlinks and a repository boundary cannot borrow a parent lock',async()=>{
 const f=await fixture();try{
  const item=f.works[0],file=join(f.root,'pnpm-lock.yaml'),workspace=join(f.root,'pnpm-workspace.yaml');
  await writeFile(workspace,'packages: [other/*]\n');assert.throws(()=>capturePnpmWorkspaceLock(item.dir),/owner_mismatch/);
  await writeFile(workspace,'packages: [works/*, works/*/components/*]\n');
  const missing=structuredClone(f.lock);delete missing.importers['works/octopus/components/model'];await writeFile(file,JSON.stringify(missing));
  assert.throws(()=>capturePnpmWorkspaceLock(item.dir),/importer_missing/);
  const stale=structuredClone(f.lock),entry=stale.importers['works/octopus/components/model'];
  const group=Object.keys(entry)[0],name=Object.keys(entry[group])[0];entry[group][name].specifier='0.0.0';await writeFile(file,JSON.stringify(stale));
  assert.throws(()=>capturePnpmWorkspaceLock(item.dir),/importer_stale/);
  await writeFile(file,JSON.stringify(f.lock));const first=capturePnpmWorkspaceLock(item.dir);
  await writeFile(file,JSON.stringify({...f.lock,settings:{autoInstallPeers:true}}));assert.throws(()=>first.verifyUnchanged(),/changed_during_read/);
  await unlink(file);await writeFile(join(f.root,'foreign-lock'),JSON.stringify(f.lock));await symlink(join(f.root,'foreign-lock'),file);
  assert.throws(()=>capturePnpmWorkspaceLock(item.dir),/symlink/);await unlink(file);await writeFile(file,JSON.stringify(f.lock));
  await mkdir(join(item.work,'.git'));assert.equal(capturePnpmWorkspaceLock(item.dir),undefined);
 }finally{await f.cleanup();}
});

test('real dev checks only the selected work and observes the exact parent lock; no lock stays rejected',async()=>{
 const f=await fixture();let server,controller;try{
  const item=f.works[0],origin='https://studio.example';
  server=await startDevelopmentWorkspace({root:item.work,modules:[item.module],studioOrigin:origin});
  controller=new AbortController();const response=await fetch(server.url+'/__promptframe/events',{headers:{Origin:origin,Authorization:'Bearer '+server.credential},signal:controller.signal});
  assert.equal(response.status,200);const reader=response.body.getReader();let buffer='';
  const wait=async predicate=>{
   const timer=setTimeout(()=>controller.abort(),30000);
   try{while(true){let i;while((i=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,i);buffer=buffer.slice(i+2);const row=block.split('\n').find(line=>line.startsWith('data: '));if(row){const value=JSON.parse(row.slice(6));if(predicate(value))return value;}}
    const next=await reader.read();assert.equal(next.done,false);buffer+=new TextDecoder().decode(next.value);}}
   finally{clearTimeout(timer);}
  };
  const ready=await wait(value=>value.modules.length===1&&value.modules[0].status==='checked');
  assert.equal(ready.modules[0].moduleId,item.module.id);
  await writeFile(join(f.root,'pnpm-lock.yaml'),JSON.stringify({...f.lock,settings:{autoInstallPeers:true}}));
  const updated=await wait(value=>value.modules[0].status==='checked'&&value.modules[0].sourceRevision!==ready.modules[0].sourceRevision);
  assert.equal(updated.modules.length,1);
  await unlink(join(f.root,'pnpm-lock.yaml'));
  const failed=await wait(value=>value.modules[0].status==='failed');
  assert.equal(failed.modules[0].diagnostic,'dependency.install.lockfile_required');
 }finally{controller?.abort();await server?.close();await f.cleanup();}
});
