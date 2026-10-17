import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DevelopmentModuleCoordinator } from '../dist/development-coordinator.js';
import { captureDevelopmentFiles } from '../dist/development-files.js';
import { buildDevelopmentContents } from '../dist/development-build.js';
import { developmentFixture, developmentLimits } from './fixtures/development-component.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const code = receipt => receipt.artifacts.readFiles().filter(file => file.path.endsWith('.mjs'))
  .map(file => Buffer.from(file.bytes).toString()).join('\n');

test('missed final watcher change during a real build is recaptured, rechecked and rebuilt before atomic adoption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-coordinator-latest-'));
  try {
    const paths = await developmentFixture(root, 'first-pass');
    const capture = () => captureDevelopmentFiles(root, paths, developmentLimits);
    const before = capture(), compiled = deferred(), release = deferred();
    const modules = new DevelopmentModuleCoordinator({ maximumModules: 3, capture,
      build: async (source, options) => {
        const output = await buildDevelopmentContents(source, options);
        if (source.revision === before.revision) { compiled.resolve(); await release.promise; }
        return output;
      },
    });
    const checking = modules.refresh('Intro');
    await Promise.race([compiled.promise, checking.then(() => assert.fail(JSON.stringify(modules.state('Intro'))))]);
    await writeFile(join(root, 'src/shared.ts'), 'export const title = "last-write-without-watch-event";');
    release.resolve();
    assert.equal(await checking, true);
    assert.equal(modules.state('Intro').sourceRevision, capture().revision);
    assert.equal(modules.state('Intro').lastChecked.sourceRevision, capture().revision);
    assert.match(code(modules.buildReceipt('Intro')), /last-write-without-watch-event/);
    assert.doesNotMatch(code(modules.buildReceipt('Intro')), /first-pass/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('latest failed source stays failed with explicit old checked bytes; other modules and real ordinary checks remain independent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-coordinator-failure-'));
  try {
    const paths = await developmentFixture(root, 'known-good');
    const capture = () => captureDevelopmentFiles(root, paths, developmentLimits);
    const modules = new DevelopmentModuleCoordinator({ maximumModules: 3, capture });
    assert.equal(await modules.refresh('Intro'), true);
    assert.equal(await modules.refresh('Chart'), true);
    const previous = modules.state('Intro').lastChecked;
    await writeFile(join(root, 'src/Component.tsx'), await readFile(join(root, 'src/Component.tsx'), 'utf8') + '\nlocalStorage.getItem("private");');
    assert.equal(await modules.refresh('Intro'), false);
    assert.equal(modules.state('Intro').status, 'failed');
    assert.equal(modules.state('Intro').diagnostic, 'storage.browser_storage');
    assert.equal(modules.state('Intro').sourceRevision, capture().revision);
    assert.equal(modules.state('Intro').lastChecked, previous);
    assert.equal(modules.state('Chart').status, 'checked');
    assert.notEqual(modules.state('Intro').sourceRevision, previous.sourceRevision);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a superseded build that ignores abort cannot publish, and missing captures never pretend the last checked source is current', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-coordinator-race-'));
  try {
    const paths = await developmentFixture(root, 'slow-first');
    const capture = () => captureDevelopmentFiles(root, paths, developmentLimits);
    const before = capture(), compiled = deferred(), release = deferred();
    const modules = new DevelopmentModuleCoordinator({ maximumModules: 2, capture,
      build: async (source, options) => {
        const output = await buildDevelopmentContents(source, options);
        if (source.revision === before.revision) { compiled.resolve(); await release.promise; }
        return output;
      },
    });
    const first = modules.refresh('Intro');
    await Promise.race([compiled.promise, first.then(() => assert.fail(JSON.stringify(modules.state('Intro'))))]);
    await writeFile(join(root, 'src/shared.ts'), 'export const title = "newer-accepted";');
    assert.equal(await modules.refresh('Intro'), true);
    const latest = modules.state('Intro').lastChecked;
    release.resolve(); assert.equal(await first, false);
    assert.equal(modules.state('Intro').lastChecked, latest);
    assert.match(code(modules.buildReceipt('Intro')), /newer-accepted/);
    await unlink(join(root, 'src/shared.ts'));
    assert.equal(await modules.refresh('Intro'), false);
    assert.equal(modules.state('Intro').status, 'failed');
    assert.equal(modules.state('Intro').sourceRevision, undefined);
    assert.equal(modules.state('Intro').lastChecked, latest);
    modules.remove('Intro'); assert.equal(modules.state('Intro'), undefined);
    assert.equal(modules.buildReceipt('Intro'), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
