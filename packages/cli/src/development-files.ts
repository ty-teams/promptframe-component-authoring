import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { DevelopmentContents, type DevelopmentLimits } from './development-revisions.js';

/** Capture declared workspace inputs, never a live path for a compiler to reopen.
 * Generated output and node_modules are not discovered by this reader. The
 * workspace consumer supplies the complete, bounded source/dependency list. */
export function captureDevelopmentFiles(
  root: string,
  paths: readonly string[],
  limits: DevelopmentLimits,
): DevelopmentContents {
  // Reuse the content contract before performing any file I/O. These empty
  // bytes only validate names/count/options; they are never published.
  const names = new DevelopmentContents(paths.map(path => ({ path, bytes: new Uint8Array() })), limits)
    .readFiles().map(file => file.path);
  const base = realpathSync(root);
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  let total = 0;
  for (const name of names) {
    const file = resolve(base, ...name.split('/'));
    const withinRoot = () => {
      const local = relative(base, realpathSync(file));
      if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
        throw new Error('development.capture.outside_root');
      }
      // Source links, including directory links, are explicit errors. A
      // workspace alias resolves to declared real source paths before capture.
      for (let part = file; part !== base; part = dirname(part)) {
        const entry = lstatSync(part);
        if (entry.isSymbolicLink()) throw new Error('development.capture.symlink');
        if (part === file && !entry.isFile()) throw new Error('development.capture.not_file');
      }
    };
    withinRoot();
    // NONBLOCK also bounds a replacement by a FIFO between lstat and open.
    // fstat below still requires a regular file before any bytes are read.
    const descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const before = fstatSync(descriptor, { bigint: true });
      if (!before.isFile()) throw new Error('development.capture.not_file');
      const remaining = limits.maximumBytes - total;
      if (before.size > BigInt(remaining)) throw new Error('development.contents.byte_limit');
      // Read at most the observed size plus one probe byte. A concurrently
      // growing file cannot cause an unbounded readFile allocation.
      const bytes = Buffer.alloc(Number(before.size) + 1);
      let used = 0;
      while (used < bytes.length) {
        const count = readSync(descriptor, bytes, used, bytes.length - used, null);
        if (!count) break;
        used += count;
      }
      const after = fstatSync(descriptor, { bigint: true });
      withinRoot();
      const current = lstatSync(file, { bigint: true });
      if (used !== Number(before.size) || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => {
        const field = key as 'dev' | 'ino' | 'size' | 'mtimeNs' | 'ctimeNs';
        return before[field] !== after[field] || after[field] !== current[field];
      })) throw new Error('development.capture.changed_during_read');
      total += used;
      files.push({ path: name, bytes: bytes.subarray(0, used) });
    } finally { closeSync(descriptor); }
  }
  return new DevelopmentContents(files, limits);
}
