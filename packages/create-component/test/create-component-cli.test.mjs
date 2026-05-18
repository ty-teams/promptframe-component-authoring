import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(packageRoot, 'dist/index.js');

test('create CLI honors explicit component name independently of target directory', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-create-name-'));
  const target = path.join(dir, 'workspace-output');
  try {
    await execFileAsync('node', [
      cliPath,
      target,
      '--name',
      'sales-funnel-pulse',
      '--display-name',
      'Sales Funnel Pulse',
      '--description',
      'Sales funnel component',
    ]);

    const manifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'));
    const packageJson = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(manifest.name, 'sales-funnel-pulse');
    assert.equal(manifest.displayName, 'Sales Funnel Pulse');
    assert.equal(manifest.description, 'Sales funnel component');
    assert.equal(packageJson.name, 'sales-funnel-pulse');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('create CLI force overwrites template files in a non-empty target', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-create-force-'));
  const target = path.join(dir, 'component-output');
  try {
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'README.md'), 'stale readme\n');

    await execFileAsync('node', [
      cliPath,
      target,
      '--name',
      'forced-component',
      '--force',
    ]);

    const manifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'));
    const readme = await readFile(path.join(target, 'README.md'), 'utf8');
    assert.equal(manifest.name, 'forced-component');
    assert.doesNotMatch(readme, /stale readme/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
