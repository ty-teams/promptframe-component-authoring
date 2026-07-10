import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AuthoringPromotionExecutionError,
  createNpmTagMutator,
  executeAuthoringPromotion,
} from './authoring-promotion-executor.mjs';
import {
  computeAuthoringPromotionReceiptDigest,
  parseAuthoringPromotionReceipt,
} from './authoring-promotion-receipt.mjs';

const now = new Date('2026-07-11T00:00:00.000Z');

test('dry-run verifies the exact cohort without mutating tags', async () => {
  const fixture = createFixture();
  const result = await executeAuthoringPromotion({
    receipt: fixture.receipt,
    mode: 'dry-run',
    registry: fixture.registry,
    now: () => now,
  });

  assert.equal(result.status, 'verified_dry_run');
  assert.equal(result.actions.length, 8);
  assert.equal(fixture.mutations.length, 0);
  assert.equal(result.sanitized, true);
});

test('latest mode converges next/latest in fixed order', async () => {
  const fixture = createFixture({ mode: 'latest' });
  const result = await executeAuthoringPromotion({
    receipt: fixture.receipt,
    mode: 'latest',
    registry: fixture.registry,
    mutator: fixture.mutator,
    now: () => now,
  });

  assert.equal(result.status, 'promoted');
  assert.deepEqual(
    fixture.mutations.map((entry) => `${entry.kind}:${entry.name}:${entry.tag}`),
    [
      'add:@promptframe/contracts:latest',
      'add:@promptframe/component-kit:next',
      'add:@promptframe/cli:latest',
      'add:create-promptframe-component:latest',
    ],
  );
  for (const packageReceipt of fixture.receipt.packages) {
    const state = fixture.state.get(packageReceipt.name);
    assert.equal(state.distTags.next, packageReceipt.version);
    assert.equal(state.distTags.latest, packageReceipt.version);
  }
});

test('partial latest failure compensates every prior mutation in reverse order', async () => {
  const fixture = createFixture({ mode: 'latest', failAtMutation: 3 });
  await assert.rejects(
    executeAuthoringPromotion({
      receipt: fixture.receipt,
      mode: 'latest',
      registry: fixture.registry,
      mutator: fixture.mutator,
      now: () => now,
    }),
    (error) => {
      assert.ok(error instanceof AuthoringPromotionExecutionError);
      assert.equal(error.code, 'promotion_execution.failed_compensated');
      assert.equal(error.receipt.status, 'failed_compensated');
      assert.deepEqual(
        error.receipt.compensation.map((entry) => `${entry.packageName}:${entry.tag}:${entry.status}`),
        [
          '@promptframe/component-kit:next:compensated',
          '@promptframe/contracts:latest:compensated',
        ],
      );
      return true;
    },
  );
  assert.equal(fixture.state.get('@promptframe/contracts').distTags.latest, '0.1.23');
  assert.equal(fixture.state.get('@promptframe/component-kit').distTags.next, undefined);
});

test('compensation failure stays fail closed and never reports promoted', async () => {
  const fixture = createFixture({ mode: 'latest', failAtMutation: 3, failCompensation: true });
  await assert.rejects(
    executeAuthoringPromotion({
      receipt: fixture.receipt,
      mode: 'latest',
      registry: fixture.registry,
      mutator: fixture.mutator,
      now: () => now,
    }),
    (error) => {
      assert.equal(error.code, 'promotion_execution.compensation_failed');
      assert.equal(error.receipt.status, 'compensation_failed');
      assert.ok(error.receipt.compensation.some((entry) => entry.status === 'compensation_failed'));
      return true;
    },
  );
});

test('proof mode creates, verifies and removes only the receipt-bound disposable tag', async () => {
  const fixture = createFixture({ mode: 'proof' });
  const result = await executeAuthoringPromotion({
    receipt: fixture.receipt,
    mode: 'proof',
    registry: fixture.registry,
    mutator: fixture.mutator,
    now: () => now,
  });

  assert.equal(result.status, 'proof_verified');
  assert.deepEqual(
    fixture.mutations.map((entry) => `${entry.kind}:${entry.name}:${entry.tag}`),
    [
      'add:@promptframe/contracts:promotion-proof-fixture-001',
      'remove:@promptframe/contracts:promotion-proof-fixture-001',
    ],
  );
  assert.equal(
    fixture.state.get('@promptframe/contracts').distTags['promotion-proof-fixture-001'],
    undefined,
  );
});

