import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  computeAuthoringReleaseAuthorizationDigest,
  createAuthoringCandidateManifest,
  expectedArtifactName,
  parseAuthoringReleaseAuthorization,
  readAuthoringReleaseIntent,
} from './authoring-release-receipt.mjs';
import {
  createNpmOidcPublisher,
  executeAuthoringPackagePublish,
} from './authoring-release-publish.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date('2026-07-11T00:00:00.000Z');

test('package publisher waits for dependencies and publishes the exact tarball through OIDC', async () => {
  const fixture = await createFixture();
  const calls = [];
  const registry = createRegistry(fixture.candidate, ['contracts']);
  const result = await executeAuthoringPackagePublish({
    ...fixture,
    packageKey: 'componentKit',
    registry,
    maxDependencyAttempts: 2,
    dependencyDelayMs: 0,
    sleep: async () => {},
    publisher: {
      async publish(entry) {
        calls.push(entry.name);
        registry.complete('componentKit');
      },
    },
  });

  assert.equal(result.status, 'published');
  assert.deepEqual(calls, ['@promptframe/component-kit']);
  assert.equal(result.sanitized, true);
});

test('package publisher is idempotent only for exact integrity plus latest', async () => {
  const fixture = await createFixture();
  const complete = createRegistry(fixture.candidate, ['contracts', 'componentKit', 'cli']);
  let publishes = 0;
  const result = await executeAuthoringPackagePublish({
    ...fixture,
    packageKey: 'cli',
    registry: complete,
    publisher: { async publish() { publishes += 1; } },
  });
  assert.equal(result.status, 'already_published');
  assert.equal(publishes, 0);

  const partial = createRegistry(fixture.candidate, ['contracts', 'componentKit']);
  partial.publishedWithoutLatest('cli');
  await assert.rejects(
    executeAuthoringPackagePublish({
      ...fixture,
      packageKey: 'cli',
      registry: partial,
      publisher: { async publish() { publishes += 1; } },
    }),
    /existing_version_not_complete/,
  );
});

test('package publisher fails closed when dependencies or readback are incomplete', async () => {
  const fixture = await createFixture();
  const missing = createRegistry(fixture.candidate, []);
  await assert.rejects(
    executeAuthoringPackagePublish({
      ...fixture,
      packageKey: 'createComponent',
      registry: missing,
      maxDependencyAttempts: 1,
      publisher: { async publish() {} },
    }),
    /dependency_not_complete/,
  );

  const readback = createRegistry(fixture.candidate, ['contracts', 'componentKit', 'cli']);
  await assert.rejects(
    executeAuthoringPackagePublish({
      ...fixture,
      packageKey: 'createComponent',
      registry: readback,
      maxReadbackAttempts: 1,
      publisher: { async publish() {} },
    }),
    /publish_readback_mismatch/,
  );
});

test('package publisher polls bounded registry propagation after publish', async () => {
  const fixture = await createFixture();
  const registry = createRegistry(fixture.candidate, []);
  let published = false;
  let postPublishReads = 0;
  let sleeps = 0;
  const delayedRegistry = {
    async readPackage(name) {
      if (!published) return registry.readPackage(name);
      postPublishReads += 1;
      if (postPublishReads < 3) return null;
      registry.complete('contracts');
      return registry.readPackage(name);
    },
  };
  const result = await executeAuthoringPackagePublish({
    ...fixture,
    packageKey: 'contracts',
    registry: delayedRegistry,
    maxReadbackAttempts: 3,
    readbackDelayMs: 0,
    sleep: async () => { sleeps += 1; },
    publisher: { async publish() { published = true; } },
  });

  assert.equal(result.status, 'published');
  assert.equal(postPublishReads, 3);
  assert.equal(sleeps, 2);
});

