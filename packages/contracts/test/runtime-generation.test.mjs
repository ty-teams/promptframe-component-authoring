import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {componentManifestSchema, PROMPTFRAME_COMPONENT_RUNTIME_GENERATION, resolveComponentRuntimeGeneration} from '../dist/index.js';

test('generated manifest declares the supported runtime while historical omission is unchanged', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../create-component/templates/react-remotion/manifest.json', import.meta.url), 'utf8'));
  manifest.id = '@test/runtime-fixture'; manifest.name = 'runtime-fixture';
  manifest.displayName = 'Runtime fixture'; manifest.description = 'Runtime generation compatibility fixture';
  const current = componentManifestSchema.parse(manifest);
  assert.equal(resolveComponentRuntimeGeneration(current.runtimeGeneration), PROMPTFRAME_COMPONENT_RUNTIME_GENERATION);
  const pkg = JSON.parse(await readFile(new URL('../../create-component/templates/react-remotion/package.json', import.meta.url), 'utf8'));
  for (const [name, version] of [['react', PROMPTFRAME_COMPONENT_RUNTIME_GENERATION.react],
    ['react-dom', PROMPTFRAME_COMPONENT_RUNTIME_GENERATION.reactDom], ['remotion', PROMPTFRAME_COMPONENT_RUNTIME_GENERATION.remotion],
    ['@promptframe/component-kit', PROMPTFRAME_COMPONENT_RUNTIME_GENERATION.componentKit]]) assert.equal(pkg.dependencies[name], version);
  assert.equal(pkg.devDependencies['@remotion/player'], PROMPTFRAME_COMPONENT_RUNTIME_GENERATION.remotion);
  delete manifest.runtimeGeneration;
  const legacy = componentManifestSchema.parse(manifest);
  assert.equal(Object.hasOwn(legacy, 'runtimeGeneration'), false);
  assert.equal(resolveComponentRuntimeGeneration(legacy.runtimeGeneration), PROMPTFRAME_COMPONENT_RUNTIME_GENERATION);
});

test('unknown generations cannot silently use the current component host', () => {
  assert.throws(() => resolveComponentRuntimeGeneration('runtime-2099.01'));
  assert.throws(() => resolveComponentRuntimeGeneration(''));
});
