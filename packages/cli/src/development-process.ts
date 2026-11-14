import { spawn } from 'node:child_process';
import type {DevelopmentTemporaryRoot} from './development-temporary.js';

export class DevelopmentProcessError extends Error {
  constructor(readonly code: string, readonly diagnosticCode?: string) {
    super(code); this.name = 'DevelopmentProcessError';
  }
}

/** A bounded compiler/checker process, never a component execution sandbox. */
export function runDevelopmentProcess(options: {
  worker: string; cwd: string; input: string; timeoutMs: number;
  maximumOutputBytes: number; signal?: AbortSignal;temporary?:DevelopmentTemporaryRoot;
}): Promise<string> {
  options.signal?.throwIfAborted();
  options.temporary?.beforeSpawn();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [options.worker], {
      cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'],
      detached:Boolean(options.temporary&&process.platform==='linux'),
      env: { NO_COLOR: '1', NODE_ENV: 'development',
        ...(process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    });
    let failed = false, firstError: unknown, total = 0,spawnError=false;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const fail = (error: unknown) => {
      if (!failed) { failed = true; firstError = error; }
      child.kill('SIGKILL');
    };
    const receive = (target: Buffer[], chunk: Buffer) => {
      total += chunk.length;
      if (total > options.maximumOutputBytes) return fail(new DevelopmentProcessError('development.build.output_limit'));
      target.push(chunk);
    };
    child.stdout.on('data', chunk => receive(stdout, chunk));
    child.stderr.on('data', chunk => receive(stderr, chunk));
    child.stdin.on('error', error => { if (!failed) fail(error); });
    child.once('error', error=>{spawnError=true;fail(error);});
    const abort = () => fail(options.signal!.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => fail(new DevelopmentProcessError('development.build.timeout')), options.timeoutMs);
    child.once('close', code => {
      clearTimeout(timeout); options.signal?.removeEventListener('abort', abort);
      try{options.temporary?.joined({notStarted:spawnError&&child.pid===undefined});}catch(error){if(!failed){failed=true;firstError=error;}}
      if (failed) return reject(firstError);
      if (code === 0) return resolve(Buffer.concat(stdout).toString('utf8'));
      let diagnosticCode: string | undefined;
      try {
        const parsed = JSON.parse(Buffer.concat(stderr).toString('utf8')) as { code?: unknown };
        if (typeof parsed.code === 'string' && /^development\.[a-z0-9_.]{1,180}$/u.test(parsed.code)) diagnosticCode = parsed.code;
      } catch { /* Raw compiler paths/output are not public diagnostics. */ }
      reject(new DevelopmentProcessError('development.build.rejected', diagnosticCode));
    });
    try{options.temporary?.spawned(child.pid);}catch(error){fail(error);}
    child.stdin.end(failed?undefined:options.input);
    if (options.signal?.aborted) abort();
  });
}
