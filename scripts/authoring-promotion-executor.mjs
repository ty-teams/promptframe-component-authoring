import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AUTHORING_PROMOTION_REGISTRY,
  assertPromotionModeAllowed,
  readAuthoringPromotionReceipt,
  validateReceiptAgainstRepository,
} from './authoring-promotion-receipt.mjs';

const execFile = promisify(execFileCallback);
const MUTATION_TAGS = Object.freeze(['next', 'latest']);

export class AuthoringPromotionExecutionError extends Error {
  constructor(code, receipt, options = {}) {
    super(code, options);
    this.name = 'AuthoringPromotionExecutionError';
    this.code = code;
    this.receipt = receipt;
  }
}

export async function executeAuthoringPromotion(input) {
  const { receipt, mode } = input;
  assertPromotionModeAllowed(receipt, mode);
  const registry = input.registry ?? createNpmRegistryClient();
  const startedAt = (input.now ?? (() => new Date()))().toISOString();
  const packageSnapshots = await readAndVerifyCohort(receipt, registry);
  const baseResult = {
    schemaVersion: 'promptframe-authoring-promotion-execution/v1',
    operationId: receipt.operationId,
    receiptDigest: receipt.receiptDigest,
    releaseId: receipt.releaseId,
    releaseDigest: receipt.releaseDigest,
    mode,
    startedAt,
    completedAt: null,
    status: 'pending',
    sanitized: true,
    packages: packageSnapshots.map(toSanitizedSnapshot),
    actions: [],
    compensation: [],
    failure: null,
  };

  if (mode === 'dry-run') {
    return {
      ...baseResult,
      completedAt: (input.now ?? (() => new Date()))().toISOString(),
      status: 'verified_dry_run',
      actions: buildDryRunActions(packageSnapshots),
    };
  }

  if (!input.mutator) throw new AuthoringPromotionExecutionError('promotion_execution.mutator_required', baseResult);
  if (mode === 'proof') {
    return executeProof({ ...input, registry, baseResult });
  }
  return executeLatest({ ...input, registry, packageSnapshots, baseResult });
}

async function executeProof(input) {
  const { receipt, registry, mutator, baseResult } = input;
  const proof = receipt.proof;
  if (!proof) throw new AuthoringPromotionExecutionError('promotion_execution.proof_missing', baseResult);
  const initial = await registry.readPackage(proof.packageName);
  verifyVersionIntegrity(initial, proof.version, proof.integrity);
  if (initial.distTags[proof.tag] !== undefined) {
    throw new AuthoringPromotionExecutionError('promotion_execution.proof_tag_exists', baseResult);
  }

  const result = structuredClone(baseResult);
  let tagCreated = false;
  try {
    await mutator.addTag(proof.packageName, proof.version, proof.tag);
    tagCreated = true;
    result.actions.push(action('proof_add', proof.packageName, proof.tag, null, proof.version, 'applied'));
    const added = await registry.readPackage(proof.packageName);
    verifyTag(added, proof.tag, proof.version, proof.integrity);

    await mutator.removeTag(proof.packageName, proof.tag);
    tagCreated = false;
    result.actions.push(action('proof_remove', proof.packageName, proof.tag, proof.version, null, 'applied'));
    const removed = await registry.readPackage(proof.packageName);
    if (removed.distTags[proof.tag] !== undefined) throw new Error('promotion_execution.proof_remove_unverified');

    result.status = 'proof_verified';
    result.completedAt = (input.now ?? (() => new Date()))().toISOString();
    return result;
  } catch (error) {
    if (tagCreated) {
      try {
        await mutator.removeTag(proof.packageName, proof.tag);
        result.compensation.push(action('proof_remove', proof.packageName, proof.tag, proof.version, null, 'compensated'));
      } catch {
        result.compensation.push(action('proof_remove', proof.packageName, proof.tag, proof.version, null, 'compensation_failed'));
      }
    }
    result.status = result.compensation.some((entry) => entry.status === 'compensation_failed')
      ? 'compensation_failed'
      : 'failed_compensated';
    result.failure = sanitizeFailure(error);
    result.completedAt = (input.now ?? (() => new Date()))().toISOString();
    throw new AuthoringPromotionExecutionError(
      result.status === 'compensation_failed'
        ? 'promotion_execution.proof_compensation_failed'
        : 'promotion_execution.proof_failed',
      result,
      { cause: error },
    );
  }
}

