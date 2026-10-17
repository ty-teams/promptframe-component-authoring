import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DevelopmentContents } from '../dist/development-revisions.js';
import { captureDevelopmentFiles } from '../dist/development-files.js';
import { validateDevelopmentContents } from '../dist/development-validation.js';
import { buildDevelopmentContents } from '../dist/development-build.js';
import { developmentFixture, developmentLimits } from './fixtures/development-component.mjs';

const javascript = built => built.artifacts.readFiles().filter(file => file.path.endsWith('.mjs'))
  .map(file => Buffer.from(file.bytes).toString()).join('\n');

test('public capture keeps the canonical resource artifact path and exact captured bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-build-public-resource-'));
  try {
    const paths = await developmentFixture(root), svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>';
    await mkdir(join(root, 'public')); await writeFile(join(root, 'public/mark.svg'), svg); paths.push('public/mark.svg');
    const captured = captureDevelopmentFiles(root, paths, developmentLimits);
    await validateDevelopmentContents(captured);
    const built = await buildDevelopmentContents(captured), files = built.artifacts.readFiles();
    assert.equal(Buffer.from(files.find(file => file.path === 'resources/public/mark.svg').bytes).toString(), svg);
    assert.equal(files.some(file => file.path === 'resources/mark.svg'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real Vite builds exactly the common-checked capture, without live files/config/scripts, and produces stable independent ESM bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-captured-build-test-'));
  try {
    const temporary = join(root, 'temporary'); await mkdir(temporary);
    const paths = await developmentFixture(join(root, 'source'), 'first-checked-章节😀');
    await writeFile(join(root, 'source/src/index.ts'), 'export { default } from "./Component"; export { PropsSchema } from "./schema";\n'
      + 'export { createPromptFrameLayout } from "@promptframe/component-kit/layout";\n'
      + 'export { secondsToFrames } from "@promptframe/component-kit/timing";');
    await writeFile(join(root, 'source/vite.config.ts'), 'throw new Error("workspace config must never execute");');
    paths.push('vite.config.ts');
    const capture = captureDevelopmentFiles(join(root, 'source'), paths, developmentLimits);
    assert.equal((await validateDevelopmentContents(capture, { temporaryParent: temporary })).sourceRevision, capture.revision);
    await writeFile(join(root, 'source/src/shared.ts'), 'export const title = "later-unchecked-source";');
    const built = await buildDevelopmentContents(capture, { temporaryParent: temporary });
    assert.equal(built.sourceRevision, capture.revision);
    assert.match(javascript(built), /first-checked-章节/);
    assert.doesNotMatch(javascript(built), /later-unchecked-source/);
    assert.ok(built.runtimeImports.includes('react/jsx-runtime'));
    assert.ok(built.runtimeImports.includes('remotion'));
    assert.ok(built.runtimeImports.includes('zod'));
    assert.ok(built.runtimeImports.includes('@promptframe/component-kit/layout'));
    assert.ok(built.runtimeImports.includes('@promptframe/component-kit/timing'));
    assert.deepEqual(built.entries, { component: 'component.mjs', schema: 'schema.mjs', index: 'index.mjs' });
    assert.equal((await buildDevelopmentContents(capture, { temporaryParent: temporary })).artifacts.revision, built.artifacts.revision);
    const outputCopy = built.artifacts.readFiles(); outputCopy[0].bytes.fill(0);
    assert.match(javascript(built), /first-checked-章节/);
    assert.deepEqual(await readdir(temporary), []);
    await assert.rejects(access(join(root, 'config-was-executed')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('uncaptured relative imports and unsupported npm/CSS/discovery cannot open ambient paths or acquire a bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-build-closed-graph-'));
  try {
    const paths = await developmentFixture(root);
    await writeFile(join(root, 'src/ambient.ts'), 'export default "not captured";');
    const original = captureDevelopmentFiles(root, paths, developmentLimits);
    for (const [statement, diagnostic] of [
      ['import "./ambient";', 'development.build.uncaptured_import'],
      ['import "non-shared-package";', 'development.build.unsupported_dependency'],
      ['import "../../ambient";', 'development.build.uncaptured_import'],
      ['import.meta.glob("**/*.ts");', 'development.build.import_meta_unsupported'],
      ['import(globalThis.location.hash);', 'development.build.dynamic_import_unsupported'],
      ['import "./style.css";', 'development.build.unsupported_source_type'],
    ]) {
      const files = original.readFiles();
      const component = files.find(file => file.path === 'src/Component.tsx');
      component.bytes = Buffer.concat([component.bytes, Buffer.from('\n' + statement)]);
      files.push({ path: 'src/style.css', bytes: Buffer.from('body { color: red; }') });
      await assert.rejects(buildDevelopmentContents(new DevelopmentContents(files, developmentLimits)), error => {
        assert.equal(error.code, 'development.build.rejected'); assert.equal(error.diagnosticCode, diagnostic); return true;
      });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('compiler timeout/abort wait for child close and retire their own temporary root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-build-retire-'));
  try {
    const temporary = join(root, 'temporary'); await mkdir(temporary);
    const paths = await developmentFixture(join(root, 'source'));
    const capture = captureDevelopmentFiles(join(root, 'source'), paths, developmentLimits);
    await assert.rejects(buildDevelopmentContents(capture, { temporaryParent: temporary, timeoutMs: 1 }),
      error => error.code === 'development.build.timeout');
    assert.deepEqual(await readdir(temporary), []);
    const controller = new AbortController(), cause = new Error('original abort');
    const timer = setTimeout(() => controller.abort(cause), 25);
    try { await assert.rejects(buildDevelopmentContents(capture, { temporaryParent: temporary, signal: controller.signal }), error => error === cause); }
    finally { clearTimeout(timer); }
    assert.deepEqual(await readdir(temporary), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
