#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function verifyPrCiContract(workflow = readFileSync(path.join(root, '.github/workflows/pr-ci.yml'), 'utf8')) {
  const findings = [];
  for (const marker of [
    'pull_request:',
    'permissions:\n  contents: read',
    'pnpm install --frozen-lockfile',
    'pnpm lint:public',
    'pnpm -r lint',
    'pnpm -r test',
    'pnpm -r build',
    'pnpm -r pack:dry-run',
    'pnpm test:release',
  ]) if (!workflow.includes(marker)) findings.push(`workflow_marker_missing:${marker}`);
  if (/^\s*(?:push|workflow_dispatch):/mu.test(workflow)) findings.push('workflow_non_pr_trigger_forbidden');
  if (/\b(?:id-token|packages|actions):\s*write\b/u.test(workflow)) findings.push('workflow_write_permission_forbidden');
  if (/npm\s+publish|pnpm\s+publish|docker|gh\s+release|environment:|(?:NPM|GH)_[A-Z0-9_]+/u.test(workflow)) {
    findings.push('workflow_publish_or_runtime_path_forbidden');
  }
  for (const match of workflow.matchAll(/uses:\s*[^\s@]+@([^\s#]+)/gu)) {
    if (!/^[0-9a-f]{40}$/u.test(match[1])) findings.push(`workflow_action_not_sha:${match[1]}`);
  }
  return {
    schemaVersion: 'promptframe-authoring-pr-ci-verification/v1',
    runtimeArtifactCount: 0,
    valid: findings.length === 0,
    findings,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = verifyPrCiContract();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}
