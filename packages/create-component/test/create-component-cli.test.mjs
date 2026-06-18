import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('create CLI scaffolds an advanced workspace with one component', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-create-workspace-'));
  const target = path.join(dir, 'component-workspace');
  try {
    await execFileAsync('node', [
      cliPath,
      target,
      '--workspace',
      '--component',
      'image-particle-remotion',
      '--display-name',
      'Image Particle Remotion',
      '--description',
      'Image particle workspace fixture',
    ]);

    const workspace = JSON.parse(await readFile(path.join(target, 'promptframe-workspace.json'), 'utf8'));
    assert.equal(workspace.schemaVersion, 'promptframe-workspace.v0.1.0');
    assert.deepEqual(workspace.components, [{
      id: '@marketplace/image-particle-remotion',
      path: 'components/image-particle-remotion',
    }]);

    const rootPackage = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(rootPackage.private, true);
    assert.equal(rootPackage.packageManager, 'pnpm@10.0.0');
    assert.equal(rootPackage.devDependencies?.['@promptframe/cli'], '^0.1.38');
    assert.equal(rootPackage.scripts.check, 'promptframe workspace validate . && promptframe check . --workspace-component @marketplace/image-particle-remotion');
    assert.equal(rootPackage.scripts.upload, 'promptframe upload . --workspace-component @marketplace/image-particle-remotion');
    assert.equal(rootPackage.scripts['setup-ci'], 'promptframe setup-ci . --provider github --workspace');

    const pnpmWorkspace = await readFile(path.join(target, 'pnpm-workspace.yaml'), 'utf8');
    assert.match(pnpmWorkspace, /components\/\*/);
    assert.match(pnpmWorkspace, /packages\/\*/);

    const manifest = JSON.parse(await readFile(path.join(target, 'components/image-particle-remotion/manifest.json'), 'utf8'));
    assert.equal(manifest.id, '@marketplace/image-particle-remotion');
    assert.equal(manifest.name, 'image-particle-remotion');
    assert.equal(manifest.displayName, 'Image Particle Remotion');
    assert.equal(manifest.description, 'Image particle workspace fixture');
    assert.equal(await fileExists(path.join(target, 'components/image-particle-remotion/.github/workflows/promptframe-component.yml')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('create CLI appends workspace components without overwriting root state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-create-workspace-append-'));
  const target = path.join(dir, 'component-workspace');
  try {
    await execFileAsync('node', [
      cliPath,
      target,
      '--workspace',
      '--component',
      'text-reveal-motion',
      '--display-name',
      'Text Reveal Motion',
      '--description',
      'Text reveal fixture',
    ]);

    const packagePath = path.join(target, 'package.json');
    const rootPackage = JSON.parse(await readFile(packagePath, 'utf8'));
    rootPackage.scripts.custom = 'echo keep-me';
    rootPackage.devDependencies['left-alone'] = '1.0.0';
    await writeFile(packagePath, `${JSON.stringify(rootPackage, null, 2)}\n`, 'utf8');

    await execFileAsync('node', [
      cliPath,
      target,
      '--workspace',
      '--component',
      'media-rich-showcase',
      '--display-name',
      'Media Rich Showcase',
      '--description',
      'Media rich fixture',
    ]);

    const workspace = JSON.parse(await readFile(path.join(target, 'promptframe-workspace.json'), 'utf8'));
    assert.deepEqual(workspace.components, [
      {
        id: '@marketplace/text-reveal-motion',
        path: 'components/text-reveal-motion',
      },
      {
        id: '@marketplace/media-rich-showcase',
        path: 'components/media-rich-showcase',
      },
    ]);

    const nextPackage = JSON.parse(await readFile(packagePath, 'utf8'));
    assert.equal(nextPackage.scripts.check, 'promptframe workspace validate . && promptframe check . --workspace-component @marketplace/text-reveal-motion');
    assert.equal(nextPackage.scripts.upload, 'promptframe upload . --workspace-component @marketplace/text-reveal-motion');
    assert.equal(nextPackage.scripts.custom, 'echo keep-me');
    assert.equal(nextPackage.devDependencies['left-alone'], '1.0.0');
    assert.equal(nextPackage.devDependencies['@promptframe/cli'], '^0.1.38');

    assert.equal(await fileExists(path.join(target, 'components/text-reveal-motion/.github/workflows/promptframe-component.yml')), false);
    assert.equal(await fileExists(path.join(target, 'components/media-rich-showcase/.github/workflows/promptframe-component.yml')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function fileExists(pathname) {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}
