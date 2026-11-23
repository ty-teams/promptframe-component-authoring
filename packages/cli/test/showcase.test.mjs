import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePromptFrameSchemaSource } from '@promptframe/contracts/schema-evaluator';
import { validateSourceShowcase } from '../dist/showcase.js';

const facts = evaluatePromptFrameSchemaSource(`import {z} from 'zod';
 export const propsSchema=z.object({title:z.string().min(1),count:z.number().int().min(1).max(120).default(18),
 color:z.string().nullable().default(null),camera:z.object({distance:z.number().positive(),target:z.array(z.number()).length(3)}).optional(),
 mode:z.enum(['slow','fast']).default('slow')});`);
const preview = { width: 960, height: 540, fps: 30, durationFrames: 120, props: { title: 'Owned example' } };
const fail = (message, code) => { throw Object.assign(new Error(message), { code }); };
async function withSource(source, run) {
  const root = await mkdtemp(join(tmpdir(), 'showcase-contract-cli-'));
  try {
    await mkdir(join(root, 'src'));
    if (source !== undefined) await writeFile(join(root, 'src/showcase.json'), typeof source === 'string' ? source : JSON.stringify(source));
    return await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('default preview and optional overrides use the same parameter contract', async () => {
  assert.equal(facts.status, 'resolved');
  for (const source of [undefined, {}]) await withSource(source, root => {
    const [group] = validateSourceShowcase({ root, preview, facts, fail });
    assert.equal(group.props.count, 18);
    for (const props of [{}, { title: 42 }]) {
      assert.throws(() => validateSourceShowcase({ root, preview: { ...preview, props }, facts, fail }),
        error => error.code === 'component.showcase.props_invalid' && error.message.includes('src/preview-props.json props.title'));
    }
  });
  await withSource({ presets: [{ id: 'fast', label: 'Faster', propsOverride: { count: 12, mode: 'fast' } }] }, root => {
    const result = validateSourceShowcase({ root, preview, facts, fail });
    assert.equal(result.length, 2); assert.equal(result[0].props.count, 18); assert.equal(result[0].props.mode, 'slow');
    assert.equal(result[1].props.count, 12); assert.equal(result[1].props.mode, 'fast');
    assert.equal(result[0].props.color, null); assert.equal('camera' in result[0].props, false);
    assert.deepEqual(result[0].frames, [0, 24, 48, 71, 95, 119]);
  });
});

test('static default errors belong to the declared schema, while preview and preset errors retain their own file',async()=>{
 const facts=evaluatePromptFrameSchemaSource(`import{z}from'zod';export const propsSchema=z.object({imageAspect:z.number().min(.2).max(5).default(16 / 9)});`);
 for(const source of [undefined,{}])await withSource(source,root=>{
  const [group]=validateSourceShowcase({root,preview:{...preview,props:{}},facts,fail});assert.equal(group.props.imageAspect,16/9);
  for(const value of [7,'wide'])assert.throws(()=>validateSourceShowcase({root,preview:{...preview,props:{imageAspect:value}},facts,fail}),
   error=>error.message.includes('src/preview-props.json props.imageAspect'));
  const unresolved=evaluatePromptFrameSchemaSource(`import{z}from'zod';export const propsSchema=z.object({imageAspect:z.number().default(1 / 0)});`);
  assert.throws(()=>validateSourceShowcase({root,preview:{...preview,props:{}},facts:unresolved,schemaPath:'src/parameters.ts',fail}),
   error=>error.message.includes('src/parameters.ts')&&!error.message.includes('src/showcase.json'));
  const invalid=evaluatePromptFrameSchemaSource(`import{z}from'zod';export const propsSchema=z.object({imageAspect:z.number().min(.2).max(5).default(7)});`);
  assert.throws(()=>validateSourceShowcase({root,preview:{...preview,props:{}},facts:invalid,schemaPath:'src/parameters.ts',fail}),
   error=>error.code==='component.showcase.schema_default_invalid'&&error.message.includes('src/parameters.ts imageAspect.default'));
 });
 await withSource({presets:[{id:'bad',label:'Invalid preset',propsOverride:{imageAspect:7}}]},root=>{
  assert.throws(()=>validateSourceShowcase({root,preview:{...preview,props:{}},facts,fail}),
   error=>error.message.includes('src/showcase.json presets.0.propsOverride.imageAspect'));
 });
});
test('nested constraints, enum, required values and unknown fields reject with the exact preset path', async () => {
  for (const [propsOverride, path] of [
    [{ count: 0 }, 'count'], [{ count: 1.5 }, 'count'], [{ mode: 'missing' }, 'mode'], [{ title: '' }, 'title'],
    [{ camera: { distance: 0, target: [0, 0, 0] } }, 'camera.distance'],
    [{ camera: { distance: 1, target: [0] } }, 'camera.target'],
    [{ unknown: 1 }, ''],
  ]) await withSource({ presets: [{ id: 'bad', label: 'Bad', propsOverride }] }, root => {
    assert.throws(() => validateSourceShowcase({ root, preview, facts, fail }), error => error.code === 'component.showcase.props_invalid'
      && error.message.includes('presets.0.propsOverride' + (path ? '.' + path : '')));
  });
});
test('malformed JSON and duplicate or out-of-range frames retain stable contract errors', async () => {
  await withSource('{', root => assert.throws(() => validateSourceShowcase({ root, preview, facts, fail }), error => error.code === 'component.showcase.json_invalid'));
  for (const [frames, code] of [[[0, 10, 20, 30, 50, 120], 'frame_out_of_range'], [[0, 10, 20, 20, 50, 119], 'frames_not_increasing']])
    await withSource({ defaultFrames: frames }, root => assert.throws(() => validateSourceShowcase({ root, preview, facts, fail }), error => error.code === 'component.showcase.' + code));
});
test('a showcase cannot turn package examples into private asset selections', async () => {
  const resourceFacts = evaluatePromptFrameSchemaSource(`import{z}from'zod';import{promptFrameResourceSchema}from'@promptframe/contracts';
    export const propsSchema=z.object({image:promptFrameResourceSchema({kinds:['image'],sources:['public','asset']}).default('/example.png')});`);
  await withSource({ presets: [{ id: 'private', label: 'Private', propsOverride: { image: 'asset-proxy://asset_owned_private' } }] }, root => {
    assert.throws(() => validateSourceShowcase({ root, preview: { ...preview, props: {} }, facts: resourceFacts, fail }), error => error.code === 'component.showcase.private_resource_reference');
  });
});