async function executeLatest(input) {
  const { receipt, registry, mutator, packageSnapshots, baseResult } = input;
  for (const snapshot of packageSnapshots) {
    if (snapshot.distTags.next !== snapshot.version && snapshot.distTags.latest !== snapshot.version) {
      throw new AuthoringPromotionExecutionError('promotion_execution.candidate_tag_missing', baseResult);
    }
  }

  const result = structuredClone(baseResult);
  const applied = [];
  try {
    for (const snapshot of packageSnapshots) {
      for (const tag of MUTATION_TAGS) {
        const previous = snapshot.distTags[tag] ?? null;
        if (previous === snapshot.version) {
          result.actions.push(action('set_tag', snapshot.name, tag, previous, snapshot.version, 'noop'));
          continue;
        }
        await mutator.addTag(snapshot.name, snapshot.version, tag);
        const completed = action('set_tag', snapshot.name, tag, previous, snapshot.version, 'applied');
        applied.push(completed);
        result.actions.push(completed);
        const verified = await registry.readPackage(snapshot.name);
        verifyTag(verified, tag, snapshot.version, snapshot.integrity);
      }
    }

    result.status = 'promoted';
    result.completedAt = (input.now ?? (() => new Date()))().toISOString();
    return result;
  } catch (error) {
    for (const completed of [...applied].reverse()) {
      try {
        if (completed.previousVersion === null) {
          await mutator.removeTag(completed.packageName, completed.tag);
        } else {
          await mutator.addTag(completed.packageName, completed.previousVersion, completed.tag);
        }
        const restored = await registry.readPackage(completed.packageName);
        if ((restored.distTags[completed.tag] ?? null) !== completed.previousVersion) {
          throw new Error('promotion_execution.compensation_unverified');
        }
        result.compensation.push({ ...completed, status: 'compensated' });
      } catch {
        result.compensation.push({ ...completed, status: 'compensation_failed' });
      }
    }
    const compensationFailed = result.compensation.some((entry) => entry.status === 'compensation_failed');
    result.status = compensationFailed ? 'compensation_failed' : 'failed_compensated';
    result.failure = sanitizeFailure(error);
    result.completedAt = (input.now ?? (() => new Date()))().toISOString();
    throw new AuthoringPromotionExecutionError(
      compensationFailed
        ? 'promotion_execution.compensation_failed'
        : 'promotion_execution.failed_compensated',
      result,
      { cause: error },
    );
  }
}

