import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DevelopmentContents } from './development-revisions.js';
import { DevelopmentProcessError, runDevelopmentProcess } from './development-process.js';

const outputLimits = Object.freeze({ maximumFiles: 512, maximumBytes: 8 * 1024 * 1024 });
export interface DevelopmentBuildReceipt {
  readonly sourceRevision: string;
  readonly builder: string;
  readonly artifacts: DevelopmentContents;
  readonly entries: Readonly<{ component: string; schema: string; index: string }>;
  /** Only explicitly shared host runtimes are external, never arbitrary npm imports. */
  readonly runtimeImports: readonly string[];
}

/** Compile the capture through a fixed Vite config and a closed virtual source
 * graph. No workspace files, child vite.config, scripts or node_modules are
 * resolved by the build. A build receipt alone does not assert a safety check. */
export async function buildDevelopmentContents(
  contents: DevelopmentContents,
  options: { temporaryParent?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<DevelopmentBuildReceipt> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new DevelopmentProcessError('development.build.invalid_timeout');
  }
  options.signal?.throwIfAborted();
  if (contents.byteLength > 16 * 1024 * 1024) throw new DevelopmentProcessError('development.build.input_limit');
  const files = contents.readFiles();
  if (files.length > 2048) throw new DevelopmentProcessError('development.build.input_limit');
  const input = JSON.stringify({ sourceRevision: contents.revision,
    files: files.map(file => ({ path: file.path, base64: Buffer.from(file.bytes).toString('base64') })) });
  const directory = await mkdtemp(join(options.temporaryParent ?? tmpdir(), 'promptframe-build-'));
  let hadFailure = false;
  try {
    const raw = await runDevelopmentProcess({
      worker: fileURLToPath(new URL('./development-build-worker.js', import.meta.url)),
      cwd: directory, input, timeoutMs, maximumOutputBytes: 20 * 1024 * 1024, signal: options.signal,
    });
    const result = JSON.parse(raw) as {
      sourceRevision: string; builder: string; files: Array<{ path: string; base64: string }>;
      entries: { component: string; schema: string; index: string }; runtimeImports: string[];
    };
    if (result.sourceRevision !== contents.revision || result.builder !== 'vite/8.0.10/captured-v1'
      || !Array.isArray(result.files) || !Array.isArray(result.runtimeImports)
      || !result.runtimeImports.every(id => typeof id === 'string') || !result.entries) {
      throw new DevelopmentProcessError('development.build.invalid_receipt');
    }
    const artifacts = new DevelopmentContents(result.files.map(file => ({
      path: file.path, bytes: Buffer.from(file.base64, 'base64'),
    })), outputLimits);
    const paths = new Set(artifacts.readFiles().map(file => file.path));
    if (!['component', 'schema', 'index'].every(key => paths.has(result.entries[key as keyof typeof result.entries]))) {
      throw new DevelopmentProcessError('development.build.invalid_entries');
    }
    return Object.freeze({ sourceRevision: contents.revision, builder: result.builder, artifacts,
      entries: Object.freeze({ ...result.entries }), runtimeImports: Object.freeze([...result.runtimeImports]) });
  } catch (error) {
    hadFailure = true; throw error;
  } finally {
    // The worker has actually closed before returning/throwing above. A cleanup
    // failure must not replace the original abort/compiler cause.
    try { await rm(directory, { recursive: true, force: true }); }
    catch (error) {
      if (!hadFailure) throw error;
      // Keep the first failure and make any retained private directory
      // actionable to its local owner; never print source/error bodies.
      process.stderr.write(JSON.stringify({ code: 'development.build.cleanup_failed', directory }) + '\n');
    }
  }
}
