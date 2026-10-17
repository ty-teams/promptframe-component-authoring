import { PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST } from '@promptframe/contracts';
import { buildDevelopmentContents, type DevelopmentBuildReceipt } from './development-build.js';
import { validateDevelopmentContents, type DevelopmentValidationReceipt } from './development-validation.js';
import { DevelopmentContents, DevelopmentRevisionGate, type CheckedDevelopmentModule } from './development-revisions.js';

interface CompilerOptions { signal?: AbortSignal }
interface DevelopmentCoordinatorOptions {
  maximumModules: number;
  capture(moduleId: string): DevelopmentContents | Promise<DevelopmentContents>;
  maximumAttempts?: number;
  /** Trusted composition ports, never supplied by component configs or HTTP. */
  validate?: (source: DevelopmentContents, options: CompilerOptions) => Promise<DevelopmentValidationReceipt>;
  build?: (source: DevelopmentContents, options: CompilerOptions) => Promise<DevelopmentBuildReceipt>;
}

/** Joins capture -> common checks -> captured Vite build -> current recapture.
 * It exposes checked bytes, never a claim that a Player has loaded them. */
export class DevelopmentModuleCoordinator {
  readonly #gate: DevelopmentRevisionGate;
  readonly #active = new Map<string, AbortController>();
  readonly #receipts = new WeakMap<CheckedDevelopmentModule, DevelopmentBuildReceipt>();
  readonly #attempts: number;
  readonly #capture: DevelopmentCoordinatorOptions['capture'];
  readonly #validate: NonNullable<DevelopmentCoordinatorOptions['validate']>;
  readonly #build: NonNullable<DevelopmentCoordinatorOptions['build']>;

  constructor(options: DevelopmentCoordinatorOptions) {
    this.#capture = options.capture;
    this.#validate = options.validate ?? validateDevelopmentContents;
    this.#build = options.build ?? buildDevelopmentContents;
    this.#attempts = options.maximumAttempts ?? 3;
    if (!Number.isSafeInteger(this.#attempts) || this.#attempts < 1 || this.#attempts > 8) {
      throw new Error('development.check.invalid_attempts');
    }
    this.#gate = new DevelopmentRevisionGate({ maximumModules: options.maximumModules,
      checkerKey: `captured-v1:${PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST}:vite/8.0.10` });
  }

  state(moduleId: string) { return this.#gate.state(moduleId); }
  buildReceipt(moduleId: string): DevelopmentBuildReceipt | undefined {
    const checked = this.#gate.state(moduleId)?.lastChecked;
    return checked ? this.#receipts.get(checked) : undefined;
  }

  async refresh(moduleId: string, options: CompilerOptions = {}): Promise<boolean> {
    this.#active.get(moduleId)?.abort(new Error('development.check.superseded'));
    const controller = new AbortController();
    this.#active.set(moduleId, controller);
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const currentRequest = () => this.#active.get(moduleId) === controller;
    try {
      let source = await this.#capture(moduleId);
      for (let attempt = 0; attempt < this.#attempts; attempt++) {
        if (!currentRequest()) return false;
        signal.throwIfAborted();
        const check = this.#gate.begin(moduleId, source);
        let build: DevelopmentBuildReceipt;
        try {
          const validation = await this.#validate(source, { signal });
          if (!currentRequest()) return false;
          signal.throwIfAborted();
          if (validation.sourceRevision !== source.revision) throw new Error('development.check.source_mismatch');
          build = await this.#build(source, { signal });
          if (build.sourceRevision !== source.revision) throw new Error('development.check.source_mismatch');
        } catch (error) {
          if (!currentRequest()) return false;
          signal.throwIfAborted();
          const current = await this.#capture(moduleId);
          if (!currentRequest()) return false;
          if (current.revision !== source.revision) {
            source = current; this.#gate.begin(moduleId, current); continue;
          }
          this.#gate.reject(check, current, diagnostic(error)); return false;
        }
        if (!currentRequest()) return false;
        signal.throwIfAborted();
        const current = await this.#capture(moduleId);
        if (!currentRequest()) return false;
        if (this.#gate.publish(check, current, build.artifacts)) {
          this.#receipts.set(this.#gate.state(moduleId)!.lastChecked!, build); return true;
        }
        source = current;
      }
      // Continuous changes remain visibly checking with explicit lastChecked.
      // The next event/manual refresh retries; no quiet-period sleep authorizes.
      return false;
    } catch (error) {
      if (currentRequest()) this.#gate.invalidate(moduleId,
        signal.aborted ? 'development.check.aborted' : diagnostic(error));
      return false;
    } finally {
      if (currentRequest()) this.#active.delete(moduleId);
    }
  }

  remove(moduleId: string): void {
    this.#active.get(moduleId)?.abort(new Error('development.check.removed'));
    this.#active.delete(moduleId); this.#gate.remove(moduleId);
  }
}

function diagnostic(error: unknown): string {
  if (error && typeof error === 'object') {
    for (const key of ['diagnosticCode', 'code', 'message']) {
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      if (typeof descriptor?.value === 'string' && /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/u.test(descriptor.value)
        && descriptor.value.length <= 256) return descriptor.value;
    }
  }
  return 'development.check.failed';
}
