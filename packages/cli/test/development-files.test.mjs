import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { captureDevelopmentFiles } from '../dist/development-files.js';
import { DevelopmentContents, DevelopmentRevisionGate } from '../dist/development-revisions.js';

const limits = { maximumFiles: 16, maximumBytes: 16 * 1024 };
const fixture = fn => {
  const dir = mkdtempSync(join(tmpdir(), 'promptframe-development-files-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const put = (root, path, text) => {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, text);
};

test('three actual module inputs share declared dependency bytes but retain independent revisions', () => fixture(root => {
  put(root, 'shared/color.ts', 'export const color="red";');
  for (const id of ['intro', 'chart', 'outro']) put(root, `${id}/Component.tsx`, `export default "${id}";`);
  const capture = id => captureDevelopmentFiles(root, [`${id}/Component.tsx`, 'shared/color.ts'], limits);
  const before = ['intro', 'chart', 'outro'].map(capture);
  assert.equal(new Set(before.map(x => x.revision)).size, 3);
  assert.deepEqual(before[0].readFiles().map(x => x.path), ['intro/Component.tsx', 'shared/color.ts']);
  put(root, 'shared/color.ts', 'export const color="blue";');
  const after = ['intro', 'chart', 'outro'].map(capture);
  after.forEach((x, i) => assert.notEqual(x.revision, before[i].revision));
  assert.equal(before[0].readFiles()[1].bytes.toString(), 'export const color="red";');
}));

test('physical recapture before publish rejects a missed final dependency write', () => fixture(root => {
  put(root, 'src/Component.tsx', 'export default 1;');
  put(root, 'shared.ts', 'export const n=1;');
  const read = () => captureDevelopmentFiles(root, ['src/Component.tsx', 'shared.ts'], limits);
  const gate = new DevelopmentRevisionGate({ checkerKey: 'actual-source-checker/v1', maximumModules: 3 });
  const original = read(), check = gate.begin('intro', original);
  // No watcher notification is emitted. Publication must reread actual inputs.
  put(root, 'shared.ts', 'export const n=2;');
  const artifacts = new DevelopmentContents([{ path: 'bundle.mjs', bytes: Buffer.from('checked old') }], limits);
  assert.equal(gate.publish(check, read(), artifacts), false);
  assert.equal(gate.state('intro').sourceRevision, read().revision);
  assert.equal(gate.state('intro').lastChecked, undefined);
}));

test('same content and path order preserve the digest, independently of file timestamps', () => fixture(root => {
  put(root, 'a.ts', 'export const a=1;'); put(root, 'b.ts', 'export const b=2;');
  const before = captureDevelopmentFiles(root, ['a.ts', 'b.ts'], limits);
  put(root, 'a.ts', 'export const a=1;');
  const after = captureDevelopmentFiles(root, ['b.ts', 'a.ts'], limits);
  assert.equal(after.revision, before.revision);
  after.readFiles()[0].bytes.fill(0);
  assert.equal(before.readFiles()[0].bytes.toString(), 'export const a=1;');
}));

test('capture bounds every file and aggregate bytes and rejects undeclared path escape before reading', () => fixture(root => {
  put(root, 'a.ts', '12345678'); put(root, 'b.ts', '12345678');
  assert.throws(() => captureDevelopmentFiles(root, ['a.ts'], { ...limits, maximumBytes: 7 }), /byte_limit/);
  assert.throws(() => captureDevelopmentFiles(root, ['a.ts', 'b.ts'], { ...limits, maximumBytes: 15 }), /byte_limit/);
  assert.equal(captureDevelopmentFiles(root, ['a.ts', 'b.ts'], { ...limits, maximumBytes: 16 }).byteLength, 16);
  for (const path of ['../secret', '/absolute', 'a/../a.ts', 'a\\b.ts']) {
    assert.throws(() => captureDevelopmentFiles(root, [path], limits), /invalid_path/);
  }
  assert.throws(() => captureDevelopmentFiles(root, ['a.ts', 'a.ts'], limits), /invalid_path/);
}));

test('source and directory symlinks are refused rather than exported through a workspace capture', () => fixture(root => {
  put(root, 'inside/a.ts', 'inside');
  symlinkSync(join(root, 'inside/a.ts'), join(root, 'link.ts'));
  symlinkSync(join(root, 'inside'), join(root, 'linked-dir'), 'dir');
  assert.throws(() => captureDevelopmentFiles(root, ['link.ts'], limits), /symlink/);
  assert.throws(() => captureDevelopmentFiles(root, ['linked-dir/a.ts'], limits), /symlink/);
  assert.throws(() => captureDevelopmentFiles(root, ['inside'], limits), /not_file/);
}));

test('a FIFO cannot block the source capture waiting for a writer', { skip: process.platform === 'win32' }, () => fixture(root => {
  const made = spawnSync('mkfifo', [join(root, 'source.ts')], { timeout: 3000 });
  assert.equal(made.status, 0);
  const module = new URL('../dist/development-files.js', import.meta.url).href;
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import assert from 'node:assert/strict';import {captureDevelopmentFiles} from ${JSON.stringify(module)};
     assert.throws(()=>captureDevelopmentFiles(${JSON.stringify(root)},['source.ts'],${JSON.stringify(limits)}),/not_file/);`],
    { timeout: 3000 });
  assert.equal(probe.error, undefined);
  assert.equal(probe.status, 0, probe.stderr.toString());
}));
