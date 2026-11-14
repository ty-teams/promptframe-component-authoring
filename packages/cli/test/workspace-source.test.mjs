import assert from'node:assert/strict';
import {execFile}from'node:child_process';
import {promisify}from'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink}from'node:fs/promises';
import {tmpdir}from'node:os';
import {join,dirname}from'node:path';
import {fileURLToPath}from'node:url';
import http from'node:http';
import test,{after} from'node:test';
import {captureDevelopmentModule,startDevelopmentWorkspace}from'../dist/development-workspace.js';
import {COMPONENT_STANDARD_SOURCE_HASH,PROMPTFRAME_ACTIVE_AUTHORING_PACKAGE_VERSIONS}from'@promptframe/contracts';
import {COMPONENT_SOURCE_LAYOUT_VERSION}from'@promptframe/contracts/source-layout';
import {validateDevelopmentContents}from'../dist/development-validation.js';
import {buildDevelopmentContents}from'../dist/development-build.js';
import {validateComponentSourceLayoutFiles}from'@promptframe/contracts/source-layout-evaluator';
import {developmentFixture}from'./fixtures/development-component.mjs';

const exec=promisify(execFile),cli=fileURLToPath(new URL('../dist/index.js',import.meta.url));
const configRoot=await mkdtemp(join(tmpdir(),'pf-workspace-config-'));
const environment={...process.env,PROMPTFRAME_CONFIG:join(configRoot,'config.json')};
for(const key of ['PROMPTFRAME_API_BASE','REMOTION_MEDIA_API_BASE','PROMPTFRAME_CLI_TOKEN','PROMPTFRAME_CI_TOKEN'])delete environment[key];
const run=(args)=>exec(process.execPath,[cli,...args],{env:environment});
after(()=>rm(configRoot,{recursive:true,force:true}));
async function fixture(root){
 const modules=[];
 for(const name of ['a','b','c']){
  const module={id:'@demo/part-'+name,path:'components/part-'+name},dir=join(root,module.path);modules.push(module);
  await developmentFixture(dir,name);const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));manifest.id=module.id;manifest.name='part-'+name;
  await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));
  const pkg=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));
  for(const name of ['@promptframe/contracts','@promptframe/component-kit'])pkg.dependencies[name]=PROMPTFRAME_ACTIVE_AUTHORING_PACKAGE_VERSIONS[name];
  await writeFile(join(dir,'package.json'),JSON.stringify(pkg));
  await writeFile(join(dir,'src/schema.ts'),'import {z} from "zod";export const PropsSchema=z.object({title:z.string().describe("Title")});');
  if(name!=='c')await writeFile(join(dir,'src/Component.tsx'),(await readFile(join(dir,'src/Component.tsx'),'utf8')).replace("'./shared'","'../../../shared/theme'"));
 }
 await mkdir(join(root,'shared'));await writeFile(join(root,'shared/theme.ts'),'export {title} from "./palette.js";');
 await writeFile(join(root,'shared/palette.ts'),'export const title="first-theme";');
 await writeFile(join(root,'shared/unused.ts'),'UNUSED_PRIVATE_CONTROL');await writeFile(join(root,'shared/.env'),'UNUSED_PRIVATE_CONFIGURATION');
 await writeFile(join(root,'promptframe-workspace.json'),JSON.stringify({schemaVersion:'promptframe-workspace.v0.1.0',components:modules,sharedDirectories:['shared']}));
 return modules;
}
const files=snapshot=>new Map(snapshot.readFiles().map(file=>[file.path,Buffer.from(file.bytes)]));
function unpackStoredZip(bytes){
 const result=new Map();let i=0;
 while(bytes.readUInt32LE(i)===0x04034b50){
  assert.equal(bytes.readUInt16LE(i+8),0);const size=bytes.readUInt32LE(i+18),length=bytes.readUInt16LE(i+26),extra=bytes.readUInt16LE(i+28);
  const name=bytes.subarray(i+30,i+30+length).toString('utf8'),start=i+30+length+extra;
  assert(!result.has(name));result.set(name,bytes.subarray(start,start+size));i=start+size;
 }
 assert.equal(bytes.readUInt32LE(i),0x02014b50);return result;
}
async function restore(directory,contents){
 await mkdir(directory);for(const [name,bytes]of contents){await mkdir(dirname(join(directory,name)),{recursive:true});await writeFile(join(directory,name),bytes,{flag:'wx'});}
}

