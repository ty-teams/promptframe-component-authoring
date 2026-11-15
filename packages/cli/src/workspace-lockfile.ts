import {createHash} from 'node:crypto';
import {existsSync, lstatSync, realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, isAbsolute, join, relative, sep} from 'node:path';
import {parseDocument} from 'yaml';
import {captureDevelopmentFiles} from './development-files.js';

const picomatch = createRequire(import.meta.url)('picomatch') as (pattern: string, options: {dot: boolean}) => (name: string) => boolean;
const limits = {maximumFiles: 3, maximumBytes: 16 * 1024 * 1024};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Dictionary = Record<string, unknown>;
const object = (value: unknown): value is Dictionary => !!value && typeof value === 'object' && !Array.isArray(value);
function denied(code: string): never {throw new Error('workspace.lockfile.' + code);}
const local = (value: string) => value.split(sep).join('/');

export interface PnpmWorkspaceLockCapture {
  readonly root: string;
  readonly importer: string;
  readonly relativePath: string;
  readonly workspaceBytes: Uint8Array;
  readonly lockBytes: Uint8Array;
  readonly paths: readonly string[];
  verifyUnchanged(): void;
}

/** Only the two named pnpm controls and this component's package.json may be
 * read outside the selected work. No ancestor source tree is captured. A
 * workspace declaration alone is insufficient: the actual importer must own
 * the component's current dependency specifications. */
export function capturePnpmWorkspaceLock(directory: string): PnpmWorkspaceLockCapture | undefined {
  const component = realpathSync(directory);
  for (let current = component, depth = 0; depth < 32; depth++, current = dirname(current)) {
    if (existsSync(join(current, 'pnpm-workspace.yaml')) && existsSync(join(current, 'pnpm-lock.yaml'))) {
      const importer = local(relative(current, component)) || '.';
      if (importer === '..' || importer.startsWith('../') || isAbsolute(importer)) denied('outside_root');
      const paths = ['pnpm-workspace.yaml', 'pnpm-lock.yaml', local(relative(current, join(component, 'package.json')))];
      const declared = captureDevelopmentFiles(current, [paths[0]!], limits).readFiles()[0]!.bytes;
      const workspace = yaml(declared);
      if (!object(workspace)) denied('invalid');
      const inputPatterns = workspace.packages ?? ['**'];
      if (!Array.isArray(inputPatterns) || inputPatterns.length === 0 || inputPatterns.length > 256
        || !inputPatterns.every(pattern => typeof pattern === 'string' && pattern.length > 0 && pattern.length <= 512
          && !pattern.includes('\\') && !isAbsolute(pattern.replace(/^!/, ''))
          && !pattern.replace(/^!/, '').split('/').includes('..'))) denied('workspace_invalid');
      const patterns = inputPatterns as string[];
      const positive = patterns.filter(pattern => !pattern.startsWith('!'));
      const negative = patterns.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1));
      if (importer !== '.' && (!positive.some(pattern => picomatch(pattern, {dot: true})(importer))
        || negative.some(pattern => picomatch(pattern, {dot: true})(importer)))) denied('owner_mismatch');
      const capturedByPath = new Map(captureDevelopmentFiles(current, paths, limits).readFiles().map(file => [file.path, file]));
      const captured = paths.map(name => capturedByPath.get(name)!);
      const workspaceBytes = captured[0]!.bytes, lockBytes = captured[1]!.bytes;
      if (digest(workspaceBytes) !== digest(declared)) denied('changed_during_read');
      const lock = yaml(lockBytes);
      if (!object(lock)) denied('invalid');
      if (!['string', 'number'].includes(typeof lock.lockfileVersion)
        || !/^[0-9]+(?:\.[0-9]+)?$/u.test(String(lock.lockfileVersion))) denied('invalid');
      if (!object(lock.importers) || !Object.hasOwn(lock.importers, importer)
        || !object(lock.importers[importer])) denied('importer_missing');
      const entry = lock.importers[importer] as Dictionary;
      let manifest: unknown;
      try {manifest = JSON.parse(Buffer.from(captured[2]!.bytes).toString('utf8'));} catch {denied('package_invalid');}
      if (!object(manifest)) denied('package_invalid');
      validateDependencies(manifest as Dictionary, entry);
      const hashes = captured.map(file => digest(file.bytes));
      const root = current;
      return Object.freeze({root, importer, relativePath: local(relative(component, join(root, 'pnpm-lock.yaml'))),
        workspaceBytes, lockBytes, paths: Object.freeze(paths.slice(0, 2).map(name => join(root, name))),
        verifyUnchanged() {
          // Recheck ownership as well as bytes. A changed selection never
          // silently falls back to a different ancestor lock.
          const next = capturePnpmWorkspaceLock(component);
          if (!next || next.root !== root || next.importer !== importer
            || next.relativePath !== local(relative(component, join(root, 'pnpm-lock.yaml')))
            || digest(next.workspaceBytes) !== hashes[0] || digest(next.lockBytes) !== hashes[1]) denied('changed_during_read');
          const packageBytes = captureDevelopmentFiles(root, [paths[2]!], limits).readFiles()[0]!.bytes;
          if (digest(packageBytes) !== hashes[2]) denied('changed_during_read');
        }});
    }
    // Never borrow a lock outside the nearest repository, or the filesystem.
    if (existsSync(join(current, '.git')) || dirname(current) === current) return undefined;
    if (lstatSync(current).isSymbolicLink()) denied('symlink');
  }
  return undefined;
}
function yaml(bytes: Uint8Array): unknown {
  const document = parseDocument(Buffer.from(bytes).toString('utf8'), {uniqueKeys: true, strict: true});
  if (document.errors.length || document.warnings.length) denied('invalid');
  try {return document.toJS({maxAliasCount: 100}) as unknown;} catch {return denied('invalid');}
}
function validateDependencies(manifest: Dictionary, importer: Dictionary): void {
  const peers = object(manifest.peerDependencies) ? manifest.peerDependencies : {};
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const requested = manifest[group] ?? {}, locked = importer[group] ?? {};
    if (!object(requested) || !object(locked)) denied('importer_stale');
    for (const [name, specifier] of Object.entries(requested as Dictionary)) {
      const row = (locked as Dictionary)[name];
      if (typeof specifier !== 'string' || !object(row) || row.specifier !== specifier
        || typeof row.version !== 'string' || !row.version) denied('importer_stale');
    }
    for (const [name, row] of Object.entries(locked as Dictionary)) {
      if (!Object.hasOwn(requested as Dictionary, name)
        && (!object(row) || row.specifier !== peers[name])) denied('importer_stale');
    }
  }
}
