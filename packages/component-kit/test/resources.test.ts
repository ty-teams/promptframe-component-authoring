import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION,
  type ComponentRuntimeResourceManifest,
} from '@promptframe/contracts';
import {
  normalizePromptFramePublicResourcePath,
  promptFramePublicResource,
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
