import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePromptFrameSecurityPolicySource } from '@promptframe/contracts/security-evaluator';
import { DevelopmentContents, DevelopmentRevisionGate } from '../dist/development-revisions.js';

const limits = { maximumFiles: 8, maximumBytes: 1024 * 1024 };
const capture = files => new DevelopmentContents(files, limits);
const text = value => capture([{ path: 'Component.tsx', bytes: Buffer.from(value) }]);
const registry = maximumModules => new DevelopmentRevisionGate({
  checkerKey: 'test-common-policy-and-build-v1', maximumModules: maximumModules ?? 4,
});
const artifact = value => capture([{ path: 'index.mjs', bytes: Buffer.from(value) }]);

test('capture owns exact binary/Unicode bytes and ignores caller and checker copy mutation', () => {
  const bytes = Buffer.from('章节\0😀');
  const original = Buffer.from(bytes);
  const input = [{ path: 'source/章节.tsx', bytes }, { path: 'assets/data.bin', bytes: Uint8Array.of(0, 255) }];
  const saved = capture(input);
  bytes.fill(1); input[0].path = 'changed.tsx'; input.pop();
  const first = saved.readFiles();
  assert.deepEqual(first.find(x => x.path === 'source/章节.tsx').bytes, original);
  first[0].bytes.fill(9); first.reverse();
  assert.equal(saved.revision, capture([
    { path: 'source/章节.tsx', bytes: original },
    { path: 'assets/data.bin', bytes: Uint8Array.of(0, 255) },
  ]).revision);
  assert.deepEqual(saved.readFiles()[0].bytes, Buffer.from([0, 255]));
  assert.throws(() => { saved.revision = 'forged'; }, TypeError);
});

test('missed final filesystem notification cannot publish old checked bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-development-revision-'));
  const component = join(root, 'Component.tsx');
  const helper = join(root, 'colors.ts');
  const read = async () => capture([
    { path: 'Component.tsx', bytes: await readFile(component) },
    { path: 'shared/colors.ts', bytes: await readFile(helper) },
  ]);
  try {
    await writeFile(component, 'export default () => "旧画面";');
    await writeFile(helper, 'export const color = "red";');
    const gate = registry(), before = await read(), old = gate.begin('Intro', before);
    let release;
    const checked = new Promise(resolve => { release = resolve; });
    const compiler = (async () => { await checked; return artifact('export default "old";'); })();
    // No watcher notification is sent to the gate for this final write.
    await writeFile(component, 'export default () => "最后画面😀";');
    release();
    assert.equal(gate.publish(old, await read(), await compiler), false);
    assert.equal(gate.state('Intro').status, 'checking');
    assert.equal(gate.state('Intro').lastChecked, undefined);
    const final = await read(), next = gate.begin('Intro', final);
    const source = Buffer.from(final.readFiles()[0].bytes).toString();
    const scan = evaluatePromptFrameSecurityPolicySource({ file: 'Component.tsx', source });
    assert.equal(scan.findings.filter(x => x.action !== 'warn').length, 0);
    assert.equal(gate.publish(next, await read(), artifact('export default "last";')), true);
    assert.equal(gate.state('Intro').lastChecked.sourceRevision, final.revision);
    assert.equal(gate.reject(old, before, 'late error'), false);
    assert.equal(gate.state('Intro').status, 'checked');
    // Shared dependency bytes are part of the same revision, not only the entry.
    await writeFile(helper, 'export const color = "blue";');
    assert.notEqual((await read()).revision, final.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('out-of-order completion and failure stay in their module and source revision', () => {
  const gate = registry(), a = text('A'), b = text('B'), chart = text('chart');
  const first = gate.begin('Intro', a);
  assert(gate.publish(first, a, artifact('passed A')));
  const slow = gate.begin('Intro', b), independent = gate.begin('Chart', chart);
  assert(gate.publish(independent, chart, artifact('chart')));
  const latest = gate.begin('Intro', text('C'));
  assert.equal(gate.publish(slow, b, artifact('stale B')), false);
  assert(gate.reject(latest, text('C'), 'component.check.syntax_error'));
  assert.equal(gate.state('Intro').status, 'failed');
  assert.equal(gate.state('Intro').sourceRevision, text('C').revision);
  assert.equal(gate.state('Intro').lastChecked.sourceRevision, a.revision);
  assert.equal(gate.state('Chart').status, 'checked');
});

test('actual common security rejection keeps previous checked bytes explicit', () => {
  const gate = registry(), safe = text('export default 1;');
  assert(gate.publish(gate.begin('Intro', safe), safe, artifact('safe')));
  const unsafe = text('export default localStorage.getItem("private");');
  const check = gate.begin('Intro', unsafe);
  const source = Buffer.from(unsafe.readFiles()[0].bytes).toString();
  const scan = evaluatePromptFrameSecurityPolicySource({ file: 'Component.tsx', source });
  const blocking = scan.findings.find(x => x.action !== 'warn');
  assert(blocking);
  assert(gate.reject(check, unsafe, blocking.ruleId));
  const state = gate.state('Intro');
  assert.equal(state.status, 'failed');
  assert.equal(state.sourceRevision, unsafe.revision);
  assert.equal(state.lastChecked.sourceRevision, safe.revision);
  assert.notEqual(state.sourceRevision, state.lastChecked.sourceRevision);
});

test('tokens cannot be replayed, forged, borrowed from another gate or resurrect removed modules', () => {
  const gate = registry(), source = text('A'), check = gate.begin('Intro', source);
  assert.equal(gate.publish({ ...check }, source, artifact('forged')), false);
  assert.equal(registry().publish(check, source, artifact('foreign')), false);
  assert(gate.publish(check, source, artifact('A')));
  assert.equal(gate.publish(check, source, artifact('B')), false);
  assert.equal(gate.reject(check, source, 'late error'), false);
  const pending = gate.begin('Intro', source);
  gate.remove('Intro');
  const recreated = gate.begin('Intro', source);
  assert.equal(gate.publish(pending, source, artifact('old connection')), false);
  assert(gate.publish(recreated, source, artifact('new connection')));
});

test('file/path/byte and module bounds reject before accepting a candidate', () => {
  for (const path of ['../x', '/x', 'a/../b', './a', 'a//b', 'a\\b', 'a\0b']) {
    assert.throws(() => capture([{ path, bytes: Buffer.from('x') }]), /invalid_path/);
  }
  assert.throws(() => capture([{ path: 'a', bytes: Buffer.from('1') },
    { path: 'a', bytes: Buffer.from('2') }]), /invalid_path/);
  assert.throws(() => new DevelopmentContents([{ path: 'a', bytes: Buffer.from('12') }],
    { maximumFiles: 1, maximumBytes: 1 }), /byte_limit/);
  assert.throws(() => new DevelopmentContents([], limits), /file_count/);
  const gate = registry(1), source = text('a');
  gate.begin('A', source);
  assert.throws(() => gate.begin('B', source), /module_limit/);
  gate.remove('A');
  assert(gate.begin('B', source));
});
