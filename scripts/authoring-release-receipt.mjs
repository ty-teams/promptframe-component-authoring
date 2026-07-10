import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUTHORING_RELEASE_REGISTRY = 'https://registry.npmjs.org/';
export const AUTHORING_RELEASE_INTENT_SCHEMA = 'promptframe-authoring-release-intent/v1';
export const AUTHORING_CANDIDATE_MANIFEST_SCHEMA = 'promptframe-authoring-candidate-manifest/v1';
export const AUTHORING_RELEASE_AUTHORIZATION_SCHEMA = 'promptframe-authoring-release-authorization/v1';
export const AUTHORING_RELEASE_PACKAGES = Object.freeze([
  Object.freeze({
    key: 'contracts',
    name: '@promptframe/contracts',
    manifestPath: 'packages/contracts/package.json',
  }),
  Object.freeze({
    key: 'componentKit',
    name: '@promptframe/component-kit',
    manifestPath: 'packages/component-kit/package.json',
  }),
  Object.freeze({
    key: 'cli',
    name: '@promptframe/cli',
    manifestPath: 'packages/cli/package.json',
  }),
  Object.freeze({
    key: 'createComponent',
    name: 'create-promptframe-component',
    manifestPath: 'packages/create-component/package.json',
  }),
]);

const INTENT_KEYS = Object.freeze([
  'artifactTag',
  'createdAt',
  'expiresAt',
  'intentDigest',
  'packages',
  'registry',
  'releaseId',
  'schemaVersion',
]);
const INTENT_PACKAGE_KEYS = Object.freeze(['name', 'version']);
const CANDIDATE_KEYS = Object.freeze([
  'artifactTag',
  'createdAt',
  'expiresAt',
  'intentDigest',
  'manifestDigest',
  'packages',
  'registry',
  'releaseDigest',
  'releaseId',
  'schemaVersion',
  'sourceCommit',
]);
const CANDIDATE_PACKAGE_KEYS = Object.freeze([
  'artifactName',
  'integrity',
  'name',
  'sha256',
  'sizeBytes',
  'version',
]);
const AUTHORIZATION_KEYS = Object.freeze([
  'artifactTag',
  'authorizationDigest',
  'candidateManifestDigest',
  'createdAt',
  'expiresAt',
  'packages',
  'platformGateDigest',
  'releaseDigest',
  'releaseId',
  'releaseTag',
  'schemaVersion',
  'sourceCommit',
  'state',
]);
const AUTHORIZATION_PACKAGE_KEYS = Object.freeze(['integrity', 'name', 'version']);

export function parseAuthoringReleaseIntent(value, options = {}) {
  const intent = requireRecord(value, 'authoring_release.intent_invalid');
  assertExactKeys(intent, INTENT_KEYS, 'authoring_release.intent_fields_invalid');
  if (intent.schemaVersion !== AUTHORING_RELEASE_INTENT_SCHEMA) {
    throw new Error('authoring_release.intent_schema_unsupported');
  }
  assertBoundedId(intent.releaseId, 'authoring_release.release_id_invalid');
  const expectedTag = `authoring-candidate-${intent.releaseId.replace(/^authoring-release-/, '')}`;
  if (intent.artifactTag !== expectedTag) throw new Error('authoring_release.artifact_tag_invalid');
  if (intent.registry !== AUTHORING_RELEASE_REGISTRY) throw new Error('authoring_release.registry_invalid');
  const { createdAt, expiresAt } = validateWindow(intent, options, 'authoring_release');
  const packages = parseExactPackages(intent.packages, INTENT_PACKAGE_KEYS, (entry) => {
    assertVersion(entry.version, 'authoring_release.package_version_invalid');
    return { name: entry.name, version: entry.version };
  });
  assertSha256(intent.intentDigest, 'authoring_release.intent_digest_invalid');
  const normalized = { ...intent, packages };
  if (computeAuthoringReleaseIntentDigest(normalized) !== intent.intentDigest) {
    throw new Error('authoring_release.intent_digest_mismatch');
  }
  return Object.freeze({ ...normalized, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() });
}

export async function readAuthoringReleaseIntent(filePath, options = {}) {
  const root = path.resolve(options.root ?? defaultRoot());
  const expectedPath = path.resolve(root, '.github', 'authoring-release', 'active-intent.json');
  const resolvedPath = path.resolve(filePath ?? expectedPath);
  if (resolvedPath !== expectedPath) throw new Error('authoring_release.intent_path_not_canonical');
  await assertRegularFile(resolvedPath, 'authoring_release.intent');
  return parseAuthoringReleaseIntent(JSON.parse(await readFile(resolvedPath, 'utf8')), options);
}