test('shared A/B and independent C use the same closed dev/package snapshot and restore each fixed version',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pf-shared-source-'));
 try{
  const [a,b,c]=await fixture(root),before=[a,b,c].map(module=>captureDevelopmentModule(root,module)),captured=files(before[0]);
  assert(captured.has('components/part-a/manifest.json'));assert(captured.has('shared/theme.ts'));assert(captured.has('shared/palette.ts'));
  assert(![...captured.keys()].some(name=>name.startsWith('components/part-b/')||name.startsWith('components/part-c/')));
  assert(!captured.has('shared/unused.ts'));assert(!captured.has('shared/.env'));
  assert(![...captured.keys()].some(name=>name.endsWith('pnpm-lock.yaml')));assert(captured.has('components/part-a/promptframe-lockfile-evidence.json'));
  const zip=join(root,'a.zip');await run(['package',root,'--workspace-component',a.id,'--out',zip,'--json']);
  assert.deepEqual(unpackStoredZip(await readFile(zip)),captured,'dev and formal package must select identical input bytes');
  await writeFile(join(root,'shared/palette.ts'),'export const title="new-theme";');
  const after=[a,b,c].map(module=>captureDevelopmentModule(root,module));assert.notEqual(after[0].revision,before[0].revision);assert.notEqual(after[1].revision,before[1].revision);assert.equal(after[2].revision,before[2].revision);
  assert.equal(files(before[0]).get('shared/palette.ts').toString(),'export const title="first-theme";');
  await restore(join(root,'restored-old'),captured);await restore(join(root,'restored-new'),files(after[0]));
  assert.equal(captureDevelopmentModule(join(root,'restored-old'),a).revision,before[0].revision);
  assert.equal(captureDevelopmentModule(join(root,'restored-new'),a).revision,after[0].revision);
  await validateDevelopmentContents(before[0]);
  const built=await buildDevelopmentContents(before[0]);assert(built.artifacts.readFiles().some(file=>Buffer.from(file.bytes).includes('first-theme')));
  assert(!built.artifacts.readFiles().some(file=>Buffer.from(file.bytes).includes('new-theme')));
  const restored=JSON.parse((await run(['validate',join(root,'restored-old'),'--json'])).stdout);assert.equal(restored.command,'validate');
  const restoredCheck=JSON.parse((await run(['check',join(root,'restored-old'),'--target','project_private_generation','--json'])).stdout);
  assert.equal(restoredCheck.components.length,1,'restoring a selected version must not require absent components');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('selecting A does not validate or package an unrelated broken C',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pf-shared-independent-'));
 try{const [a,,c]=await fixture(root);await writeFile(join(root,c.path,'manifest.json'),'invalid unused manifest');
  const result=JSON.parse((await run(['package',root,'--workspace-component',a.id,'--out',join(root,'a.zip'),'--json'])).stdout);assert.equal(result.command,'package');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('real root watcher rebuilds A/B for a shared edit and preserves C and unused shared files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pf-shared-watch-')),origin='http://127.0.0.1:39001';
 const abort=new AbortController();let server,observer;const snapshots=[];
 try{
  const modules=await fixture(root);server=await startDevelopmentWorkspace({root,modules,studioOrigin:origin});
  const response=await fetch(server.url+'/__promptframe/events',{signal:abort.signal,headers:{Origin:origin,Authorization:'Bearer '+server.credential}});
  assert.equal(response.status,200);
  observer=(async()=>{let text='';try{for await(const bytes of response.body){text+=new TextDecoder().decode(bytes);let boundary;
   while((boundary=text.indexOf('\n\n'))>=0){const event=text.slice(0,boundary);text=text.slice(boundary+2);const data=event.split('\n').find(line=>line.startsWith('data: '));if(data)snapshots.push(JSON.parse(data.slice(6)));}
  }}catch(error){if(!abort.signal.aborted)throw error;}})();
  const wait=async predicate=>{const deadline=performance.now()+20000;while(!predicate(snapshots.at(-1))){if(performance.now()>deadline)assert.fail('shared watcher did not publish the expected revision');await new Promise(resolve=>setTimeout(resolve,20));}};
  await wait(value=>value?.modules.every(module=>module.status==='checked'));const before=snapshots.at(-1),count=snapshots.length;
  await writeFile(join(root,'shared/unused.ts'),'still unused');await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(snapshots.length,count,'an unreferenced file cannot invalidate any selected component');
  await writeFile(join(root,'shared/palette.ts'),'export const title="watched-theme";');
  await wait(value=>value?.modules.every(module=>module.status==='checked')&&value.modules[0].sourceRevision!==before.modules[0].sourceRevision&&value.modules[1].sourceRevision!==before.modules[1].sourceRevision);
  const current=snapshots.at(-1);assert.deepEqual(current.modules[2].lastChecked,before.modules[2].lastChecked);
  for(const module of current.modules.slice(0,2)){
   const bundle=await (await fetch(`${server.url}/__promptframe/modules/${encodeURIComponent(module.moduleId)}/bundle/${module.lastChecked.artifactRevision.slice(7)}`,{headers:{Origin:origin,Authorization:'Bearer '+server.credential}})).json();
   assert(bundle.files.some(file=>Buffer.from(file.base64,'base64').includes('watched-theme')));
  }
 }finally{abort.abort();await observer;if(server)await server.close();await rm(root,{recursive:true,force:true});}
});

test('shared code stays subject to the original security checks; component-local parent imports stay inside their root',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pf-shared-security-'));
 try{
  const [a,,c]=await fixture(root);await writeFile(join(root,'shared/palette.ts'),'export const title=localStorage.getItem("private");');
  await assert.rejects(validateDevelopmentContents(captureDevelopmentModule(root,a)),error=>error.code==='development.validation.rejected'&&error.diagnosticCode==='storage.browser_storage');
  const directory=join(root,c.path);await mkdir(join(directory,'src/nested'));
  await writeFile(join(directory,'src/nested/local.ts'),'export {title} from "../shared.js";');
  const source=join(directory,'src/Component.tsx'),original=await readFile(source,'utf8');
  await writeFile(source,original.replace('./shared','./nested/local'));
  await run(['validate',directory,'--json']);
  await writeFile(source,original.replace('./shared','../../../../outside'));
  await assert.rejects(run(['validate',directory,'--json']),error=>/package.no_parent_imports/.test(error.stderr));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('formal packaging retains its 50 MiB budget while shared dev capture keeps 16 MiB',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pf-shared-budget-'));
 try{const [a]=await fixture(root);await writeFile(join(root,a.path,'notes.txt'),Buffer.alloc(17*1024*1024,32));
  assert.throws(()=>captureDevelopmentModule(root,a),/development.contents.byte_limit/);
  const archive=join(root,'a.zip');await run(['package',root,'--workspace-component',a.id,'--out',archive,'--json']);
  assert.equal(unpackStoredZip(await readFile(archive)).get(a.path+'/notes.txt').byteLength,17*1024*1024);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('directory and ZIP upload reuse the single standard read, transmit the same snapshot and reject an old platform before POST',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pf-shared-upload-'));let server;const calls=[];let support=true;
 try{
  const [a]=await fixture(root),archive=join(root,'a.zip');await run(['package',root,'--workspace-component',a.id,'--out',archive,'--json']);
  const expected=await readFile(archive);
  server=http.createServer(async(request,response)=>{
   const chunks=[];for await(const part of request)chunks.push(part);const body=Buffer.concat(chunks);calls.push(request.method+' '+request.url);
   response.setHeader('Content-Type','application/json');
   if(request.url==='/components/standard')return response.end(JSON.stringify({success:true,sourceHash:COMPONENT_STANDARD_SOURCE_HASH,...(support?{sourcePackageLayouts:[COMPONENT_SOURCE_LAYOUT_VERSION]}:{})}));
   assert.equal(request.url,'/components/marketplace/upload');assert.equal(request.method,'POST');assert(body.includes(expected));
   response.end(JSON.stringify({success:true,jobId:'build-shared-controlled',status:'queued'}));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint='http://127.0.0.1:'+server.address().port,common=['--endpoint',endpoint,'--target','project_private_generation','--json'];
  await run(['upload',root,'--workspace-component',a.id,'--out',archive,...common]);await run(['upload',archive,...common]);
  assert.deepEqual(calls,['GET /components/standard','POST /components/marketplace/upload','GET /components/standard','POST /components/marketplace/upload']);
  support=false;await assert.rejects(run(['upload',archive,...common]),error=>/workspace.source.platform_unsupported/.test(error.stderr));
  assert.equal(calls.at(-1),'GET /components/standard');assert.equal(calls.filter(call=>call.startsWith('POST')).length,2);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});

test('missing, ignored, private, undeclared, foreign component and symlink shared imports fail without reading extra inputs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pf-shared-source-deny-')),outside=await mkdtemp(join(tmpdir(),'pf-shared-outside-'));
 try{const [a]=await fixture(root),source=join(root,a.path,'src/Component.tsx'),original=await readFile(source,'utf8');
  for(const request of ['../../../private/theme','../../../components/part-c/src/shared','../../../shared/missing','../../../shared/.npmrc']){
   await writeFile(source,original.replace('../../../shared/theme',request));assert.throws(()=>captureDevelopmentModule(root,a),/workspace.source/);
  }
  await writeFile(source,original);await writeFile(join(root,'.gitignore'),'shared/palette.ts\n');assert.throws(()=>captureDevelopmentModule(root,a),/package.required_file.ignored/);await rm(join(root,'.gitignore'));
  await writeFile(join(outside,'escaped.ts'),'export const title="outside";');await symlink(join(outside,'escaped.ts'),join(root,'shared/link.ts'));
  await writeFile(source,original.replace('../../../shared/theme','../../../shared/link'));assert.throws(()=>captureDevelopmentModule(root,a),/development.capture.outside_root/);
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test('a supplied archive layout cannot smuggle unused shared source, raw locks or another module',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pf-shared-source-archive-'));
 try{const [a]=await fixture(root),captured=captureDevelopmentModule(root,a).readFiles();assert.equal(validateComponentSourceLayoutFiles(captured).componentId,a.id);
  for(const path of ['shared/unreferenced.ts','shared/pnpm-lock.yaml','components/b/src/private.ts']){
   assert.throws(()=>validateComponentSourceLayoutFiles([...captured,{path,bytes:Buffer.from('not an allowed closure input')}]),/workspace.source/);
  }
  const layout=captured.find(file=>file.path==='promptframe-source-layout.json');assert.throws(()=>validateComponentSourceLayoutFiles([...captured,layout]),/duplicate_file/);
 }finally{await rm(root,{recursive:true,force:true});}
});
