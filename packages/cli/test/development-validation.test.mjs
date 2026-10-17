import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { COMPONENT_STANDARD_SOURCE_HASH } from '@promptframe/contracts';
import { captureDevelopmentFiles } from '../dist/development-files.js';
import { DevelopmentContents } from '../dist/development-revisions.js';
import { validateDevelopmentContents } from '../dist/development-validation.js';

const limits = { maximumFiles: 32, maximumBytes: 1024 * 1024 };

async function fixture(root) {
  const files = {
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
    'package.json': JSON.stringify({ name: 'captured-component', version: '0.1.0', dependencies: {
      '@promptframe/contracts': '^0.1.28', '@promptframe/component-kit': '^0.1.22',
    } }),
    'manifest.json': JSON.stringify({ schemaVersion: 'component-manifest.v0.1.0', standardVersion: 'component-standard.v0.1.0',
      standardSourceHash: COMPONENT_STANDARD_SOURCE_HASH, id: '@demo/captured-component', name: 'captured-component',
      displayName: 'Captured Component', version: '0.1.0', componentType: 'scene_template', author: { id: 'demo', name: 'Demo' },
      description: 'Captured local component.', tags: ['local'], designedDurationRange: { min: 30, max: 120 },
      layout: { contractVersion: 'layout-capability.v0.1.0', layoutMode: 'slot_fill_reflow', recommendedSlot: 'full_screen',
        minReadableSize: { width: 320, height: 180 }, supportedAspectRatios: ['16:9', '9:16', '1:1'],
        layoutAdaptivity: 'responsive', overflowPolicy: 'fit', safeAreaPolicy: 'recommended', confidence: 0.8 },
      entry: { sourcePath: 'src/Component.tsx', componentExport: 'default', propsSchemaPath: 'src/schema.ts',
        sourceHash: `sha256:${'1'.repeat(64)}`, schemaHash: `sha256:${'2'.repeat(64)}` },
      dependencies: {}, peerDependencies: {}, assets: {}, capabilityHints: [], reviewStatus: 'draft', license: 'MIT',
      createdAt: '2026-10-17T00:00:00.000Z' }),
    'src/Component.tsx': `import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
      export default function Component() { useCurrentFrame(); useVideoConfig();
        return <AbsoluteFill style={{width:'100%',height:'100%'}} />; }`,
    'src/schema.ts': 'export const schema = {};',
    'src/index.ts': 'export { default } from "./Component";',
    'src/preview-props.json': JSON.stringify({ durationFrames: 60, fps: 30, width: 1280, height: 720, props: {} }),
  };
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), text);
  }
  return Object.keys(files);
}

test('the real common CLI validates captured bytes, rejects changed unsafe bytes, and retires its input directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-validate-capture-test-'));
  try {
    const parent = join(root, 'temporary'); await mkdir(parent);
    const paths = await fixture(join(root, 'source'));
    const before = captureDevelopmentFiles(join(root, 'source'), paths, limits);
    const component = Buffer.from(before.readFiles().find(file => file.path === 'src/Component.tsx').bytes).toString();
    await writeFile(join(root, 'source/src/Component.tsx'), component + '\nlocalStorage.getItem("private");');
    const receipt = await validateDevelopmentContents(before, { temporaryParent: parent }).catch(error => {
      assert.fail(`${error.code}: ${error.diagnosticCode ?? 'no structured diagnostic'}`);
    });
    assert.equal(receipt.sourceRevision, before.revision);
    assert.equal(receipt.securityEvaluatorMode, 'ast');
    assert.ok(receipt.checkedRuleIds.includes('security.forbidden.browser_apis'));
    assert.throws(() => { receipt.sourceRevision = 'forged'; }, TypeError);
    assert.deepEqual(await readdir(parent), []);
    const changed = captureDevelopmentFiles(join(root, 'source'), paths, limits);
    assert.notEqual(changed.revision, before.revision);
    await assert.rejects(validateDevelopmentContents(changed, { temporaryParent: parent }), error => {
      assert.equal(error.code, 'development.validation.rejected');
      assert.equal(error.diagnosticCode, 'storage.browser_storage'); return true;
    });
    assert.deepEqual(await readdir(parent), []);
    assert.equal((await validateDevelopmentContents(before, { temporaryParent: parent })).sourceRevision, before.revision);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('timeout and prior abort keep their original failure and close the validation reader before directory removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-validate-lifetime-test-'));
  try {
    const parent = join(root, 'temporary'); await mkdir(parent);
    const paths = await fixture(join(root, 'source'));
    const contents = captureDevelopmentFiles(join(root, 'source'), paths, limits);
    await assert.rejects(validateDevelopmentContents(contents, { temporaryParent: parent, timeoutMs: 1 }),
      error => error.code === 'development.validation.timeout');
    assert.deepEqual(await readdir(parent), []);
    const controller = new AbortController(), reason = new Error('original caller stopped'); controller.abort(reason);
    await assert.rejects(validateDevelopmentContents(contents, { temporaryParent: parent, signal: controller.signal }), error => error === reason);
    assert.deepEqual(await readdir(parent), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('inputs ignored by the ordinary package scanner cannot acquire a complete-check receipt', async () => {
  const contents = new DevelopmentContents([{ path: 'node_modules/hidden.ts', bytes: Buffer.from('unsafe()') }], limits);
  await assert.rejects(validateDevelopmentContents(contents), error => error.code === 'development.validation.excluded_input');
});
