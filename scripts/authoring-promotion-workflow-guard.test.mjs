import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateAuthoringPromotionWorkflowContext } from './authoring-promotion-workflow-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const trusted = {
  root,
  eventName: 'workflow_dispatch',
  ref: 'refs/heads/main',
  repository: 'ty-teams/promptframe-component-authoring',
  githubSha: checkoutSha,
  checkoutSha,
  mode: 'dry-run',
  now: new Date('2026-07-11T00:00:00.000Z'),
};

test('workflow guard accepts exact main checkout and dry-run receipt only', async () => {
  const result = await validateAuthoringPromotionWorkflowContext(trusted);
  assert.equal(result.status, 'trusted');
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.sanitized, true);
});

test('workflow guard rejects untrusted event, ref, repository, checkout and mode', async () => {
  const cases = [
    [{ ...trusted, eventName: 'pull_request' }, /promotion_workflow.event_not_trusted/],
    [{ ...trusted, ref: 'refs/heads/feature' }, /promotion_workflow.ref_not_main/],
    [{ ...trusted, repository: 'fork/promptframe-component-authoring' }, /promotion_workflow.repository_not_trusted/],
    [{ ...trusted, githubSha: 'f'.repeat(40) }, /promotion_workflow.checkout_sha_mismatch/],
    [{ ...trusted, mode: 'latest' }, /promotion_receipt.mode_not_allowed/],
  ];
  for (const [input, pattern] of cases) {
    await assert.rejects(validateAuthoringPromotionWorkflowContext(input), pattern);
  }
});

test('promotion workflow keeps the credential path bounded and dependency-free', async () => {
  const workflow = await readFile(path.join(root, '.github', 'workflows', 'promote-authoring-release.yml'), 'utf8');
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(pull_request|push|schedule):/m);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /environment: npm-promotion/);
  assert.match(workflow, /group: promptframe-authoring-promotion/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /node scripts\/authoring-promotion-workflow-guard\.mjs/);
  assert.match(workflow, /node scripts\/authoring-promotion-executor\.mjs/);
  assert.match(workflow, /NPM_DIST_TAG_PROMOTION_TOKEN: \$\{\{/);
  assert.doesNotMatch(workflow, /pnpm install|npm install|yarn install/);

  const credentialStep = workflow.match(/      - name: Execute bounded promotion[\s\S]*?(?=\n      - name:|\s*$)/)?.[0] ?? '';
  assert.ok(credentialStep);
  assert.doesNotMatch(credentialStep, /\buses:/);
  assert.doesNotMatch(credentialStep, /pnpm|npm install|yarn|npx/);
  assert.match(credentialStep, /set -euo pipefail/);
});
