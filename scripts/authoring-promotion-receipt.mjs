import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUTHORING_PROMOTION_SCHEMA_VERSION = 'promptframe-authoring-promotion-receipt/v1';
export const AUTHORING_PROMOTION_REGISTRY = 'https://registry.npmjs.org/';
export const AUTHORING_PROMOTION_PACKAGE_MANIFESTS = Object.freeze([
  ['@promptframe/contracts', 'packages/contracts/package.json'],
  ['@promptframe/component-kit', 'packages/component-kit/package.json'],
  ['@promptframe/cli', 'packages/cli/package.json'],
  ['create-promptframe-component', 'packages/create-component/package.json'],
]);
export const AUTHORING_PROMOTION_PACKAGE_NAMES = Object.freeze(
  AUTHORING_PROMOTION_PACKAGE_MANIFESTS.map(([name]) => name),
);

const RECEIPT_KEYS = Object.freeze([
  'allowedModes',
  'createdAt',
  'expiresAt',
  'operationId',
  'packages',
  'platformGateDigest',
  'proof',
  'proofReceiptDigest',
  'publicSourceCommit',
  'receiptDigest',
  'receiptState',
  'registry',
  'releaseDigest',
  'releaseId',
  'scaffoldDigest',
  'schemaVersion',
]);
const PACKAGE_KEYS = Object.freeze(['integrity', 'name', 'version']);
const PROOF_KEYS = Object.freeze(['integrity', 'packageName', 'tag', 'version']);
const ALLOWED_MODES = new Set(['dry-run', 'proof', 'latest']);
const ALLOWED_STATES = new Set(['candidate_verified', 'credential_proof_ready', 'promotion_ready']);

export function parseAuthoringPromotionReceipt(value, options = {}) {
  const receipt = requireRecord(value, 'promotion_receipt.invalid');
  assertExactKeys(receipt, RECEIPT_KEYS, 'promotion_receipt.fields_invalid');
  assertString(receipt.schemaVersion, 'promotion_receipt.schema_missing');
  if (receipt.schemaVersion !== AUTHORING_PROMOTION_SCHEMA_VERSION) {
    throw new Error('promotion_receipt.schema_unsupported');
  }
  assertBoundedId(receipt.operationId, 'promotion_receipt.operation_id_invalid');
  assertBoundedId(receipt.releaseId, 'promotion_receipt.release_id_invalid');
  assertSha256(receipt.releaseDigest, 'promotion_receipt.release_digest_invalid');
  assertSha256(receipt.scaffoldDigest, 'promotion_receipt.scaffold_digest_invalid');
  assertSha256(receipt.platformGateDigest, 'promotion_receipt.platform_gate_digest_invalid');
  assertCommit(receipt.publicSourceCommit, 'promotion_receipt.public_source_commit_invalid');
  if (receipt.registry !== AUTHORING_PROMOTION_REGISTRY) {
    throw new Error('promotion_receipt.registry_invalid');
  }
  if (!ALLOWED_STATES.has(receipt.receiptState)) {
    throw new Error('promotion_receipt.state_invalid');
  }

  const createdAt = parseTimestamp(receipt.createdAt, 'promotion_receipt.created_at_invalid');
  const expiresAt = parseTimestamp(receipt.expiresAt, 'promotion_receipt.expires_at_invalid');
  if (expiresAt <= createdAt) throw new Error('promotion_receipt.expiry_order_invalid');
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (Number.isNaN(now.getTime())) throw new Error('promotion_receipt.now_invalid');
  if (options.allowExpired !== true && expiresAt <= now) {
    throw new Error('promotion_receipt.expired');
  }

  if (!Array.isArray(receipt.allowedModes) || receipt.allowedModes.length === 0) {
    throw new Error('promotion_receipt.allowed_modes_invalid');
  }
  const allowedModes = receipt.allowedModes.map((mode) => {
    assertString(mode, 'promotion_receipt.allowed_mode_invalid');
    if (!ALLOWED_MODES.has(mode)) throw new Error('promotion_receipt.allowed_mode_invalid');
    return mode;
  });
  if (new Set(allowedModes).size !== allowedModes.length) {
    throw new Error('promotion_receipt.allowed_mode_duplicate');
  }
  if (!allowedModes.includes('dry-run')) {
    throw new Error('promotion_receipt.dry_run_required');
  }

  if (!Array.isArray(receipt.packages) || receipt.packages.length !== AUTHORING_PROMOTION_PACKAGE_NAMES.length) {
    throw new Error('promotion_receipt.package_count_invalid');
  }
  const packages = receipt.packages.map((entry, index) => {
    const packageReceipt = requireRecord(entry, 'promotion_receipt.package_invalid');
    assertExactKeys(packageReceipt, PACKAGE_KEYS, 'promotion_receipt.package_fields_invalid');
    if (packageReceipt.name !== AUTHORING_PROMOTION_PACKAGE_NAMES[index]) {
      throw new Error('promotion_receipt.package_allowlist_invalid');
    }
    assertVersion(packageReceipt.version, 'promotion_receipt.package_version_invalid');
    assertIntegrity(packageReceipt.integrity, 'promotion_receipt.package_integrity_invalid');
    return { ...packageReceipt };
  });

  let proof = null;
  if (receipt.proof !== null) {
    proof = requireRecord(receipt.proof, 'promotion_receipt.proof_invalid');
    assertExactKeys(proof, PROOF_KEYS, 'promotion_receipt.proof_fields_invalid');
    if (!AUTHORING_PROMOTION_PACKAGE_NAMES.includes(proof.packageName)) {
      throw new Error('promotion_receipt.proof_package_invalid');
    }
    assertVersion(proof.version, 'promotion_receipt.proof_version_invalid');
    assertIntegrity(proof.integrity, 'promotion_receipt.proof_integrity_invalid');
    if (!/^promotion-proof-[a-z0-9][a-z0-9-]{5,80}$/.test(String(proof.tag ?? ''))) {
      throw new Error('promotion_receipt.proof_tag_invalid');
    }
    proof = { ...proof };
  }

  if (receipt.proofReceiptDigest !== null) {
    assertSha256(receipt.proofReceiptDigest, 'promotion_receipt.proof_receipt_digest_invalid');
  }
  if (allowedModes.includes('proof') && (!proof || receipt.receiptState !== 'credential_proof_ready')) {
    throw new Error('promotion_receipt.proof_mode_not_ready');
  }
  if (
    allowedModes.includes('latest')
    && (receipt.receiptState !== 'promotion_ready' || !receipt.proofReceiptDigest)
  ) {
    throw new Error('promotion_receipt.latest_mode_not_ready');
  }

  assertSha256(receipt.receiptDigest, 'promotion_receipt.digest_invalid');
  const normalized = {
    ...receipt,
    allowedModes,
    packages,
    proof,
  };
  const expectedDigest = computeAuthoringPromotionReceiptDigest(normalized);
  if (receipt.receiptDigest !== expectedDigest) {
    throw new Error('promotion_receipt.digest_mismatch');
  }
  return Object.freeze(normalized);
}