export async function validateIntentAgainstRepository(intent, options = {}) {
  const root = path.resolve(options.root ?? defaultRoot());
  const manifests = new Map();
  for (let index = 0; index < AUTHORING_RELEASE_PACKAGES.length; index += 1) {
    const definition = AUTHORING_RELEASE_PACKAGES[index];
    const manifest = JSON.parse(await readFile(path.join(root, definition.manifestPath), 'utf8'));
    if (manifest.name !== definition.name || manifest.version !== intent.packages[index].version) {
      throw new Error('authoring_release.repository_cohort_mismatch');
    }
    manifests.set(definition.name, manifest);
  }
  const contractsVersion = intent.packages[0].version;
  if (manifests.get('@promptframe/component-kit')?.dependencies?.['@promptframe/contracts'] !== contractsVersion) {
    throw new Error('authoring_release.component_kit_dependency_mismatch');
  }
  if (manifests.get('@promptframe/cli')?.dependencies?.['@promptframe/contracts'] !== contractsVersion) {
    throw new Error('authoring_release.cli_dependency_mismatch');
  }
  return true;
}

export function createAuthoringCandidateManifest(input) {
  const intent = parseAuthoringReleaseIntent(input.intent, {
    now: input.now,
    allowExpired: input.allowExpired,
  });
  assertCommit(input.sourceCommit, 'authoring_release.source_commit_invalid');
  if (!Array.isArray(input.artifacts) || input.artifacts.length !== AUTHORING_RELEASE_PACKAGES.length) {
    throw new Error('authoring_release.artifact_count_invalid');
  }
  const packages = input.artifacts.map((artifact, index) => {
    const expected = intent.packages[index];
    const value = requireRecord(artifact, 'authoring_release.artifact_invalid');
    if (value.name !== expected.name || value.version !== expected.version) {
      throw new Error('authoring_release.artifact_cohort_mismatch');
    }
    if (!Buffer.isBuffer(value.bytes) || value.bytes.length === 0) {
      throw new Error('authoring_release.artifact_bytes_invalid');
    }
    const artifactName = expectedArtifactName(value.name, value.version);
    if (value.artifactName !== artifactName) throw new Error('authoring_release.artifact_name_invalid');
    return {
      name: value.name,
      version: value.version,
      artifactName,
      sizeBytes: value.bytes.length,
      sha256: `sha256:${createHash('sha256').update(value.bytes).digest('hex')}`,
      integrity: `sha512-${createHash('sha512').update(value.bytes).digest('base64')}`,
    };
  });
  const createdAt = parseTimestamp(input.createdAt ?? new Date().toISOString(), 'authoring_release.created_at_invalid');
  const candidate = {
    schemaVersion: AUTHORING_CANDIDATE_MANIFEST_SCHEMA,
    releaseId: intent.releaseId,
    artifactTag: intent.artifactTag,
    sourceCommit: input.sourceCommit,
    createdAt: createdAt.toISOString(),
    expiresAt: intent.expiresAt,
    registry: intent.registry,
    intentDigest: intent.intentDigest,
    packages,
    releaseDigest: '',
    manifestDigest: '',
  };
  candidate.releaseDigest = computeAuthoringCandidateReleaseDigest(candidate);
  candidate.manifestDigest = computeAuthoringCandidateManifestDigest(candidate);
  return parseAuthoringCandidateManifest(candidate, { now: input.now });
}

export function parseAuthoringCandidateManifest(value, options = {}) {
  const candidate = requireRecord(value, 'authoring_release.candidate_invalid');
  assertExactKeys(candidate, CANDIDATE_KEYS, 'authoring_release.candidate_fields_invalid');
  if (candidate.schemaVersion !== AUTHORING_CANDIDATE_MANIFEST_SCHEMA) {
    throw new Error('authoring_release.candidate_schema_unsupported');
  }
  assertBoundedId(candidate.releaseId, 'authoring_release.release_id_invalid');
  const expectedTag = `authoring-candidate-${candidate.releaseId.replace(/^authoring-release-/, '')}`;
  if (candidate.artifactTag !== expectedTag) throw new Error('authoring_release.artifact_tag_invalid');
  assertCommit(candidate.sourceCommit, 'authoring_release.source_commit_invalid');
  if (candidate.registry !== AUTHORING_RELEASE_REGISTRY) throw new Error('authoring_release.registry_invalid');
  validateWindow(candidate, options, 'authoring_release');
  assertSha256(candidate.intentDigest, 'authoring_release.intent_digest_invalid');
  const packages = parseExactPackages(candidate.packages, CANDIDATE_PACKAGE_KEYS, (entry) => {
    assertVersion(entry.version, 'authoring_release.package_version_invalid');
    if (entry.artifactName !== expectedArtifactName(entry.name, entry.version)) {
      throw new Error('authoring_release.artifact_name_invalid');
    }
    if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes <= 0) {
      throw new Error('authoring_release.artifact_size_invalid');
    }
    assertSha256(entry.sha256, 'authoring_release.artifact_sha256_invalid');
    assertIntegrity(entry.integrity, 'authoring_release.artifact_integrity_invalid');
    return { ...entry };
  });
  assertSha256(candidate.releaseDigest, 'authoring_release.release_digest_invalid');
  assertSha256(candidate.manifestDigest, 'authoring_release.manifest_digest_invalid');
  const normalized = { ...candidate, packages };
  if (computeAuthoringCandidateReleaseDigest(normalized) !== candidate.releaseDigest) {
    throw new Error('authoring_release.release_digest_mismatch');
  }
  if (computeAuthoringCandidateManifestDigest(normalized) !== candidate.manifestDigest) {
    throw new Error('authoring_release.manifest_digest_mismatch');
  }
  return Object.freeze(normalized);
}

