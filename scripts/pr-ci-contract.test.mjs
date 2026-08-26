import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyPrCiContract } from './pr-ci-contract.mjs';

test('checked-in Authoring PR CI remains read-only and npm-only', () => {
  const report = verifyPrCiContract();
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.runtimeArtifactCount, 0);
});

test('tag-based action, Docker and publish authority fail closed', () => {
  const report = verifyPrCiContract('on:\n  pull_request:\npermissions:\n  contents: read\nsteps:\n  - uses: actions/checkout@v6\n  - run: pnpm install --frozen-lockfile && pnpm lint:public && pnpm -r lint && pnpm -r test && pnpm -r build && pnpm -r pack:dry-run && pnpm test:release && npm publish && docker build .\n');
  assert.ok(report.findings.some((entry) => entry.startsWith('workflow_action_not_sha:')));
  assert.ok(report.findings.includes('workflow_publish_or_runtime_path_forbidden'));
});
