import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertSelfContainedGlb, createPromptFrameModelReader, readPromptFrameModelResponse, promptFrameResourceSchema } from '../dist/index.js';

function glb(extra = {}, binary = Buffer.alloc(4)) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: binary.length }], ...extra }));
  const text = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + text.length + binary.length, 8); header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const chunk = Buffer.alloc(8); chunk.writeUInt32LE(binary.length); chunk.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, text, chunk, binary]);
}
const digest = async bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const error = code => value => value.code === code;

test('model slots accept public and authorized asset selections; GLB validates exact header and bounds', () => {
  assert.equal(promptFrameResourceSchema({ kinds: ['model'] }).parse('/model.glb'), '/model.glb');
  assert.doesNotThrow(() => assertSelfContainedGlb(glb({ bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }] })));
  const broken = glb(); broken.writeUInt32LE(broken.length - 4, 8);
  assert.throws(() => assertSelfContainedGlb(broken), error('model.invalid_glb'));
  assert.throws(() => assertSelfContainedGlb(glb({ bufferViews: [{ buffer: 0, byteOffset: 1, byteLength: 4 }] })), error('model.invalid_glb'));
  assert.throws(() => assertSelfContainedGlb(glb(), 4), error('model.size_exceeded'));
});

test('external, data and nested extension URIs and separate decoders cannot obtain IO', () => {
  for (const uri of ['https://example.invalid/model.bin', '../secret.bin', 'data:application/octet-stream;base64,AAAA']) {
    assert.throws(() => assertSelfContainedGlb(glb({ buffers: [{ byteLength: 4, uri }] })), error('model.external_resource_rejected'));
    assert.throws(() => assertSelfContainedGlb(glb({ extensions: { nested: { uri } } })), error('model.external_resource_rejected'));
  }
  assert.throws(() => assertSelfContainedGlb(glb({ extensionsUsed: ['KHR_draco_mesh_compression'] })), error('model.decoder_unsupported'));
  assert.throws(() => assertSelfContainedGlb(glb({ images: [{ bufferView: 1, mimeType: 'image/png' }] })), error('model.invalid_glb'));
  assert.throws(() => assertSelfContainedGlb(glb({ nodes: [{ children: [1] }, { children: [0] }] })), error('model.invalid_glb'));
  assert.throws(() => assertSelfContainedGlb(glb({ accessors: [{ count: 1_000_000_000 }] })), error('model.invalid_glb'));
});

test('bounded HTTP consumer cancels rejected or oversized bodies and rejects truncation', async () => {
  const signal = new AbortController().signal;
  let cancelled = 0;
  const response = (body, status = 200) => new Response(new ReadableStream({
    start(controller) { controller.enqueue(body); }, cancel() { cancelled++; },
  }), { status, headers: { 'content-type': 'model/gltf-binary' } });
  await assert.rejects(readPromptFrameModelResponse(response(new Uint8Array(12), 403), 8, signal), error('model.reference_unavailable'));
  await assert.rejects(readPromptFrameModelResponse(response(new Uint8Array(12)), 8, signal), error('model.size_exceeded'));
  assert.equal(cancelled, 2);
  await assert.rejects(readPromptFrameModelResponse(new Response(new Uint8Array(4)), 8, signal), error('model.identity_mismatch'));
});

test('host model reader binds exact references, bytes and SHA, and closes permanently', async () => {
  const bytes = glb(); let reads = 0;
  const binding = createPromptFrameModelReader({ entries: [{ reference: '/model.glb', url: 'blob:owned',
    contentType: 'model/gltf-binary', sha256: await digest(bytes), sizeBytes: bytes.length }],
    read: async () => { reads++; return bytes; }, digest });
  await assert.rejects(binding.read('https://example.invalid/other'), error('model.reference_unavailable'));
  assert.equal(reads, 0);
  const result = new Uint8Array(await binding.read('/model.glb'));
  assert.equal(result.byteLength, bytes.byteLength, 'pooled Buffer storage outside the verified GLB is not returned');
  result[0] = 0; assert.equal(bytes[0], 0x67);
  assert.equal(reads, 1);
  binding.dispose(); await assert.rejects(binding.read('blob:owned'), error('model.read_cancelled'));
  assert.equal(reads, 1);
});

