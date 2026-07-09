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
  promptFramePublicResourceSlotFromSchema,
  promptFrameRuntimeResourceMatchesSlot,
} from '../src/resources.js';

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
