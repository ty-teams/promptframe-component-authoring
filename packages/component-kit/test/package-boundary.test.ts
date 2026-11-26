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
  scripts?: Record<string, string>;
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
    './fonts',
    './layout',
    './model-react',
    './package.json',
    './preview',
    './preview-react',
    './runtime-fonts',
    './standard',
  ]);
  assert.equal(packageJson.sideEffects, false);
  assert.deepEqual(packageJson.files, ['dist', 'README.md', 'fonts']);
});

test('component-kit records PromptFrame public release provenance metadata', () => {
  assert.equal(packageJson.license, 'MIT AND OFL-1.1');
  assert.equal(packageJson.repository?.type, 'git');
  assert.equal(packageJson.repository?.url, 'git+https://github.com/ty-teams/promptframe-component-authoring.git');
  assert.equal(packageJson.repository?.directory, 'packages/component-kit');
  assert.equal(packageJson.bugs?.url, 'https://github.com/ty-teams/promptframe-component-authoring/issues');
  assert.equal(packageJson.homepage, 'https://github.com/ty-teams/promptframe-component-authoring#readme');
});

test('component-kit keeps Remotion and React as optional peers', () => {
  assert.match(packageJson.peerDependencies?.react ?? '', /^\^19/);
  assert.equal(packageJson.peerDependencies?.remotion, '>=4.0.374 <5');
  assert.equal(packageJson.peerDependenciesMeta?.react?.optional, true);
  assert.equal(packageJson.peerDependenciesMeta?.remotion?.optional, true);
});

test('component-kit publish metadata is open for the confirmed PromptFrame release path', () => {
  assert.equal(packageJson.private, undefined);
  assert.equal(packageJson.publishConfig?.registry, 'https://registry.npmjs.org/');
  assert.equal(packageJson.publishConfig?.access, 'public');
  assert.equal(packageJson.publishConfig?.provenance, true);
});

test('component-kit local scripts build public contracts before importing them', () => {
  assert.match(packageJson.scripts?.test ?? '', /pnpm --filter @promptframe\/contracts build &&/);
  assert.match(packageJson.scripts?.lint ?? '', /pnpm --filter @promptframe\/contracts build &&/);
  assert.match(packageJson.scripts?.build ?? '', /pnpm --filter @promptframe\/contracts build &&/);
});

test('retired author helpers are absent from package and root exports',async()=>{
  assert.equal(packageJson.exports['./style' as keyof typeof packageJson.exports],undefined);
  assert.equal(packageJson.exports['./timing' as keyof typeof packageJson.exports],undefined);
  const root=await import('../src/index.js');
  for(const name of ['resolvePromptFrameStyle','secondsToFrames','createDurationTimeline','getScaledSpringTiming','createRevealPhases','createFillProgress'])assert.equal(name in root,false,name);
  for(const entry of ['style','timing'])await assert.rejects(import(packageJson.name+'/'+entry),{
    code:'ERR_PACKAGE_PATH_NOT_EXPORTED',
  });
});
