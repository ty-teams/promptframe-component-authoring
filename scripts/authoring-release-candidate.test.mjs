import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAuthoringCandidateArtifacts } from './authoring-release-candidate.mjs';
import { expectedArtifactName } from './authoring-release-receipt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCommit = 'c'.repeat(40);
const now = new Date('2026-07-11T00:00:00.000Z');

test('candidate builder packs the exact cohort without lifecycle scripts or inherited credentials', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'authoring-candidate-builder-'));
  const outputDir = path.join(tempRoot, 'output');
  const calls = [];
  try {
    const manifest = await buildAuthoringCandidateArtifacts({
      root,
      outputDir,
      sourceCommit,
      headCommit: sourceCommit,
      repositoryClean: true,
      artifactTag: 'authoring-candidate-2026-07-10.5-r1',
      createdAt: '2026-07-10T12:00:00.000Z',
      now,
      baseEnv: {
        HOME: '/tmp/fixture-home',
        PATH: process.env.PATH,
        PRIVATE_FIXTURE: 'must-not-propagate',
      },
      execFileImpl: async (command, args, options) => {
        const packageJson = JSON.parse(await readFile(path.join(options.cwd, 'package.json'), 'utf8'));
        const filename = expectedArtifactName(packageJson.name, packageJson.version);
        await writeFile(path.join(outputDir, filename), Buffer.from(`${packageJson.name}:packed`));
        calls.push({ command, args, options, packageJson });
        return { stdout: JSON.stringify([{ name: packageJson.name, version: packageJson.version, filename }]) };
      },
    });

    assert.equal(manifest.packages.length, 4);
    assert.equal(calls.length, 4);
    for (const call of calls) {
      assert.equal(call.command, 'npm');
      assert.deepEqual(call.args.slice(0, 3), ['pack', '--json', '--ignore-scripts']);
      assert.equal(call.options.env.PRIVATE_FIXTURE, undefined);
      assert.equal(call.options.env.NPM_CONFIG_IGNORE_SCRIPTS, 'true');
    }
    assert.equal(JSON.parse(await readFile(path.join(outputDir, 'candidate-manifest.json'), 'utf8')).manifestDigest, manifest.manifestDigest);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('candidate builder fails closed and removes partial output', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'authoring-candidate-builder-fail-'));
  const outputDir = path.join(tempRoot, 'output');
  try {
    await assert.rejects(
      buildAuthoringCandidateArtifacts({
        root,
        outputDir,
        sourceCommit,
        headCommit: sourceCommit,
        repositoryClean: true,
        artifactTag: 'authoring-candidate-2026-07-10.5-r1',
        now,
        execFileImpl: async () => ({
          stdout: JSON.stringify([{ name: '@promptframe/wrong', version: '9.9.9', filename: 'wrong.tgz' }]),
        }),
      }),
      /pack_cohort_mismatch/,
    );
    await assert.rejects(access(outputDir));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('candidate workflow is tag-bound, no-clobber and contains no npm publish path', async () => {
  const workflow = await readFile(path.join(root, '.github', 'workflows', 'build-authoring-candidate.yml'), 'utf8');
  assert.match(workflow, /^on:\n  push:\n    tags:\n      - 'authoring-candidate-\*'/m);
  assert.match(workflow, /permissions:\n  contents: write/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /group: promptframe-authoring-candidate-/);
  assert.match(workflow, /node scripts\/authoring-release-candidate\.mjs/);
  assert.match(workflow, /gh release view/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--verify-tag/);
  assert.doesNotMatch(workflow, /\$\{\{ runner\.temp \}\}/);
  assert.doesNotMatch(workflow, /npm publish|npm dist-tag|workflow_dispatch|pull_request/);
});
