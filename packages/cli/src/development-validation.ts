import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DevelopmentContents } from './development-revisions.js';

export interface DevelopmentValidationReceipt {
  readonly sourceRevision: string;
  readonly securityPolicyVersion: string;
  readonly securityPolicyDigest: string;
  readonly securityEvaluatorMode: 'ast';
  readonly checkedRuleIds: readonly string[];
}

export class DevelopmentValidationError extends Error {
  constructor(readonly code: string, readonly diagnosticCode?: string) {
    super(code); this.name = 'DevelopmentValidationError';
  }
}

/** The ordinary CLI validates a private materialization of the capture. It
 * never reopens the live workspace, runs package scripts, or grants a platform
 * admission. The caller must still build these bytes, recapture and publish. */
export async function validateDevelopmentContents(
  contents: DevelopmentContents,
  options: { temporaryParent?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<DevelopmentValidationReceipt> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new DevelopmentValidationError('development.validation.invalid_timeout');
  }
  options.signal?.throwIfAborted();
  const files = contents.readFiles();
  for (const file of files) {
    if (file.path.split('/').some(part => ['node_modules', 'dist', '.git', '.component-packages', '.promptframe'].includes(part))) {
      throw new DevelopmentValidationError('development.validation.excluded_input');
    }
  }
  const directory = await mkdtemp(join(options.temporaryParent ?? tmpdir(), 'promptframe-check-'));
  let hadFailure = false;
  try {
    for (const file of files) {
      options.signal?.throwIfAborted();
      const path = join(directory, ...file.path.split('/'));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.bytes, { flag: 'wx', mode: 0o400 });
    }
    const result = await runCapturedValidation(directory, timeoutMs, options.signal);
    const output = JSON.parse(result) as Record<string, unknown>;
    if (output.command !== 'validate' || output.securityEvaluatorMode !== 'ast'
      || typeof output.securityPolicyVersion !== 'string' || typeof output.securityPolicyDigest !== 'string'
      || !Array.isArray(output.checkedRuleIds) || !output.checkedRuleIds.every(rule => typeof rule === 'string')) {
      throw new DevelopmentValidationError('development.validation.invalid_receipt');
    }
    return Object.freeze({ sourceRevision: contents.revision,
      securityPolicyVersion: output.securityPolicyVersion, securityPolicyDigest: output.securityPolicyDigest,
      securityEvaluatorMode: 'ast', checkedRuleIds: Object.freeze([...output.checkedRuleIds]) });
  } catch (error) {
    hadFailure = true; throw error;
  } finally {
    // runCapturedValidation waits for actual child close, also after abort or
    // timeout. Its reader cannot outlive this private input directory.
    try { await rm(directory, { recursive: true, force: true }); }
    catch (error) {
      if (!hadFailure) throw error;
      process.stderr.write(JSON.stringify({ code: 'development.validation.cleanup_failed', directory }) + '\n');
    }
  }
}

function runCapturedValidation(directory: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url)), 'validate', directory, '--json'], {
      cwd: directory, stdio: ['ignore', 'pipe', 'pipe'],
      // Validation is local. Neither endpoint/auth configuration nor arbitrary
      // Node preload options from the host belong in this subprocess.
      env: { NO_COLOR: '1', ...(process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    });
    let firstError: unknown, failed = false, total = 0;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const fail = (error: unknown) => {
      if (!failed) { failed = true; firstError = error; }
      child.kill('SIGKILL');
    };
    const receive = (target: Buffer[], chunk: Buffer) => {
      total += chunk.length;
      if (total > 512 * 1024) return fail(new DevelopmentValidationError('development.validation.output_limit'));
      target.push(chunk);
    };
    child.stdout.on('data', chunk => receive(stdout, chunk));
    child.stderr.on('data', chunk => receive(stderr, chunk));
    const abort = () => fail(signal!.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => fail(new DevelopmentValidationError('development.validation.timeout')), timeoutMs);
    child.once('error', error => { if (!failed) { failed = true; firstError = error; } });
    child.once('close', code => {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort);
      if (failed) return reject(firstError);
      if (code === 0) return resolve(Buffer.concat(stdout).toString('utf8'));
      let diagnosticCode: string | undefined;
      try {
        const output = JSON.parse(Buffer.concat(stderr).toString('utf8')) as { diagnostic?: { code?: unknown } };
        const candidate = output.diagnostic?.code;
        if (typeof candidate === 'string' && /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/u.test(candidate) && candidate.length <= 256) diagnosticCode = candidate;
      } catch { /* Unstructured child output is not a diagnostic contract. */ }
      reject(new DevelopmentValidationError('development.validation.rejected', diagnosticCode));
    });
    if (signal?.aborted) abort();
  });
}