export async function readAuthoringCandidateManifest(filePath, options = {}) {
  const artifactRoot = path.resolve(options.artifactRoot ?? path.dirname(path.resolve(filePath)));
  const expectedPath = path.join(artifactRoot, 'candidate-manifest.json');
  const resolvedPath = path.resolve(filePath);
  if (resolvedPath !== expectedPath) throw new Error('authoring_release.candidate_path_not_canonical');
  await assertRegularFile(resolvedPath, 'authoring_release.candidate');
  return parseAuthoringCandidateManifest(JSON.parse(await readFile(resolvedPath, 'utf8')), options);
}

export async function validateCandidateArtifactFiles(candidate, options = {}) {
  const artifactRoot = path.resolve(options.artifactRoot);
  for (const packageEntry of candidate.packages) {
    const artifactPath = path.resolve(artifactRoot, packageEntry.artifactName);
    if (path.dirname(artifactPath) !== artifactRoot) throw new Error('authoring_release.artifact_path_invalid');
    await assertRegularFile(artifactPath, 'authoring_release.artifact');
    const bytes = await readFile(artifactPath);
    if (bytes.length !== packageEntry.sizeBytes) throw new Error('authoring_release.artifact_size_mismatch');
    const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (sha256 !== packageEntry.sha256 || integrity !== packageEntry.integrity) {
      throw new Error('authoring_release.artifact_digest_mismatch');
    }
  }
  return true;
}

export function parseAuthoringReleaseAuthorization(value, options = {}) {
  const authorization = requireRecord(value, 'authoring_release.authorization_invalid');
  assertExactKeys(authorization, AUTHORIZATION_KEYS, 'authoring_release.authorization_fields_invalid');
  if (authorization.schemaVersion !== AUTHORING_RELEASE_AUTHORIZATION_SCHEMA) {
    throw new Error('authoring_release.authorization_schema_unsupported');
  }
  if (authorization.state !== 'publish_ready') throw new Error('authoring_release.authorization_state_invalid');
  assertBoundedId(authorization.releaseId, 'authoring_release.release_id_invalid');
  const suffix = authorization.releaseId.replace(/^authoring-release-/, '');
  if (authorization.artifactTag !== `authoring-candidate-${suffix}`) {
    throw new Error('authoring_release.artifact_tag_invalid');
  }
  if (authorization.releaseTag !== `authoring-release-${suffix}`) {
    throw new Error('authoring_release.release_tag_invalid');
  }
  assertCommit(authorization.sourceCommit, 'authoring_release.source_commit_invalid');
  validateWindow(authorization, options, 'authoring_release');
  assertSha256(authorization.candidateManifestDigest, 'authoring_release.candidate_manifest_digest_invalid');
  assertSha256(authorization.platformGateDigest, 'authoring_release.platform_gate_digest_invalid');
  assertSha256(authorization.releaseDigest, 'authoring_release.release_digest_invalid');
  const packages = parseExactPackages(authorization.packages, AUTHORIZATION_PACKAGE_KEYS, (entry) => {
    assertVersion(entry.version, 'authoring_release.package_version_invalid');
    assertIntegrity(entry.integrity, 'authoring_release.artifact_integrity_invalid');
    return { ...entry };
  });
  assertSha256(authorization.authorizationDigest, 'authoring_release.authorization_digest_invalid');
  const normalized = { ...authorization, packages };
  if (computeAuthoringReleaseAuthorizationDigest(normalized) !== authorization.authorizationDigest) {
    throw new Error('authoring_release.authorization_digest_mismatch');
  }
  return Object.freeze(normalized);
}

