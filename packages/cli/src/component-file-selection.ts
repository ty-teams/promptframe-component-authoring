import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';

const excluded = new Set(['node_modules', 'dist', '.git', '.component-packages', '.promptframe']);
type Rule = { root: string; matcher: Ignore };
export class ComponentFileSelectionError extends Error {
  constructor(readonly code: string, readonly description: string = code) { super(code); }
}

function readIgnore(root: string, directory: string): { rule: Rule; bytes: Buffer } | undefined {
  const file = join(directory, '.gitignore');
  if (!existsSync(file)) return undefined;
  const checkDirectory = () => {
    const local = relative(realpathSync(root), realpathSync(directory));
    if (local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new ComponentFileSelectionError('development.capture.outside_root');
    for (let current = directory;; current = dirname(current)) {
      const entry = lstatSync(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new ComponentFileSelectionError('development.capture.symlink');
      if (current === root) break;
      if (current === dirname(current)) throw new ComponentFileSelectionError('development.capture.outside_root');
    }
  };
  checkDirectory();
  if (!lstatSync(file).isFile()) throw new ComponentFileSelectionError('package.gitignore.invalid', '.gitignore must be an ordinary package-local file.');
  const descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size > 1024n * 1024n) throw new ComponentFileSelectionError('package.gitignore.invalid');
    const bytes = Buffer.alloc(Number(before.size) + 1); let used = 0;
    while (used < bytes.length) { const count = readSync(descriptor, bytes, used, bytes.length - used, null); if (!count) break; used += count; }
    const after = fstatSync(descriptor, { bigint: true }), current = lstatSync(file, { bigint: true });
    checkDirectory();
    if (used !== Number(before.size) || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => {
      const field = key as 'dev' | 'ino' | 'size' | 'mtimeNs' | 'ctimeNs';
      return before[field] !== after[field] || after[field] !== current[field];
    })) throw new ComponentFileSelectionError('development.capture.changed_during_read');
    return { rule: { root: directory, matcher: ignore({ ignorecase: false }).add(bytes.subarray(0, used).toString('utf8')) }, bytes: bytes.subarray(0, used) };
  } finally { closeSync(descriptor); }
}

function isIgnored(file: string, directory: boolean, rules: readonly Rule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    const result = rule.matcher.test(relative(rule.root, file).replace(/\\/g, '/') + (directory ? '/' : ''));
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

/** Package and dev share module-local and nested ignore semantics. Ancestor
 * workspace ignores are not implicitly imported into an individual module. */
export function selectComponentSourceFiles(root: string, requiredPaths: ReadonlySet<string>, options: {
  maximumFiles?: number; maximumEntries?: number; maximumDepth?: number; rejectSpecialFiles?: boolean;
} = {}): { paths: string[]; ignoreInputs: Array<{ path: string; sha256: string }> } {
  const paths: string[] = [], ignoreInputs: Array<{ path: string; sha256: string }> = [];
  let entries = 0;
  const walk = (directory: string, inherited: readonly Rule[], depth: number): void => {
    if (depth > (options.maximumDepth ?? Infinity)) throw new ComponentFileSelectionError('development.capture.directory_limit');
    const local = readIgnore(root, directory), rules = local ? [...inherited, local.rule] : inherited;
    if (local) ignoreInputs.push({ path: relative(root, join(directory, '.gitignore')).replace(/\\/g, '/'),
      sha256: 'sha256:' + createHash('sha256').update(local.bytes).digest('hex') });
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++entries > (options.maximumEntries ?? Infinity)) throw new ComponentFileSelectionError('development.capture.directory_limit');
      if (excluded.has(entry.name)) continue;
      const full = join(directory, entry.name), name = relative(root, full).replace(/\\/g, '/');
      if (isIgnored(full, entry.isDirectory(), rules)) {
        if ([...requiredPaths].some(path => path === name || entry.isDirectory() && path.startsWith(name + '/'))
          || name === 'public' || name.startsWith('public/')) throw new ComponentFileSelectionError('package.required_file.ignored',
          `.gitignore excludes required component content: ${name}. Remove that rule or explicitly include the required source/resource.`);
        continue;
      }
      if (entry.isDirectory()) walk(full, rules, depth + 1);
      else if (entry.isFile()) paths.push(name);
      else if (options.rejectSpecialFiles) throw new ComponentFileSelectionError(entry.isSymbolicLink() ? 'development.capture.symlink' : 'development.capture.not_file');
      if (paths.length > (options.maximumFiles ?? Infinity)) throw new ComponentFileSelectionError('development.contents.file_count');
    }
  };
  walk(root, [], 0);
  return { paths: paths.sort(), ignoreInputs };
}

/** Deleted paths use the same rules without reopening the deleted source.
 * Changes to active ignore controls still invalidate the selected snapshot. */
export function isComponentSourcePathIgnored(root: string, name: string): boolean {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')) return false;
  const parts = name.split('/'), rules: Rule[] = []; let directory = root;
  for (let index = 0; index < parts.length; index++) {
    if (excluded.has(parts[index]!)) return true;
    const local = readIgnore(root, directory); if (local) rules.push(local.rule);
    const full = resolve(directory, parts[index]!);
    if (index === parts.length - 1 && parts[index] === '.gitignore') return false;
    if (isIgnored(full, index < parts.length - 1, rules)) return true;
    directory = full;
  }
  return false;
}
