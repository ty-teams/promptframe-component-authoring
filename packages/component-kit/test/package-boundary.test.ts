import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8')) as {
  name: string;
  private?: boolean;
  files?: string[];
  sideEffects?: boolean;
  exports?: Record<string, unknown>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  publishConfig?: Record<string, unknown>;
  license?: string;
  repository?: {
    type?: string;
    url?: string;
    directory?: string;
  };
  bugs?: {
    url?: string;
  };
  homepage?: string;
};

test('component-kit exposes only public authoring entrypoints', () => {
  assert.equal(packageJson.name, '@promptframe/component-kit');
  assert.deepEqual(Object.keys(packageJson.exports ?? {}).sort(), [
    '.',
    './package.json',
    './preview',
    './standard',
    './timing',
  ]);
  assert.equal(packageJson.sideEffects, false);
  assert.deepEqual(packageJson.files, ['dist', 'README.md']);
});

test('component-kit records PromptFrame public release provenance metadata', () => {
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.repository?.type, 'git');
  assert.equal(packageJson.repository?.url, 'git+https://github.com/ty-teams/promptframe-component-authoring.git');
  assert.equal(packageJson.repository?.directory, 'packages/component-kit');
  assert.equal(packageJson.bugs?.url, 'https://github.com/ty-teams/promptframe-component-authoring/issues');
  assert.equal(packageJson.homepage, 'https://github.com/ty-teams/promptframe-component-authoring#readme');
});

test('component-kit keeps Remotion and React as optional peers', () => {
  assert.match(packageJson.peerDependencies?.react ?? '', /^\^19/);
  assert.match(packageJson.peerDependencies?.remotion ?? '', /^\^4/);
  assert.equal(packageJson.peerDependenciesMeta?.react?.optional, true);
  assert.equal(packageJson.peerDependenciesMeta?.remotion?.optional, true);
});

test('component-kit publish metadata is open for the confirmed PromptFrame release path', () => {
  assert.equal(packageJson.private, undefined);
  assert.equal(packageJson.publishConfig?.registry, 'https://registry.npmjs.org/');
  assert.equal(packageJson.publishConfig?.access, 'public');
  assert.equal(packageJson.publishConfig?.provenance, true);
});
