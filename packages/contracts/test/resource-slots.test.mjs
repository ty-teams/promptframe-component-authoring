import assert from 'node:assert/strict';
import test from 'node:test';
import { collectPromptFrameResourceReferences, parsePromptFrameAssetReference,
  ComponentResourceReferenceError, promptFrameResourceSchema } from '../dist/index.js';

const slot = { type: 'string', promptFrameResource: { kinds: ['image'], sources: ['public', 'asset'] } };
test('resource selection traverses exact declared nested and array fields without interpreting text as authority', () => {
  const schema = { type: 'object', properties: { illustration: slot,
    gallery: { type: 'array', items: { type: 'object', properties: { picture: slot } } }, title: { type: 'string' } } };
  const props = { illustration: '/example.png', gallery: [{ picture: 'asset-proxy://asset_example?variant=original' }],
    title: 'asset-proxy://asset_not_selected' };
  const refs = collectPromptFrameResourceReferences(schema, props);
  assert.equal(refs.length, 2); assert.deepEqual(refs[1].path, ['gallery', 0, 'picture']);
  assert.deepEqual(refs[1].asset, { assetId: 'asset_example', variant: 'original' });
  assert.deepEqual(props.gallery[0], { picture: 'asset-proxy://asset_example?variant=original' });
});

test('resource reference parsing refuses URLs, credentials, paths and extra or encoded parameters', () => {
  for (const ref of ['https://objects.example/a', 'asset-proxy://author@asset_example',
    'asset-proxy://asset_example/path', 'asset-proxy://asset_example?token=secret',
    'asset-proxy://asset_example?variant=original&variant=other', 'asset-proxy://asset_example?variant=%2Fetc',
    '/api/assets/proxy/asset_example']) assert.equal(parsePromptFrameAssetReference(ref), undefined, ref);
  assert.deepEqual(parsePromptFrameAssetReference('asset-proxy://asset-example'), { assetId: 'asset-example' });
});

test('new slot sources and budgets are enforced while old public metadata remains compatible', () => {
  for (const ref of ['https://objects.example/a', '//objects.example/a', '../secret', '/api/assets/proxy/asset_example'])
    assert.throws(() => collectPromptFrameResourceReferences(slot, ref), ComponentResourceReferenceError);
  assert.throws(() => collectPromptFrameResourceReferences({ ...slot,
    promptFrameResource: { kinds: ['image'], sources: ['public'] } }, 'asset-proxy://asset_example'), /source_not_allowed/);
  assert.throws(() => collectPromptFrameResourceReferences({ type: 'array', items: slot }, Array(65).fill('/example.png')), /budget_exceeded/);
  assert.deepEqual(collectPromptFrameResourceReferences({ promptFrameResource: { accept: ['image/*'] } }, '/example.png'), []);
  assert.throws(() => promptFrameResourceSchema({ kinds: ['image'], sources: ['asset', 'asset'] }));
});
