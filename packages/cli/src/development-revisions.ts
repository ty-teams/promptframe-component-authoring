import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export interface DevelopmentFile {
  path: string;
  bytes: Uint8Array;
}

export interface DevelopmentLimits {
  maximumFiles: number;
  maximumBytes: number;
}

/** A private copy of one complete input set, including declared dependencies. */
export class DevelopmentContents {
  readonly revision: string;
  readonly byteLength: number;
  readonly #files: ReadonlyArray<Readonly<{ path: string; base64: string }>>;

  constructor(files: readonly DevelopmentFile[], limits: DevelopmentLimits) {
    if (!Number.isSafeInteger(limits.maximumFiles) || limits.maximumFiles < 1
      || !Number.isSafeInteger(limits.maximumBytes) || limits.maximumBytes < 1) {
      throw new Error('development.contents.invalid_limits');
    }
    if (!files.length || files.length > limits.maximumFiles) {
      throw new Error('development.contents.file_count');
    }
    const names = new Set<string>();
    let total = 0;
    const captured = files.map(file => {
      const name = file.path;
      if (!name || name.length > 1024 || name.includes('\\') || name.includes('\0')
        || posix.isAbsolute(name) || posix.normalize(name) !== name
        || name.split('/').some(part => part === '.' || part === '..' || !part)
        || names.has(name)) {
        throw new Error('development.contents.invalid_path');
      }
      names.add(name);
      if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength > limits.maximumBytes - total) {
        throw new Error('development.contents.byte_limit');
      }
      total += file.bytes.byteLength;
      // Copy now: a caller's Buffer must not change what was checked later.
      return { path: name, bytes: Buffer.from(file.bytes) };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const hash = createHash('sha256').update('promptframe-development-contents/v1\0');
    this.#files = Object.freeze(captured.map(file => {
      hash.update(`${Buffer.byteLength(file.path)}:`).update(file.path)
        .update(`${file.bytes.length}:`).update(file.bytes);
      return Object.freeze({ path: file.path, base64: file.bytes.toString('base64') });
    }));
    this.revision = `sha256:${hash.digest('hex')}`;
    this.byteLength = total;
    Object.freeze(this);
  }

  /** Consumers receive independent bytes; the checked capture remains immutable. */
  readFiles(): DevelopmentFile[] {
    return this.#files.map(file => ({ path: file.path, bytes: Buffer.from(file.base64, 'base64') }));
  }
}

export interface DevelopmentCheck {
  readonly moduleId: string;
  readonly sourceRevision: string;
  readonly sequence: number;
}

export interface CheckedDevelopmentModule {
  readonly moduleId: string;
  readonly sourceRevision: string;
  readonly checkerKey: string;
  readonly artifacts: DevelopmentContents;
}

export interface DevelopmentModuleState {
  readonly moduleId: string;
  readonly sourceRevision: string;
  readonly status: 'checking' | 'checked' | 'failed';
  readonly diagnostic?: string;
  /** Passed checks, not an assertion that a Player has loaded this revision. */
  readonly lastChecked?: CheckedDevelopmentModule;
}

/**
 * Adoption only. The caller captures dependencies, runs the common checks/build,
 * and recaptures current inputs before publish/reject. Watcher events alone do
 * not authorize a revision. This helper never executes component code.
 */
export class DevelopmentRevisionGate {
  readonly #states = new Map<string, { check: DevelopmentCheck; state: DevelopmentModuleState }>();
  readonly #checkerKey: string;
  readonly #maximumModules: number;
  #sequence = 0;

  constructor(options: { checkerKey: string; maximumModules: number }) {
    if (!options.checkerKey.trim() || options.checkerKey.length > 512
      || !Number.isSafeInteger(options.maximumModules) || options.maximumModules < 1) {
      throw new Error('development.registry.invalid_options');
    }
    this.#checkerKey = options.checkerKey;
    this.#maximumModules = options.maximumModules;
  }

  begin(moduleId: string, source: DevelopmentContents): DevelopmentCheck {
    if (!moduleId.trim() || moduleId.length > 256 || /[\u0000-\u001f]/.test(moduleId)) {
      throw new Error('development.module.invalid_identity');
    }
    const previous = this.#states.get(moduleId);
    if (!previous && this.#states.size >= this.#maximumModules) {
      throw new Error('development.registry.module_limit');
    }
    const check = Object.freeze({ moduleId, sourceRevision: source.revision, sequence: ++this.#sequence });
    this.#states.set(moduleId, { check, state: Object.freeze({
      moduleId, sourceRevision: source.revision, status: 'checking',
      ...(previous?.state.lastChecked ? { lastChecked: previous.state.lastChecked } : {}),
    }) });
    return check;
  }

  publish(check: DevelopmentCheck, current: DevelopmentContents, artifacts: DevelopmentContents): boolean {
    const entry = this.currentCheck(check, current);
    if (!entry) return false;
    const lastChecked = Object.freeze({ moduleId: check.moduleId,
      sourceRevision: check.sourceRevision, checkerKey: this.#checkerKey, artifacts });
    entry.state = Object.freeze({ moduleId: check.moduleId,
      sourceRevision: check.sourceRevision, status: 'checked', lastChecked });
    return true;
  }

  reject(check: DevelopmentCheck, current: DevelopmentContents, diagnostic: string): boolean {
    const entry = this.currentCheck(check, current);
    if (!entry) return false;
    entry.state = Object.freeze({ ...entry.state, status: 'failed',
      diagnostic: diagnostic.slice(0, 1024) || 'development.check.failed' });
    return true;
  }

  state(moduleId: string): DevelopmentModuleState | undefined {
    return this.#states.get(moduleId)?.state;
  }

  remove(moduleId: string): void {
    // A late completion retains its old token and cannot recreate this entry.
    this.#states.delete(moduleId);
  }

  private currentCheck(check: DevelopmentCheck, current: DevelopmentContents) {
    const entry = this.#states.get(check.moduleId);
    if (!entry || entry.check !== check || entry.state.status !== 'checking') return undefined;
    if (current.revision !== check.sourceRevision) {
      // Even a missed final filesystem notification cannot publish old bytes.
      this.begin(check.moduleId, current);
      return undefined;
    }
    return entry;
  }
}