test('npm mutator contains the credential in a mode-0600 temp npmrc and removes it', async () => {
  const credentialFixture = 'npm_fixture_value_that_must_not_escape';
  let observedConfig = '';
  let observedMode = null;
  const calls = [];
  const mutator = await createNpmTagMutator({
    token: credentialFixture,
    runnerTemp: os.tmpdir(),
    baseEnv: {
      SAFE_FIXTURE: 'present',
      NPM_DIST_TAG_PROMOTION_TOKEN: credentialFixture,
    },
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, configPath: options.env.NPM_CONFIG_USERCONFIG });
      observedConfig = await readFile(options.env.NPM_CONFIG_USERCONFIG, 'utf8');
      observedMode = (await stat(options.env.NPM_CONFIG_USERCONFIG)).mode & 0o777;
      assert.equal(options.env.SAFE_FIXTURE, 'present');
      assert.equal(options.env.NPM_DIST_TAG_PROMOTION_TOKEN, undefined);
      return { stdout: '', stderr: '' };
    },
  });
  const npmrcPath = mutator.npmrcPath;

  await mutator.addTag('@promptframe/contracts', '0.1.25', 'promotion-proof-fixture-002');
  assert.equal(calls[0].command, 'npm');
  assert.deepEqual(calls[0].args.slice(0, 2), ['dist-tag', 'add']);
  assert.equal(observedMode, 0o600);
  assert.match(observedConfig, /_authToken=/);
  assert.ok(observedConfig.includes(credentialFixture));
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(credentialFixture));

  await mutator.close();
  await assert.rejects(access(npmrcPath));
});

function createFixture(options = {}) {
  const packages = [
    packageReceipt('@promptframe/contracts', '0.1.25', 'contracts'),
    packageReceipt('@promptframe/component-kit', '0.1.19', 'kit'),
    packageReceipt('@promptframe/cli', '0.1.57', 'cli'),
    packageReceipt('create-promptframe-component', '0.1.47', 'create'),
  ];
  const source = {
    schemaVersion: 'promptframe-authoring-promotion-receipt/v1',
    operationId: 'authoring-release-fixture',
    receiptState: 'candidate_verified',
    createdAt: '2026-07-10T00:00:00.000Z',
    expiresAt: '2026-08-10T00:00:00.000Z',
    publicSourceCommit: 'a'.repeat(40),
    releaseId: 'authoring-release-fixture',
    releaseDigest: `sha256:${'b'.repeat(64)}`,
    scaffoldDigest: `sha256:${'c'.repeat(64)}`,
    platformGateDigest: `sha256:${'d'.repeat(64)}`,
    registry: 'https://registry.npmjs.org/',
    allowedModes: ['dry-run'],
    packages,
    proof: null,
    proofReceiptDigest: null,
    receiptDigest: '',
  };
  if (options.mode === 'latest') {
    source.receiptState = 'promotion_ready';
    source.allowedModes = ['dry-run', 'latest'];
    source.proofReceiptDigest = `sha256:${'e'.repeat(64)}`;
  }
  if (options.mode === 'proof') {
    source.receiptState = 'credential_proof_ready';
    source.allowedModes = ['dry-run', 'proof'];
    source.proof = {
      packageName: packages[0].name,
      version: packages[0].version,
      integrity: packages[0].integrity,
      tag: 'promotion-proof-fixture-001',
    };
  }
  source.receiptDigest = computeAuthoringPromotionReceiptDigest(source);
  const receipt = parseAuthoringPromotionReceipt(source, { now });
  const state = new Map(packages.map((entry, index) => [
    entry.name,
    registryStateForPackage(entry, index),
  ]));
  const mutations = [];
  let mutationAttempt = 0;
  let compensationStarted = false;
  const mutator = {
    async addTag(name, version, tag) {
      mutationAttempt += 1;
      if (options.failAtMutation === mutationAttempt) {
        compensationStarted = true;
        throw new Error('fixture_mutation_failed');
      }
      if (compensationStarted && options.failCompensation) throw new Error('fixture_compensation_failed');
      mutations.push({ kind: 'add', name, version, tag });
      state.get(name).distTags[tag] = version;
    },
    async removeTag(name, tag) {
      if (compensationStarted && options.failCompensation) throw new Error('fixture_compensation_failed');
      mutations.push({ kind: 'remove', name, tag });
      delete state.get(name).distTags[tag];
    },
  };
  const registry = {
    async readPackage(name) {
      return structuredClone(state.get(name));
    },
  };
  return { receipt, state, mutations, mutator, registry };
}

function packageReceipt(name, version, marker) {
  return {
    name,
    version,
    integrity: `sha512-${Buffer.from(`${marker}-integrity`).toString('base64')}`,
  };
}

function previousVersion(index) {
  return ['0.1.23', '0.1.19', '0.1.55', '0.1.45'][index];
}

function registryStateForPackage(entry, index) {
  const previous = previousVersion(index);
  return {
    distTags: {
      ...(index !== 1 ? { next: entry.version } : {}),
      latest: previous,
    },
    versions: {
      [entry.version]: { dist: { integrity: entry.integrity } },
      ...(previous === entry.version
        ? {}
        : {
            [previous]: {
              dist: { integrity: `sha512-${Buffer.from(`old-${index}`).toString('base64')}` },
            },
          }),
    },
  };
}
