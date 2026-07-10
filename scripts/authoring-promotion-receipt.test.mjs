import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AUTHORING_PROMOTION_PACKAGE_NAMES,
  assertPromotionModeAllowed,
  computeAuthoringPromotionReceiptDigest,
  parseAuthoringPromotionReceipt,
  readAuthoringPromotionReceipt,
  validateReceiptAgainstRepository,
} from './authoring-promotion-receipt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receiptPath = path.join(root, '.github', 'authoring-promotion', 'active-receipt.json');
const now = new Date('2026-07-11T00:00:00.000Z');

test('active authoring promotion receipt binds the exact public cohort and is dry-run only', async () => {
  const receipt = await readAuthoringPromotionReceipt(receiptPath, { root, now });

  assert.deepEqual(receipt.packages.map((entry) => entry.name), AUTHORING_PROMOTION_PACKAGE_NAMES);
  assert.deepEqual(receipt.allowedModes, ['dry-run']);
  assert.equal(receipt.receiptState, 'candidate_verified');
  assert.equal(await validateReceiptAgainstRepository(receipt, { root }), true);
  assert.equal(assertPromotionModeAllowed(receipt, 'dry-run'), true);
  assert.throws(() => assertPromotionModeAllowed(receipt, 'proof'), /promotion_receipt.mode_not_allowed/);
  assert.throws(() => assertPromotionModeAllowed(receipt, 'latest'), /promotion_receipt.mode_not_allowed/);
});

test('receipt digest rejects any cohort or policy mutation', async () => {
  const source = JSON.parse(await readFile(receiptPath, 'utf8'));
  const originalDigest = source.receiptDigest;
  assert.equal(computeAuthoringPromotionReceiptDigest(source), originalDigest);

  source.packages[0].version = '0.1.26';
  assert.throws(
    () => parseAuthoringPromotionReceipt(source, { now }),
    /promotion_receipt.digest_mismatch/,
  );
});

test('receipt rejects unknown packages, extra fields, traversal paths and premature latest mode', async () => {
  const source = JSON.parse(await readFile(receiptPath, 'utf8'));

  const unknownPackage = structuredClone(source);
  unknownPackage.packages[0].name = '@promptframe/not-allowed';
  unknownPackage.receiptDigest = computeAuthoringPromotionReceiptDigest(unknownPackage);
  assert.throws(
    () => parseAuthoringPromotionReceipt(unknownPackage, { now }),
    /promotion_receipt.package_allowlist_invalid/,
  );

  const extraField = { ...source, arbitraryVersion: '9.9.9' };
  extraField.receiptDigest = computeAuthoringPromotionReceiptDigest(extraField);
  assert.throws(
    () => parseAuthoringPromotionReceipt(extraField, { now }),
    /promotion_receipt.fields_invalid/,
  );

  const prematureLatest = structuredClone(source);
  prematureLatest.allowedModes = ['dry-run', 'latest'];
  prematureLatest.receiptDigest = computeAuthoringPromotionReceiptDigest(prematureLatest);
  assert.throws(
    () => parseAuthoringPromotionReceipt(prematureLatest, { now }),
    /promotion_receipt.latest_mode_not_ready/,
  );

  await assert.rejects(
    readAuthoringPromotionReceipt(path.join(root, '..', 'receipt.json'), { root, now }),
    /promotion_receipt.path_not_canonical/,
  );
});

test('receipt rejects expiration and malformed proof policy', async () => {
  const source = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.throws(
    () => parseAuthoringPromotionReceipt(source, { now: new Date('2027-01-01T00:00:00.000Z') }),
    /promotion_receipt.expired/,
  );

  const proof = structuredClone(source);
  proof.receiptState = 'credential_proof_ready';
  proof.allowedModes = ['dry-run', 'proof'];
  proof.proof = {
    packageName: '@promptframe/contracts',
    version: '0.1.23',
    integrity: source.packages[0].integrity,
    tag: 'latest',
  };
  proof.receiptDigest = computeAuthoringPromotionReceiptDigest(proof);
  assert.throws(
    () => parseAuthoringPromotionReceipt(proof, { now }),
    /promotion_receipt.proof_tag_invalid/,
  );
});

test('receipt rejects symlink input and a source commit outside the trusted ancestry', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'authoring-promotion-receipt-'));
  try {
    const receiptDir = path.join(tempRoot, '.github', 'authoring-promotion');
    const targetPath = path.join(tempRoot, 'target.json');
    const canonicalPath = path.join(receiptDir, 'active-receipt.json');
    await mkdir(receiptDir, { recursive: true });
    await writeFile(targetPath, await readFile(receiptPath, 'utf8'));
    await symlink(targetPath, canonicalPath);
    await assert.rejects(
      readAuthoringPromotionReceipt(canonicalPath, { root: tempRoot, now }),
      /promotion_receipt.file_not_regular/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  const receipt = await readAuthoringPromotionReceipt(receiptPath, { root, now });
  await assert.rejects(
    validateReceiptAgainstRepository(receipt, {
      root,
      sourceCommitVerifier: async () => false,
    }),
    /promotion_receipt.public_source_not_ancestor/,
  );
});