export function createNpmRegistryClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const registry = options.registry ?? AUTHORING_PROMOTION_REGISTRY;
  return {
    async readPackage(packageName) {
      const response = await fetchImpl(`${registry}${encodeURIComponent(packageName)}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`promotion_registry.http_${response.status}`);
      return normalizeRegistryMetadata(await response.json());
    },
  };
}

export async function createNpmTagMutator(options) {
  const token = String(options.token ?? '');
  if (token.length < 20) throw new Error('promotion_execution.token_missing');
  const runnerTemp = path.resolve(options.runnerTemp ?? process.env.RUNNER_TEMP ?? os.tmpdir());
  await mkdir(runnerTemp, { recursive: true });
  const tempRoot = await mkdtemp(path.join(runnerTemp, 'promptframe-promotion-'));
  const npmrcPath = path.join(tempRoot, '.npmrc');
  try {
    await writeFile(
      npmrcPath,
      `//registry.npmjs.org/:_authToken=${token}\nregistry=${AUTHORING_PROMOTION_REGISTRY}\nalways-auth=true\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
  const execImpl = options.execFileImpl ?? execFile;
  const childBaseEnv = { ...(options.baseEnv ?? process.env) };
  delete childBaseEnv.NPM_DIST_TAG_PROMOTION_TOKEN;
  const npmEnv = {
    ...childBaseEnv,
    NPM_CONFIG_USERCONFIG: npmrcPath,
    NPM_CONFIG_REGISTRY: AUTHORING_PROMOTION_REGISTRY,
    NPM_CONFIG_LOGLEVEL: 'error',
  };
  const run = async (args) => {
    try {
      await execImpl('npm', args, {
        cwd: tempRoot,
        env: npmEnv,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      throw new Error('promotion_execution.npm_command_failed', { cause: error });
    }
  };
  return {
    npmrcPath,
    async addTag(packageName, version, tag) {
      await run(['dist-tag', 'add', `${packageName}@${version}`, tag, '--registry', AUTHORING_PROMOTION_REGISTRY]);
    },
    async removeTag(packageName, tag) {
      await run(['dist-tag', 'rm', packageName, tag, '--registry', AUTHORING_PROMOTION_REGISTRY]);
    },
    async close() {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

async function readAndVerifyCohort(receipt, registry) {
  const snapshots = [];
  for (const packageReceipt of receipt.packages) {
    const metadata = await registry.readPackage(packageReceipt.name);
    verifyVersionIntegrity(metadata, packageReceipt.version, packageReceipt.integrity);
    snapshots.push({
      ...packageReceipt,
      distTags: {
        next: metadata.distTags.next,
        latest: metadata.distTags.latest,
      },
    });
  }
  return snapshots;
}

function normalizeRegistryMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('promotion_registry.metadata_invalid');
  }
  const rawTags = value['dist-tags'];
  const rawVersions = value.versions;
  if (!rawTags || typeof rawTags !== 'object' || !rawVersions || typeof rawVersions !== 'object') {
    throw new Error('promotion_registry.metadata_invalid');
  }
  return {
    distTags: Object.fromEntries(
      Object.entries(rawTags).filter(([tag, version]) => typeof tag === 'string' && typeof version === 'string'),
    ),
    versions: rawVersions,
  };
}

function verifyTag(metadata, tag, version, integrity) {
  if (metadata.distTags[tag] !== version) throw new Error('promotion_registry.tag_mismatch');
  verifyVersionIntegrity(metadata, version, integrity);
}

function verifyVersionIntegrity(metadata, version, integrity) {
  if (metadata.versions?.[version]?.dist?.integrity !== integrity) {
    throw new Error('promotion_registry.integrity_mismatch');
  }
}

function buildDryRunActions(snapshots) {
  return snapshots.flatMap((snapshot) => MUTATION_TAGS.map((tag) => action(
    'verify_tag',
    snapshot.name,
    tag,
    snapshot.distTags[tag] ?? null,
    snapshot.version,
    snapshot.distTags[tag] === snapshot.version ? 'already_target' : 'would_set_after_authorization',
  )));
}

function toSanitizedSnapshot(snapshot) {
  return {
    name: snapshot.name,
    version: snapshot.version,
    integrity: snapshot.integrity,
    distTags: {
      next: snapshot.distTags.next ?? null,
      latest: snapshot.distTags.latest ?? null,
    },
  };
}

function action(kind, packageName, tag, previousVersion, targetVersion, status) {
  return { kind, packageName, tag, previousVersion, targetVersion, status };
}

function sanitizeFailure(error) {
  const code = error instanceof Error && /^[a-z0-9_.-]{3,160}$/i.test(error.message)
    ? error.message
    : 'promotion_execution.unknown_failure';
  return { code };
}

async function runCli() {
  const mode = process.env.PROMPTFRAME_AUTHORING_PROMOTION_MODE ?? 'dry-run';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const receipt = await readAuthoringPromotionReceipt(undefined, { root });
  await validateReceiptAgainstRepository(receipt, { root });
  let mutator = null;
  try {
    if (mode !== 'dry-run') {
      mutator = await createNpmTagMutator({
        token: process.env.NPM_DIST_TAG_PROMOTION_TOKEN,
        runnerTemp: process.env.RUNNER_TEMP,
      });
    }
    const result = await executeAuthoringPromotion({ receipt, mode, mutator });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const result = error instanceof AuthoringPromotionExecutionError
      ? error.receipt
      : {
          schemaVersion: 'promptframe-authoring-promotion-execution/v1',
          status: 'failed_closed',
          failure: sanitizeFailure(error),
          sanitized: true,
        };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
  } finally {
    await mutator?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