export async function readAuthoringPromotionReceipt(filePath, options = {}) {
  const root = path.resolve(options.root ?? defaultRoot());
  const expectedPath = path.resolve(root, '.github', 'authoring-promotion', 'active-receipt.json');
  const resolvedPath = path.resolve(filePath ?? expectedPath);
  if (resolvedPath !== expectedPath) throw new Error('promotion_receipt.path_not_canonical');
  const fileStat = await lstat(resolvedPath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error('promotion_receipt.file_not_regular');
  }
  if (await realpath(resolvedPath) !== resolvedPath) {
    throw new Error('promotion_receipt.realpath_mismatch');
  }
  const source = await readFile(resolvedPath, 'utf8');
  return parseAuthoringPromotionReceipt(JSON.parse(source), options);
}

export async function validateReceiptAgainstRepository(receipt, options = {}) {
  const root = path.resolve(options.root ?? defaultRoot());
  for (let index = 0; index < AUTHORING_PROMOTION_PACKAGE_MANIFESTS.length; index += 1) {
    const [name, relativePath] = AUTHORING_PROMOTION_PACKAGE_MANIFESTS[index];
    const manifest = JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
    if (manifest.name !== name || manifest.version !== receipt.packages[index].version) {
      throw new Error('promotion_receipt.repository_cohort_mismatch');
    }
  }
  const sourceCommitVerifier = options.sourceCommitVerifier ?? isCommitAncestor;
  if (!await sourceCommitVerifier(receipt.publicSourceCommit, root)) {
    throw new Error('promotion_receipt.public_source_not_ancestor');
  }
  return true;
}

export function assertPromotionModeAllowed(receipt, mode) {
  if (!ALLOWED_MODES.has(mode)) throw new Error('promotion_receipt.mode_invalid');
  if (!receipt.allowedModes.includes(mode)) throw new Error('promotion_receipt.mode_not_allowed');
  return true;
}

export function computeAuthoringPromotionReceiptDigest(receipt) {
  const material = { ...receipt };
  delete material.receiptDigest;
  return `sha256:${createHash('sha256').update(canonicalJson(material)).digest('hex')}`;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/.test(value)) throw new Error(code);
}

function assertSha256(value, code) {
  if (!/^sha256:[a-f0-9]{64}$/.test(String(value ?? ''))) throw new Error(code);
}

function assertCommit(value, code) {
  if (!/^[a-f0-9]{40}$/.test(String(value ?? ''))) throw new Error(code);
}

function assertVersion(value, code) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value ?? ''))) throw new Error(code);
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

function isCommitAncestor(commit, root) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}