test('OIDC publisher refuses long-lived credentials and uses a bounded npm publish command', async () => {
  assert.throws(
    () => createNpmOidcPublisher({
      artifactRoot: '/tmp/authoring-release-fixture',
      baseEnv: { NODE_AUTH_TOKEN: 'fixture-value' },
    }),
    /long_lived_credential_present/,
  );

  const calls = [];
  const publisher = createNpmOidcPublisher({
    artifactRoot: '/tmp/authoring-release-fixture',
    baseEnv: {
      PATH: process.env.PATH,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://actions.example.invalid/oidc',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'ephemeral-fixture',
    },
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: args[0] === '--version' ? '11.5.1\n' : '', stderr: '' };
    },
  });
  await publisher.publish({
    artifactName: 'promptframe-contracts-0.1.28.tgz',
  });
  assert.deepEqual(calls[0].args, ['--version']);
  assert.equal(calls[1].command, 'npm');
  assert.deepEqual(calls[1].args.slice(0, 4), [
    'publish',
    '/tmp/authoring-release-fixture/promptframe-contracts-0.1.28.tgz',
    '--tag',
    'latest',
  ]);
  assert.equal(calls[1].options.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'ephemeral-fixture');
  assert.equal(calls[1].options.env.NPM_CONFIG_PROVENANCE, 'true');
});

test('existing Trusted Publisher workflows keep filenames and publish one shared release cohort', async () => {
  const workflows = [
    ['publish-contracts.yml', 'contracts'],
    ['publish-component-kit.yml', 'componentKit'],
    ['publish-cli.yml', 'cli'],
    ['publish-create-component.yml', 'createComponent'],
  ];
  for (const [filename, packageKey] of workflows) {
    const text = await readFile(path.join(root, '.github', 'workflows', filename), 'utf8');
    assert.match(text, /- 'authoring-release-\*'/, filename);
    assert.match(text, /id-token: write/, filename);
    assert.match(text, /environment: npm-production/, filename);
    assert.match(text, new RegExp(`PROMPTFRAME_AUTHORING_RELEASE_PACKAGE_KEY: ${packageKey}`), filename);
    assert.match(text, /gh release download/, filename);
    assert.match(text, /node scripts\/authoring-release-publish\.mjs/, filename);
    assert.doesNotMatch(text, /registry-url:/, filename);
    assert.doesNotMatch(text, /\$\{\{ runner\.temp \}\}/, filename);
    assert.doesNotMatch(text, /npm publish|npm dist-tag|pnpm install|npm install|workflow_dispatch/, filename);
  }
});

async function createFixture() {
  const intent = await readAuthoringReleaseIntent(undefined, { root, now });
  const candidate = createAuthoringCandidateManifest({
    intent,
    sourceCommit: 'f'.repeat(40),
    artifacts: intent.packages.map((entry) => ({
      ...entry,
      artifactName: expectedArtifactName(entry.name, entry.version),
      bytes: Buffer.from(`${entry.name}:publish-fixture`),
    })),
    createdAt: '2026-07-10T12:00:00.000Z',
    now,
  });
  const source = {
    schemaVersion: 'promptframe-authoring-release-authorization/v1',
    state: 'publish_ready',
    releaseId: candidate.releaseId,
    releaseTag: candidate.releaseId,
    artifactTag: candidate.artifactTag,
    sourceCommit: candidate.sourceCommit,
    candidateManifestDigest: candidate.manifestDigest,
    platformGateDigest: `sha256:${'a'.repeat(64)}`,
    releaseDigest: candidate.releaseDigest,
    createdAt: '2026-07-10T13:00:00.000Z',
    expiresAt: '2026-08-09T13:00:00.000Z',
    packages: candidate.packages.map(({ name, version, integrity }) => ({ name, version, integrity })),
    authorizationDigest: '',
  };
  source.authorizationDigest = computeAuthoringReleaseAuthorizationDigest(source);
  return {
    candidate,
    authorization: parseAuthoringReleaseAuthorization(source, { now }),
  };
}

function createRegistry(candidate, completedKeys) {
  const states = new Map();
  for (const key of completedKeys) complete(key);
  return {
    async readPackage(name) {
      return structuredClone(states.get(name) ?? null);
    },
    complete,
    publishedWithoutLatest(key) {
      const index = keyIndex(key);
      const entry = candidate.packages[index];
      states.set(entry.name, metadata(entry, false));
    },
  };

  function complete(key) {
    const index = keyIndex(key);
    const entry = candidate.packages[index];
    states.set(entry.name, metadata(entry, true));
  }

  function keyIndex(key) {
    const index = ['contracts', 'componentKit', 'cli', 'createComponent'].indexOf(key);
    assert.notEqual(index, -1);
    return index;
  }
}

function metadata(entry, latest) {
  return {
    distTags: latest ? { latest: entry.version } : { latest: '0.0.1' },
    versions: {
      [entry.version]: { dist: { integrity: entry.integrity } },
    },
  };
}
