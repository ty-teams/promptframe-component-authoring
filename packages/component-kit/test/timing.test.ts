import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  COMPONENT_STANDARD_SOURCE_HASH,
  COMPONENT_STANDARD_VERSION,
  createDurationTimeline,
  createFillProgress,
  createRevealPhases,
  getComponentStandardStamp,
  getScaledSpringTiming,
  secondsToFrames,
} from '../src/index.js';

test('component-kit exposes the platform standard stamp', () => {
  const stamp = getComponentStandardStamp();
  assert.equal(stamp.sourceVersion, COMPONENT_STANDARD_VERSION);
  assert.equal(stamp.sourceHash, COMPONENT_STANDARD_SOURCE_HASH);
  assert.match(stamp.sourceHash, /^sha256:[a-f0-9]{64}$/);
});

test('component-kit standard stamp is sourced from public contracts', async () => {
  const source = await readFile(new URL('../src/standard.ts', import.meta.url), 'utf-8');
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf-8'),
  ) as { dependencies?: Record<string, string> };

  assert.match(source, /from '@promptframe\/contracts'/);
  assert.equal(packageJson.dependencies?.['@promptframe/contracts'], '0.1.27');
  assert.doesNotMatch(source, /component-standard\.v0\.1\.0/);
  assert.doesNotMatch(source, /component-manifest\.v0\.1\.0/);
  assert.doesNotMatch(source, /sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52/);
});

test('createDurationTimeline compresses short durations and holds long durations', () => {
  const compressed = createDurationTimeline({ actualDuration: 60, designedDuration: 120 });
  assert.equal(compressed.scale, 0.5);
  assert.equal(compressed.at(20), 10);
  assert.equal(compressed.holdFrames, 0);

  const held = createDurationTimeline({ actualDuration: 180, designedDuration: 120 });
  assert.equal(held.scale, 1);
  assert.equal(held.actionDuration, 120);
  assert.equal(held.holdFrames, 60);
});

test('getScaledSpringTiming prepares Remotion spring inputs without importing renderer', () => {
  const timeline = createDurationTimeline({ actualDuration: 60, designedDuration: 120 });
  const timing = getScaledSpringTiming(20, 30, 10, timeline);
  assert.equal(timing.frame, 15);
  assert.equal(timing.fps, 60);
});

test('secondsToFrames keeps wall-clock animation timing stable across fps variants', () => {
  assert.equal(secondsToFrames(1.5, 30), 45);
  assert.equal(secondsToFrames(1.5, 60), 90);
  assert.equal(secondsToFrames(0, 60), 0);
  assert.throws(() => secondsToFrames(-1, 30), /seconds must be a non-negative finite number/);
  assert.throws(() => secondsToFrames(1, 29.97), /fps must be a positive integer/);
});

test('createRevealPhases expresses entrance timing through design seconds and timeline compression', () => {
  const timeline = createDurationTimeline({ actualDuration: 60, designedDuration: 120 });
  const phases = createRevealPhases({
    fps: 30,
    timeline,
    enterSeconds: 0.5,
    revealSeconds: 1.5,
    exitSeconds: 3,
  });

  assert.deepEqual(phases.enterRange, [0, 8]);
  assert.deepEqual(phases.revealRange, [8, 23]);
  assert.deepEqual(phases.exitRange, [45, 60]);
  assert.equal(phases.holdFrames, 0);
  assert.equal(phases.progressAt(0), 0);
  assert.equal(phases.progressAt(23), 1);
  assert.equal(phases.progressAt(60), 1);
});

test('createFillProgress maps an exposure window to clamped progress', () => {
  const progress = createFillProgress({
    durationFrames: 120,
    startPercent: 0.25,
    endPercent: 0.75,
  });

  assert.equal(progress.startFrame, 30);
  assert.equal(progress.endFrame, 90);
  assert.equal(progress.at(0), 0);
  assert.equal(progress.at(60), 0.5);
  assert.equal(progress.at(120), 1);
  assert.throws(() => createFillProgress({ durationFrames: 120, startPercent: 0.8, endPercent: 0.2 }), /endPercent must be greater/);
});