export async function readAuthoringReleaseAuthorization(filePath, options = {}) {
  const root = path.resolve(options.root ?? defaultRoot());
  const expectedPath = path.resolve(root, '.github', 'authoring-release', 'active-authorization.json');
  const resolvedPath = path.resolve(filePath ?? expectedPath);
  if (resolvedPath !== expectedPath) throw new Error('authoring_release.authorization_path_not_canonical');
  await assertRegularFile(resolvedPath, 'authoring_release.authorization');
  return parseAuthoringReleaseAuthorization(JSON.parse(await readFile(resolvedPath, 'utf8')), options);
}

export function validateAuthorizationAgainstCandidate(authorization, candidate) {
  if (
    authorization.releaseId !== candidate.releaseId
    || authorization.artifactTag !== candidate.artifactTag
    || authorization.sourceCommit !== candidate.sourceCommit
    || authorization.candidateManifestDigest !== candidate.manifestDigest
    || authorization.releaseDigest !== candidate.releaseDigest
  ) {
    throw new Error('authoring_release.authorization_candidate_mismatch');
  }
  for (let index = 0; index < candidate.packages.length; index += 1) {
    const authorized = authorization.packages[index];
    const artifact = candidate.packages[index];
    if (
      authorized.name !== artifact.name
      || authorized.version !== artifact.version
      || authorized.integrity !== artifact.integrity
    ) {
      throw new Error('authoring_release.authorization_package_mismatch');
    }
  }
  return true;
}

export function computeAuthoringReleaseIntentDigest(intent) {
  return digestWithout(intent, 'intentDigest');
}

export function computeAuthoringCandidateReleaseDigest(candidate) {
  return `sha256:${createHash('sha256').update(canonicalJson({
    releaseId: candidate.releaseId,
    sourceCommit: candidate.sourceCommit,
    intentDigest: candidate.intentDigest,
    packages: candidate.packages.map(({ name, version, integrity }) => ({ name, version, integrity })),
  })).digest('hex')}`;
}

export function computeAuthoringCandidateManifestDigest(candidate) {
  return digestWithout(candidate, 'manifestDigest');
}

export function computeAuthoringReleaseAuthorizationDigest(authorization) {
  return digestWithout(authorization, 'authorizationDigest');
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function expectedArtifactName(packageName, version) {
  const stem = packageName.replace(/^@/, '').replaceAll('/', '-');
  return `${stem}-${version}.tgz`;
}

function parseExactPackages(value, expectedKeys, normalize) {
  if (!Array.isArray(value) || value.length !== AUTHORING_RELEASE_PACKAGES.length) {
    throw new Error('authoring_release.package_count_invalid');
  }
  return value.map((entry, index) => {
    const packageEntry = requireRecord(entry, 'authoring_release.package_invalid');
    assertExactKeys(packageEntry, expectedKeys, 'authoring_release.package_fields_invalid');
    if (packageEntry.name !== AUTHORING_RELEASE_PACKAGES[index].name) {
      throw new Error('authoring_release.package_allowlist_invalid');
    }
    return normalize(packageEntry);
  });
}

function validateWindow(value, options, prefix) {
  const createdAt = parseTimestamp(value.createdAt, `${prefix}.created_at_invalid`);
  const expiresAt = parseTimestamp(value.expiresAt, `${prefix}.expires_at_invalid`);
  if (expiresAt <= createdAt) throw new Error(`${prefix}.expiry_order_invalid`);
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (Number.isNaN(now.getTime())) throw new Error(`${prefix}.now_invalid`);
  if (options.allowExpired !== true && expiresAt <= now) throw new Error(`${prefix}.expired`);
  return { createdAt, expiresAt };
}

async function assertRegularFile(filePath, prefix) {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${prefix}_file_not_regular`);
  if (await realpath(filePath) !== filePath) throw new Error(`${prefix}_realpath_mismatch`);
}

function digestWithout(value, key) {
  const material = { ...value };
  delete material[key];
  return `sha256:${createHash('sha256').update(canonicalJson(material)).digest('hex')}`;
}

function assertExactKeys(value, expected, code) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(code);
  }
}

function assertString(value, code) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) throw new Error(code);
}

function assertBoundedId(value, code) {
  assertString(value, code);
  if (!/^authoring-release-[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/.test(value)) throw new Error(code);
}

function assertVersion(value, code) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value ?? ''))) throw new Error(code);
}

function assertCommit(value, code) {
  if (!/^[a-f0-9]{40}$/.test(String(value ?? ''))) throw new Error(code);
}

function assertSha256(value, code) {
  if (!/^sha256:[a-f0-9]{64}$/.test(String(value ?? ''))) throw new Error(code);
}

function assertIntegrity(value, code) {
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(String(value ?? ''))) throw new Error(code);
}

function parseTimestamp(value, code) {
  assertString(value, code);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(code);
  return parsed;
}

function requireRecord(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function defaultRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}
