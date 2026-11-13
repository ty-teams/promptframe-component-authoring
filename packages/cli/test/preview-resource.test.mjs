import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {createServer} from 'vite';
import {promptFramePreviewResources,resolvePreviewResourceGrant} from '../dist/preview-resource-server.js';
import {capturePreviewResourceFile,writePreviewResourceSelection,readPreviewResourceDraft,clearPreviewResourceDraft,
  previewResourceDraftPath,PREVIEW_RESOURCE_DRAFT_TTL_MS} from '../dist/preview-resource-draft.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=','base64');
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const exec=promisify(execFile);
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'component-resource-'));
  await mkdir(join(root,'src'));await mkdir(join(root,'public'));
  const manifest=JSON.parse(await readFile(new URL('../../create-component/templates/react-remotion/manifest.json',import.meta.url)));
  Object.assign(manifest,{id:'@demo/resource-fixture',name:'resource-fixture',displayName:'Resource Fixture'});
  await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
  await writeFile(join(root,'package.json'),JSON.stringify({name:'resource-fixture',version:'0.1.0',dependencies:{zod:'^3.24.0','@promptframe/contracts':'^0.1.39'}}));
  await writeFile(join(root,'pnpm-lock.yaml'),'lockfileVersion: \"9.0\"\n');
  await writeFile(join(root,'src/index.ts'),'export {default} from \"./Component\";');
  await writeFile(join(root,'src/Component.tsx'),'export default function Component(){return null;}');
  await writeFile(join(root,'src/schema.ts'),"import {z} from 'zod';\nimport {promptFrameResourceSchema} from '@promptframe/contracts';\nexport const propsSchema=z.object({illustration:promptFrameResourceSchema({kinds:['image'],accept:['image/png'],maxFileBytes:1024}).describe('Selected illustration')});");
  await writeFile(join(root,'src/preview-props.json'),JSON.stringify({durationFrames:90,fps:30,width:320,height:180,props:{illustration:'/example.png'}}));
  await writeFile(join(root,'public/example.png'),png);await writeFile(join(root,'selected.png'),png);return root;
}
async function server(root){
  const value=await createServer({configFile:false,root,plugins:[promptFramePreviewResources()],server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  await value.listen();return {value,url:'http://127.0.0.1:'+value.httpServer.address().port};
}

test('CLI selection changes only ignored draft; clear retains original files',async()=>{
  const root=await fixture();try{
    const source=await readFile(join(root,'src/preview-props.json'));
    const {stdout}=await exec('node',[resolve('dist/index.js'),'resource','set',root,'--prop','/illustration','--file',join(root,'selected.png'),'--json'],{env:{...process.env,PROMPTFRAME_CONFIG:join(root,'no-config.json')}});
    assert.equal(JSON.parse(stdout).draftOnly,true);assert.deepEqual(await readFile(join(root,'src/preview-props.json')),source);
    assert.match(await readFile(join(root,'.gitignore'),'utf8'),/\.promptframe\//);
    assert.equal(readPreviewResourceDraft(root).selections[0].file.sha256,hash(png));
    await exec('node',[resolve('dist/index.js'),'resource','clear',root,'--json']);
    assert.equal(readPreviewResourceDraft(root),undefined);assert.deepEqual(await readFile(join(root,'selected.png')),png);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('real loopback Vite serves selected bytes and rejects changed files, foreign Origin and replaced capability',async()=>{
  const root=await fixture();let host;try{
    writePreviewResourceSelection(root,{prop:'/illustration',file:capturePreviewResourceFile(join(root,'selected.png'))});host=await server(root);
    const state=await(await fetch(host.url+'/__promptframe/local-preview/state')).json();
    assert.deepEqual(state.issues,[]);assert.match(state.props.illustration,/^\/__promptframe\/local-preview\/[a-f0-9]{64}$/);assert(!JSON.stringify(state).includes(root));
    const result=await fetch(host.url+state.props.illustration);assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await result.arrayBuffer()),png);
    assert.equal((await fetch(host.url+state.props.illustration,{headers:{origin:'https://example.com'}})).status,403);
    await writeFile(join(root,'selected.png'),Buffer.concat([png,Buffer.from('changed')]));assert.equal((await fetch(host.url+state.props.illustration)).status,409);
    const failed=await(await fetch(host.url+'/__promptframe/local-preview/state')).json();
    assert.equal(failed.usingExample,true);assert.equal(failed.props.illustration,'/example.png');assert.match(failed.issues[0].code,/file_changed/);
    writePreviewResourceSelection(root,{prop:'/illustration',file:capturePreviewResourceFile(join(root,'selected.png'))});
    assert.equal((await fetch(host.url+state.props.illustration)).status,404);
  }finally{await host?.value.close();await rm(root,{recursive:true,force:true});}
});

test('expired draft and symlink parents fail; schema symlink never exposes data',async()=>{
  const root=await fixture();let host;try{
    writePreviewResourceSelection(root,{prop:'/illustration',file:capturePreviewResourceFile(join(root,'selected.png'))});
    const path=previewResourceDraftPath(root),draft=JSON.parse(await readFile(path));draft.updatedAt=new Date(Date.now()-PREVIEW_RESOURCE_DRAFT_TTL_MS).toISOString();await writeFile(path,JSON.stringify(draft));
    assert.throws(()=>readPreviewResourceDraft(root),/expired/);clearPreviewResourceDraft(root);
    await rm(join(root,'.promptframe/local-previews'),{recursive:true});await mkdir(join(root,'other'));await symlink(join(root,'other'),join(root,'.promptframe/local-previews'));
    assert.throws(()=>readPreviewResourceDraft(root),/invalid/);assert.throws(()=>clearPreviewResourceDraft(root),/invalid/);
    await rm(join(root,'.promptframe/local-previews'));await mkdir(join(root,'.promptframe/local-previews'));
    writePreviewResourceSelection(root,{prop:'/illustration',file:capturePreviewResourceFile(join(root,'selected.png'))});
    await writeFile(join(root,'other/private.ts'),'secret');await rm(join(root,'src/schema.ts'));await symlink(join(root,'other/private.ts'),join(root,'src/schema.ts'));
    host=await server(root);const state=await(await fetch(host.url+'/__promptframe/local-preview/state')).json();assert.equal(state.usingExample,true);assert(!JSON.stringify(state).includes('secret'));
  }finally{await host?.value.close();await rm(root,{recursive:true,force:true});}
});

test('platform preview reuses scoped CLI credential and checks grant identity, expiry and MIME',async()=>{
  const root=await fixture();try{
    const endpoint='https://example.com/api',config=join(root,'config.json');
    await writeFile(config,JSON.stringify({endpoint,credential:{endpoint,tokenSecret:'fixture-only-token',expiresAt:new Date(Date.now()+60000).toISOString()}}));
    await writeFile(join(root,'.promptframerc'),JSON.stringify({projectId:'project-a',endpoint}));
    const selection={prop:'/illustration',reference:'asset-proxy://asset_example',sessionId:'session-a'},slot={kinds:['image'],sources:['asset'],accept:['image/png'],maxFileBytes:1024};
    let calls=0,grant={reference:selection.reference,status:'ready',url:'https://example.com/read',contentType:'image/png',sizeBytes:png.length,sha256:hash(png),expiresAt:new Date(Date.now()+60000).toISOString()};
    const options={env:{PROMPTFRAME_CONFIG:config},fetch:async(url,init)=>{calls++;assert.equal(url,endpoint+'/cli/component-assets/resolve');assert.equal(init.headers.authorization,'Bearer fixture-only-token');
      assert.deepEqual(JSON.parse(init.body),{projectId:'project-a',sessionId:'session-a',references:[{reference:selection.reference,slot}]});return Response.json({results:[grant]});}};
    assert.equal((await resolvePreviewResourceGrant(root,selection,slot,options)).sha256,hash(png));
    grant={...grant,contentType:'audio/wav'};await assert.rejects(resolvePreviewResourceGrant(root,selection,slot,options),/unavailable/);
    grant={...grant,contentType:'image/png',expiresAt:new Date(0).toISOString()};await assert.rejects(resolvePreviewResourceGrant(root,selection,slot,options),/unavailable/);assert.equal(calls,3);
    await writeFile(config,JSON.stringify({endpoint,credential:{endpoint,tokenSecret:'fixture-only-token',expiresAt:new Date(0).toISOString()}}));
    await assert.rejects(resolvePreviewResourceGrant(root,selection,slot,options),/expired/);assert.equal(calls,3);
  }finally{await rm(root,{recursive:true,force:true});}
});


test('public preview props cannot persist a private asset slot reference',async()=>{
 const root=await fixture();try{
  const path=join(root,'src/preview-props.json'),envelope=JSON.parse(await readFile(path));
  envelope.props.illustration='asset-proxy://asset_private';await writeFile(path,JSON.stringify(envelope));
  await assert.rejects(exec('node',[resolve('dist/index.js'),'validate',root,'--json']),error=>String(error.stderr).includes('component_standard.preview.private_resource_reference'));
 }finally{await rm(root,{recursive:true,force:true});}
});
