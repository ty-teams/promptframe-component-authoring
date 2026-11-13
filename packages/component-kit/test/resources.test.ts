import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION,
  type ComponentRuntimeResourceManifest,
} from '@promptframe/contracts';
import {
  filterPromptFramePublicResourcesForSlot,
  normalizePromptFramePublicResourcePath,
  promptFramePublicResource,
  promptFrameResource,
  PromptFrameResourceError,
  promptFramePublicResourceSlotFromSchema,
  promptFrameRuntimeResourceMatchesSlot,
} from '../src/resources.js';

test('one resource helper presents package resources and host-resolved preview and render representations', () => {
  const props = { illustration: '/example.png' };
  assert.equal(promptFrameResource(props, props.illustration), '/example.png');
  assert.equal(promptFrameResource({ promptFrameResources: resources }, '/logo.png'), resources.entries[0]!.url);
  assert.equal(promptFrameResource(undefined, '/public/render-assets/image.png'), '/public/render-assets/image.png');
  assert.equal(promptFrameResource(undefined, 'blob:https://studio.example/123'), 'blob:https://studio.example/123');
  assert.equal(promptFrameResource(undefined, 'https://objects.example/image?grant=opaque'), 'https://objects.example/image?grant=opaque');
  assert.equal(promptFrameResource({ promptFrameResources: resources }, undefined, '/logo.png'), resources.entries[0]!.url);
});

test('the original opaque-frame Blob representation remains presentation only', () => {
  const original='blob:null/40e8a2c0-cd51-4bda-8f0c-67d411cb1cef';
  assert.equal(promptFrameResource({},original),original);
  for(const invalid of ['blob:null/guess','blob:null/../private','blob:null/40e8a2c0-cd51-4bda-8f0c-67d411cb1cef?other=1'])
    assert.throws(()=>promptFrameResource({},invalid),PromptFrameResourceError);
});

test('unresolved references never silently substitute an example or perform resolution in the component', () => {
  for (const ref of ['asset-proxy://asset_example', '/api/assets/proxy/asset_example?variant=original']) {
    assert.throws(() => promptFrameResource(undefined, ref, '/example.png'),
      (error: unknown) => error instanceof PromptFrameResourceError && error.code === 'resource.reference_unresolved');
  }
  for (const ref of ['file:///private/file.png', 'javascript:alert(1)', '//objects.example/a', '../secret', 'blob:opaque', ' /image.png']) {
    assert.throws(() => promptFrameResource(undefined, ref), PromptFrameResourceError);
  }
  assert.throws(() => promptFrameResource(undefined, '/image.png', 'https://arbitrary.example/a'), PromptFrameResourceError);
});

const resources: ComponentRuntimeResourceManifest = {
  contractVersion: COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION,
  entries: [
    {
      publicPath: '/logo.png',
      sourcePath: 'public/logo.png',
      artifactPath: 'resources/public/logo.png',
      kind: 'image',
      contentType: 'image/png',
      sizeBytes: 12,
      sha256: `sha256:${'a'.repeat(64)}`,
      url: 'https://preview.example/resources/logo.png?token=signed',
    },
    {
      publicPath: '/voice.mp3',
      sourcePath: 'public/voice.mp3',
      artifactPath: 'resources/public/voice.mp3',
      kind: 'audio',
      contentType: 'audio/mpeg',
      sizeBytes: 32,
      sha256: `sha256:${'b'.repeat(64)}`,
      url: 'https://preview.example/resources/voice.mp3?token=signed',
    },
    {
      publicPath: '/data.csv',
      sourcePath: 'public/data.csv',
      artifactPath: 'resources/public/data.csv',
      kind: 'text',
      contentType: 'text/csv',
      sizeBytes: 2048,
      sha256: `sha256:${'c'.repeat(64)}`,
      url: 'https://preview.example/resources/data.csv?token=signed',
    },
  ],
};

test('promptFramePublicResource resolves injected runtime resources from props', () => {
  assert.equal(
    promptFramePublicResource({ promptFrameResources: resources }, 'logo.png'),
    'https://preview.example/resources/logo.png?token=signed',
  );
  assert.equal(
    promptFramePublicResource(resources, '/logo.png'),
    'https://preview.example/resources/logo.png?token=signed',
  );
});

test('promptFramePublicResource falls back cleanly during local authoring', () => {
  assert.equal(promptFramePublicResource(undefined, 'logo.png'), '/logo.png');
  assert.equal(promptFramePublicResource(undefined, '/missing.png', '/fallback.png'), '/fallback.png');
});

test('promptFramePublicResource rejects traversal, URLs and unsupported path shapes', () => {
  for (const unsafePath of ['../secret.png', 'https://example.com/logo.png', '//cdn/logo.png', 'icons\\logo.png', ' logo.png']) {
    assert.equal(promptFramePublicResource(resources, unsafePath, '/fallback.png'), '/fallback.png');
    assert.equal(normalizePromptFramePublicResourcePath(unsafePath), undefined);
  }
});

test('promptFrame public resource slots parse schema metadata and match candidates by MIME, kind and size', () => {
  const imageSlot = promptFramePublicResourceSlotFromSchema({
    type: 'string',
    promptFrameResource: {
      accept: ['image/*'],
      maxFileBytes: 1024,
    },
  });
  const dataSlot = promptFramePublicResourceSlotFromSchema({
    type: 'string',
    xPromptFrameResource: {
      kinds: ['text', 'json'],
      accept: ['text/csv', 'application/json'],
      maxFileBytes: 4096,
    },
  });

  assert.deepEqual(imageSlot, { accept: ['image/*'], maxFileBytes: 1024 });
  assert.deepEqual(dataSlot, {
    kinds: ['text', 'json'],
    accept: ['text/csv', 'application/json'],
    maxFileBytes: 4096,
  });
  assert.equal(promptFrameRuntimeResourceMatchesSlot(resources.entries[0], imageSlot), true);
  assert.equal(promptFrameRuntimeResourceMatchesSlot(resources.entries[1], imageSlot), false);
  assert.equal(promptFrameRuntimeResourceMatchesSlot(resources.entries[2], dataSlot), true);
  assert.deepEqual(
    filterPromptFramePublicResourcesForSlot(resources, imageSlot).map((entry) => entry.publicPath),
    ['/logo.png'],
  );
  assert.deepEqual(
    filterPromptFramePublicResourcesForSlot(resources, dataSlot).map((entry) => entry.publicPath),
    ['/data.csv'],
  );
});
