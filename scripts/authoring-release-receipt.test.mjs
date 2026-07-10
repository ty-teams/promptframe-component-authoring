import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AUTHORING_RELEASE_PACKAGES,
  computeAuthoringCandidateManifestDigest,
  computeAuthoringReleaseAuthorizationDigest,
  computeAuthoringReleaseIntentDigest,
  createAuthoringCandidateManifest,
  expectedArtifactName,
  parseAuthoringCandidateManifest,
  parseAuthoringReleaseAuthorization,
  parseAuthoringReleaseIntent,
  readAuthoringCandidateManifest,
  readAuthoringReleaseIntent,
  validateCandidateArtifactFiles,
  validateAuthorizationAgainstCandidate,
  validateIntentAgainstRepository,
} from './authoring-release-receipt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date('2026-07-11T00:00:00.000Z');

test('active release intent binds the exact unpublished source cohort', async () => {
  const intent = await readAuthoringReleaseIntent(undefined, { root, now });

  assert.equal(intent.releaseId, 'authoring-release-2026-07-10.3');
  assert.deepEqual(intent.packages.map((entry) => entry.name), AUTHORING_RELEASE_PACKAGES.map((entry) => entry.name));
  assert.equal(await validateIntentAgainstRepository(intent, { root }), true);
});

test('publish authorization binds platform gate and exact candidate receipt', async () => {
  const intent = await readAuthoringReleaseIntent(undefined, { root, now });
  const candidate = createAuthoringCandidateManifest({
    intent,
    sourceCommit: 'd'.repeat(40),
    artifacts: intent.packages.map((entry) => ({
      ...entry,
      artifactName: expectedArtifactName(entry.name, entry.version),
      bytes: Buffer.from(`${entry.name}:authorization-fixture`),
    })),
    createdAt: '2026-07-10T12:00:00.000Z',
    now,
  });
  const source = {
    schemaVersion: 'promptframe-authoring-release-authorization/v1',
    state: 'publish_ready',
    releaseId: candidate.releaseId,
    releaseTag: 'authoring-release-2026-07-10.3',
    artifactTag: candidate.artifactTag,
    sourceCommit: candidate.sourceCommit,
    candidateManifestDigest: candidate.manifestDigest,
    platformGateDigest: `sha256:${'e'.repeat(64)}`,
    releaseDigest: candidate.releaseDigest,
    createdAt: '2026-07-10T13:00:00.000Z',
    expiresAt: '2026-08-09T13:00:00.000Z',
    packages: candidate.packages.map(({ name, version, integrity }) => ({ name, version, integrity })),
    authorizationDigest: '',
  };
  source.authorizationDigest = computeAuthoringReleaseAuthorizationDigest(source);
  const authorization = parseAuthoringReleaseAuthorization(source, { now });
  assert.equal(validateAuthorizationAgainstCandidate(authorization, candidate), true);

  const mismatch = structuredClone(authorization);
  mismatch.platformGateDigest = `sha256:${'f'.repeat(64)}`;
  assert.throws(() => parseAuthoringReleaseAuthorization(mismatch, { now }), /authorization_digest_mismatch/);

  const wrongCandidate = structuredClone(candidate);
  wrongCandidate.manifestDigest = `sha256:${'0'.repeat(64)}`;
  assert.throws(
    () => validateAuthorizationAgainstCandidate(authorization, wrongCandidate),
    /authorization_candidate_mismatch/,
  );
});

test('release intent rejects policy mutation, extra packages and noncanonical paths', async () => {
  const intent = await readAuthoringReleaseIntent(undefined, { root, now });
  const mutated = structuredClone(intent);
  mutated.packages[0].version = '9.9.9';
  assert.throws(() => parseAuthoringReleaseIntent(mutated, { now }), /intent_digest_mismatch/);

  const unknown = structuredClone(intent);
  unknown.packages[0].name = '@promptframe/not-allowed';
  unknown.intentDigest = computeAuthoringReleaseIntentDigest(unknown);
  assert.throws(() => parseAuthoringReleaseIntent(unknown, { now }), /package_allowlist_invalid/);

  await assert.rejects(
    readAuthoringReleaseIntent(path.join(root, '..', 'active-intent.json'), { root, now }),
    /intent_path_not_canonical/,
  );
});

test('candidate manifest binds exact tarball bytes and rejects drift', async () => {
  const intent = await readAuthoringReleaseIntent(undefined, { root, now });
  const artifacts = intent.packages.map((entry) => ({
    ...entry,
    artifactName: expectedArtifactName(entry.name, entry.version),
    bytes: Buffer.from(`${entry.name}@${entry.version}:fixture`),
  }));
  const candidate = createAuthoringCandidateManifest({
    intent,
    sourceCommit: 'a'.repeat(40),
    artifacts,
    createdAt: '2026-07-10T12:00:00.000Z',
    now,
  });

  assert.equal(candidate.packages.length, 4);
  assert.match(candidate.releaseDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(candidate.manifestDigest, /^sha256:[a-f0-9]{64}$/);

  const drift = structuredClone(candidate);
  drift.packages[0].sizeBytes += 1;
  assert.throws(() => parseAuthoringCandidateManifest(drift, { now }), /manifest_digest_mismatch/);

  const wrongName = structuredClone(candidate);
  wrongName.packages[0].artifactName = '../contracts.tgz';
  wrongName.manifestDigest = computeAuthoringCandidateManifestDigest(wrongName);
  assert.throws(() => parseAuthoringCandidateManifest(wrongName, { now }), /artifact_name_invalid/);
});

test('candidate artifact reader rejects symlinks and changed bytes', async () => {
  const intent = await readAuthoringReleaseIntent(undefined, { root, now });
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'authoring-candidate-receipt-'));
  try {
    const artifacts = [];
    for (const entry of intent.packages) {
      const artifactName = expectedArtifactName(entry.name, entry.version);
      const bytes = Buffer.from(`${entry.name}@${entry.version}:fixture`);
      artifacts.push({ ...entry, artifactName, bytes });
      await writeFile(path.join(tempRoot, artifactName), bytes);
    }
    const candidate = createAuthoringCandidateManifest({
      intent,
      sourceCommit: 'b'.repeat(40),
      artifacts,
      createdAt: '2026-07-10T12:00:00.000Z',
      now,
    });
    const manifestPath = path.join(tempRoot, 'candidate-manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(candidate)}\n`);
    const parsed = await readAuthoringCandidateManifest(manifestPath, { artifactRoot: tempRoot, now });
    assert.equal(await validateCandidateArtifactFiles(parsed, { artifactRoot: tempRoot }), true);

    await writeFile(path.join(tempRoot, candidate.packages[0].artifactName), 'changed');
    await assert.rejects(
      validateCandidateArtifactFiles(parsed, { artifactRoot: tempRoot }),
      /artifact_(size|digest)_mismatch/,
    );

    const linkRoot = await mkdtemp(path.join(os.tmpdir(), 'authoring-candidate-symlink-'));
    try {
      await mkdir(path.join(linkRoot, 'nested'));
      await writeFile(path.join(linkRoot, 'nested', 'manifest.json'), await readFile(manifestPath));
      await symlink(path.join(linkRoot, 'nested', 'manifest.json'), path.join(linkRoot, 'candidate-manifest.json'));
      await assert.rejects(
        readAuthoringCandidateManifest(path.join(linkRoot, 'candidate-manifest.json'), {
          artifactRoot: linkRoot,
          now,
        }),
        /candidate_file_not_regular/,
      );
    } finally {
      await rm(linkRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
