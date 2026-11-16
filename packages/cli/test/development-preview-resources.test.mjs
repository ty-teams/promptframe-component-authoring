import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rename,readFile,writeFile,rm,symlink,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {DevelopmentPreviewResources} from '../dist/development-preview-resources.js';
import {capturePreviewResourceFile,writePreviewResourceSelection,clearPreviewResourceDraft,
  readPreviewResourceDraft,PREVIEW_RESOURCE_DRAFT_TTL_MS} from '../dist/preview-resource-draft.js';
import {startDevelopmentWorkspace} from '../dist/development-workspace.js';
import {developmentFixture} from './fixtures/development-component.mjs';

const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
function glb(label){
  const text=Buffer.from(JSON.stringify({asset:{version:'2.0',generator:label}}));
  const json=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]),header=Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length,8);
  header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);return Buffer.concat([header,json]);
}
const schema=(kind='model')=>"import {z} from 'zod';import {promptFrameResourceSchema} from '@promptframe/contracts';export const propsSchema=z.object({model:promptFrameResourceSchema({kinds:['"+kind+"'],sources:['public','asset'],maxFileBytes:1024}).describe('Selected model')});export const PropsSchema=propsSchema;";
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'pf-selected-model-')),module={id:'@demo/captured-component',path:'component'};
  const directory=join(root,module.path);await developmentFixture(directory);
  await writeFile(join(directory,'src/schema.ts'),schema());
  await writeFile(join(directory,'src/preview-props.json'),JSON.stringify({durationFrames:60,fps:30,width:320,height:180,props:{model:'/example.glb'}}));
  await writeFile(join(directory,'.gitignore'),'.promptframe/\n');
  const file=join(root,'selected.glb'),bytes=glb('first');await writeFile(file,bytes);
  writePreviewResourceSelection(directory,{prop:'/model',file:capturePreviewResourceFile(file),watch:true});
  return{root,module,directory,file,bytes};
}
test('two selected-file updates replace verified bytes without changing source, draft or original expiry',async()=>{
  const f=await fixture();let store;
  try{
    const paths=[];store=new DevelopmentPreviewResources(f.root,[f.module],value=>paths.push(value));
    const draft=await readFile(join(f.directory,'.promptframe/local-previews/resources.json')),source=await readFile(join(f.directory,'src/Component.tsx'));
    assert.equal(store.observe(),true);const first=store.snapshot()[0];assert.equal(first.sha256,hash(f.bytes));
    for(const label of ['second','third']){
      const bytes=glb(label);await writeFile(f.file,bytes);assert.equal(store.observe(),true);
      const row=store.snapshot()[0];assert.equal(row.sha256,hash(bytes));assert.equal(row.resourceId,first.resourceId);
      assert.equal(row.expiresAt,first.expiresAt);assert.deepEqual(store.read(row.resourceId,row.sha256).bytes,bytes);
      assert.equal(store.read(row.resourceId,first.sha256),undefined);
    }
    assert.deepEqual(await readFile(join(f.directory,'.promptframe/local-previews/resources.json')),draft);
    assert.deepEqual(await readFile(join(f.directory,'src/Component.tsx')),source);
    assert(!JSON.stringify(store.snapshot()).includes(f.root));assert.deepEqual(paths.at(-1),[f.file]);
    store.close();assert.deepEqual(paths.at(-1),[]);assert.deepEqual(store.snapshot(),[]);
  }finally{store?.close();await rm(f.root,{recursive:true,force:true});}
});
test('bad update retains last good immutable bytes with a diagnostic; schema changes revoke instead of retaining',async()=>{
  const f=await fixture(),store=new DevelopmentPreviewResources(f.root,[f.module]);
  try{
    store.observe();const original=store.snapshot()[0];
    await writeFile(f.file,'not a glb');store.observe();const bad=store.snapshot()[0];
    assert.equal(bad.sha256,original.sha256);assert.match(bad.diagnostic,/^(model\.|preview\.resource\.)/);
    assert.deepEqual(store.read(bad.resourceId,bad.sha256).bytes,f.bytes);
    const repaired=glb('repaired');await writeFile(f.file,repaired);store.observe();
    assert.equal(store.snapshot()[0].diagnostic,undefined);assert.equal(store.snapshot()[0].sha256,hash(repaired));
    await writeFile(join(f.directory,'src/schema.ts'),schema('image'));store.observe();assert.deepEqual(store.snapshot(),[]);
    assert.equal(store.read(original.resourceId,original.sha256),undefined);
  }finally{store.close();await rm(f.root,{recursive:true,force:true});}
});
test('clear, original deadline, symlink replacement, new selection and disposal do not silently acquire bytes',async()=>{
  const f=await fixture(),store=new DevelopmentPreviewResources(f.root,[f.module]);
  try{
    const draft=readPreviewResourceDraft(f.directory);store.observe();const original=store.snapshot()[0];
    const foreign=join(f.root,'other.glb');await writeFile(foreign,glb('other'));
    await unlink(f.file);await symlink(foreign,f.file);store.observe();
    assert.equal(store.snapshot()[0].sha256,original.sha256);assert(store.snapshot()[0].diagnostic);
    assert.deepEqual(store.read(original.resourceId,original.sha256).bytes,f.bytes);
    clearPreviewResourceDraft(f.directory);store.observe();assert.deepEqual(store.snapshot(),[]);
    assert.equal(store.read(original.resourceId,original.sha256),undefined);
    await unlink(f.file);await writeFile(f.file,f.bytes);
    writePreviewResourceSelection(f.directory,{prop:'/model',file:capturePreviewResourceFile(f.file),watch:true});store.observe();
    store.observe(Date.parse(readPreviewResourceDraft(f.directory).updatedAt)+PREVIEW_RESOURCE_DRAFT_TTL_MS);
    assert.deepEqual(store.snapshot(),[]);
    assert.equal(store.read(original.resourceId,original.sha256,Date.parse(draft.updatedAt)+PREVIEW_RESOURCE_DRAFT_TTL_MS),undefined);
    store.close();assert.equal(store.observe(),false);
  }finally{store.close();await rm(f.root,{recursive:true,force:true});}
});
test('non-watched selection remains immutable and rejects later modifications',async()=>{
  const f=await fixture(),store=new DevelopmentPreviewResources(f.root,[f.module]);
  try{
    const legacy=capturePreviewResourceFile(f.file);delete legacy.parent;
    writePreviewResourceSelection(f.directory,{prop:'/model',file:legacy});
    store.observe();assert.equal(store.snapshot()[0].watch,false);
    await writeFile(f.file,glb('changed'));store.observe();assert.deepEqual(store.snapshot(),[]);
  }finally{store.close();await rm(f.root,{recursive:true,force:true});}
});
test('watching follows atomic file replacement within the selected parent but refuses a replaced parent',async()=>{
  const f=await fixture(),store=new DevelopmentPreviewResources(f.root,[f.module]);
  try{
    const directory=join(f.root,'models');await mkdir(directory);const file=join(directory,'selected.glb');
    await writeFile(file,f.bytes);writePreviewResourceSelection(f.directory,{prop:'/model',file:capturePreviewResourceFile(file),watch:true});
    store.observe();const initial=store.snapshot()[0];
    await writeFile(join(directory,'new.glb'),glb('atomic replacement'));await rename(join(directory,'new.glb'),file);
    store.observe();const current=store.snapshot()[0];assert.notEqual(current.sha256,initial.sha256);
    await rename(directory,directory+'-old');await mkdir(directory);await writeFile(file,glb('foreign parent'));
    store.observe();const refused=store.snapshot()[0];
    assert.equal(refused.sha256,current.sha256);assert.equal(refused.diagnostic,'preview.resource.file_parent_changed');
    assert.equal(store.expire(Date.parse(current.expiresAt)),true);
    assert.equal(store.read(current.resourceId,current.sha256,Date.parse(current.expiresAt)),undefined);
    assert.deepEqual(store.snapshot(Date.parse(current.expiresAt)),[]);
  }finally{store.close();await rm(f.root,{recursive:true,force:true});}
});
test('the existing authenticated dev HTTP/SSE surface observes two model revisions and retains a rejected update',async()=>{
  const f=await fixture(),origin='https://studio.example',abort=new AbortController();let server,stream;
  try{
    server=await startDevelopmentWorkspace({root:f.root,modules:[f.module],studioOrigin:origin});
    const headers={Origin:origin,Authorization:'Bearer '+server.credential};
    const response=await fetch(server.url+'/__promptframe/events',{headers,signal:abort.signal});assert.equal(response.status,200);
    const reader=response.body.getReader();let pending='';
    stream={async wait(predicate,label){
      const timer=setTimeout(()=>abort.abort(Error('model watcher wait: '+label)),20000);
      try{while(true){let boundary;while((boundary=pending.indexOf('\n\n'))>=0){
        const message=pending.slice(0,boundary);pending=pending.slice(boundary+2);
        const data=message.split('\n').find(row=>row.startsWith('data: '));
        if(data){const value=JSON.parse(data.slice(6));if(predicate(value))return value;}
      }const next=await reader.read();assert.equal(next.done,false);pending+=new TextDecoder().decode(next.value);}}
      finally{clearTimeout(timer);}
    }};
    const initial=await stream.wait(value=>value.localResources?.[0]?.sha256===hash(f.bytes),'initial selection');
    const first=initial.localResources[0],get=row=>fetch(server.url+'/__promptframe/local-resources/'+row.resourceId+'/'+row.sha256.slice(7),{headers});
    for(const label of ['second','third']){
      const bytes=glb(label);await writeFile(f.file,bytes);
      const event=await stream.wait(value=>value.localResources?.[0]?.sha256===hash(bytes),label);
      const actual=await get(event.localResources[0]);assert.equal(actual.status,200);
      assert.deepEqual(Buffer.from(await actual.arrayBuffer()),bytes);
      assert.equal(event.localResources[0].expiresAt,first.expiresAt);
    }
    const current=JSON.parse(await(await fetch(server.url+'/__promptframe/registry',{headers})).text()).localResources[0];
    await writeFile(f.file,'bad update');
    const rejected=await stream.wait(value=>Boolean(value.localResources?.[0]?.diagnostic),'bad update');
    assert.equal(rejected.localResources[0].sha256,current.sha256);assert.equal((await get(current)).status,200);
    assert.equal((await fetch(server.url+'/__promptframe/local-resources/'+current.resourceId+'/'+current.sha256.slice(7),
      {headers:{...headers,Origin:'https://foreign.example'}})).status,403);
    clearPreviewResourceDraft(f.directory);
    assert.equal((await get(current)).status,409);
    const state=await(await fetch(server.url+'/__promptframe/registry',{headers})).json();assert.deepEqual(state.localResources,[]);
  }finally{abort.abort();if(server)await server.close();await rm(f.root,{recursive:true,force:true});}
  await assert.rejects(fetch(server.url+'/__promptframe/registry',{signal:AbortSignal.timeout(2000)}));
});
