import { spawn } from 'node:child_process';

export class DevelopmentProcessError extends Error {
  constructor(readonly code: string, readonly diagnosticCode?: string) {
    super(code); this.name = 'DevelopmentProcessError';
  }
}

/** A bounded compiler/checker process, never a component execution sandbox. */
export function runDevelopmentProcess(options: {
  worker: string; cwd: string; input: string; timeoutMs: number;
  maximumOutputBytes: number; signal?: AbortSignal;
}): Promise<string> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [options.worker], {
      cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'],
      env: { NO_COLOR: '1', NODE_ENV: 'development',
        ...(process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    });
    let failed = false, firstError: unknown, total = 0;
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
    child.once('error', fail);
    const abort = () => fail(options.signal!.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => fail(new DevelopmentProcessError('development.build.timeout')), options.timeoutMs);
    child.once('close', code => {
      clearTimeout(timeout); options.signal?.removeEventListener('abort', abort);
      if (failed) return reject(firstError);
      if (code === 0) return resolve(Buffer.concat(stdout).toString('utf8'));
      let diagnosticCode: string | undefined;
      try {
        const parsed = JSON.parse(Buffer.concat(stderr).toString('utf8')) as { code?: unknown };
        if (typeof parsed.code === 'string' && /^development\.[a-z0-9_.]{1,180}$/u.test(parsed.code)) diagnosticCode = parsed.code;
      } catch { /* Raw compiler paths/output are not public diagnostics. */ }
      reject(new DevelopmentProcessError('development.build.rejected', diagnosticCode));
    });
    child.stdin.end(options.input);
    if (options.signal?.aborted) abort();
  });
}