test('wrong SHA, expired grants and late bytes after cancellation never reach loader', async () => {
  const bytes = glb(); let reads = 0;
  const entry = { reference: 'asset-proxy://asset_model', url: 'blob:owned', contentType: 'model/gltf-binary',
    sha256: 'sha256:' + '0'.repeat(64), sizeBytes: bytes.length };
  const wrong = createPromptFrameModelReader({ entries: [entry], read: async () => bytes, digest });
  await assert.rejects(wrong.read(entry.reference), error('model.identity_mismatch')); wrong.dispose();
  const expired = createPromptFrameModelReader({ entries: [{ ...entry, expiresAt: new Date(0).toISOString() }],
    read: async () => { reads++; return bytes; }, digest });
  await assert.rejects(expired.read(entry.reference), error('model.reference_unavailable')); assert.equal(reads, 0); expired.dispose();
  let finish;
  const late = createPromptFrameModelReader({ entries: [{ ...entry, sha256: await digest(bytes) }],
    read: async () => new Promise(resolve => { finish = resolve; }), digest });
  const request = late.read(entry.reference); late.dispose(); finish(bytes);
  await assert.rejects(request, error('model.read_cancelled'));
});

test('a live exact grant renewal crosses the old deadline without another read', async () => {
  const bytes=glb(),now=Date.now,at=now();let clock=at,finish,reads=0;
  let entries=[{reference:'asset-proxy://asset_model',url:'blob:owned',sha256:await digest(bytes),
    contentType:'model/gltf-binary',sizeBytes:bytes.length,expiresAt:new Date(at+1000).toISOString()}];
  const binding=createPromptFrameModelReader({entries:()=>entries,read:async()=>{reads++;return new Promise(resolve=>finish=resolve);},digest});
  try{
    Date.now=()=>clock;
    const pending=binding.read(entries[0].reference);
    entries=[{...entries[0],url:'blob:renewed-same-content',expiresAt:new Date(at+60000).toISOString()}];
    clock=at+2000;finish(bytes);
    assert.deepEqual(new Uint8Array(await pending),new Uint8Array(bytes));assert.equal(reads,1);
  }finally{Date.now=now;binding.dispose();}
});

test('expiry, revoked or changed authority and an explicit cancellation cannot be disguised as renewal', async () => {
  for(const mode of ['expired','revoked','changed-sha','changed-size','changed-type','duplicate','missing-expiry','invalid-expiry','cancelled']){
    const bytes=glb(),now=Date.now,at=now();let clock=at,finish;
    const entry={reference:'asset-proxy://asset_model',url:'blob:owned',sha256:await digest(bytes),
      contentType:'model/gltf-binary',sizeBytes:bytes.length,expiresAt:new Date(at+1000).toISOString()};
    let entries=[entry];const signal=new AbortController();
    const binding=createPromptFrameModelReader({entries:()=>entries,read:async()=>new Promise(resolve=>finish=resolve),digest});
    try{
      Date.now=()=>clock;const pending=binding.read(entry.reference,{signal:signal.signal});clock=at+2000;
      if(mode!=='expired')entries=[{...entry,expiresAt:new Date(at+60000).toISOString()}];
      if(mode==='revoked')entries=[];
      if(mode==='changed-sha')entries[0]={...entries[0],sha256:'sha256:'+'f'.repeat(64)};
      if(mode==='changed-size')entries[0]={...entries[0],sizeBytes:bytes.length+1};
      if(mode==='changed-type')entries[0]={...entries[0],contentType:'application/octet-stream'};
      if(mode==='duplicate')entries.push({...entries[0]});
      if(mode==='missing-expiry')delete entries[0].expiresAt;
      if(mode==='invalid-expiry')entries[0].expiresAt='not-a-date';
      if(mode==='cancelled')signal.abort();
      finish(bytes);await assert.rejects(pending,error('model.read_cancelled'),mode);
    }finally{Date.now=now;binding.dispose();}
  }
});

test('authority expiring or being revoked during SHA verification still prevents a late result', async () => {
  for(const revoke of [false,true]){
    const bytes=glb(),sha=await digest(bytes),now=Date.now,at=now();let clock=at,finishHash;
    let entries=[{reference:'/model.glb',url:'blob:owned',sha256:sha,contentType:'model/gltf-binary',
      sizeBytes:bytes.length,expiresAt:new Date(at+1000).toISOString()}];
    const hashing=new Promise(resolve=>finishHash=resolve);let hashingStarted;
    const started=new Promise(resolve=>hashingStarted=resolve);
    const binding=createPromptFrameModelReader({entries:()=>entries,read:async()=>bytes,
      digest:async()=>{hashingStarted();return hashing;}});
    try{
      Date.now=()=>clock;const pending=binding.read('/model.glb');await started;clock=at+2000;if(revoke)entries=[];
      finishHash(sha);await assert.rejects(pending,error('model.read_cancelled'));
    }finally{Date.now=now;binding.dispose();}
  }
});
