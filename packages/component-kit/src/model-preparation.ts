import {PromptFrameModelError} from '@promptframe/contracts';

export class ModelPreparationError extends Error {
  constructor(readonly code: 'model.preparation_timeout' | 'model.preparation_cancelled' | 'model.preparation_failed') {
    super(code); this.name = 'ModelPreparationError';
  }
}

type PreparationClock = {schedule(callback: () => void, milliseconds: number): () => void};
const clock: PreparationClock = {schedule(callback, milliseconds) {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
}};

/** Internal coordinator. Admission remains in the original model reader.
 * A cancelled parser may settle later; that value is retired, never adopted. */
export function createModelPreparation<T>(input: {
  read(signal: AbortSignal): Promise<ArrayBuffer>;
  prepare(bytes: ArrayBuffer, signal: AbortSignal): T | Promise<T>;
  dispose(value: T): void;
  clock?: PreparationClock;
}) {
  const controller = new AbortController();
  let owned: {value: T; disposed: boolean} | undefined;
  const dispose = () => {
    if (!owned || owned.disposed) return;
    owned.disposed = true;
    try { input.dispose(owned.value); }
    catch { console.error('model.release_failed'); }
  };
  const cancel = () => {
    controller.abort(new ModelPreparationError('model.preparation_cancelled'));
    dispose();
  };
  const promise = new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      stopTimer();
      reject(controller.signal.reason);
    };
    const stopTimer = (input.clock ?? clock).schedule(() => {
      controller.abort(new ModelPreparationError('model.preparation_timeout'));
    }, 15000);
    controller.signal.addEventListener('abort', onAbort, {once: true});
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      const bytes = await input.read(controller.signal);
      if (controller.signal.aborted) return;
      const value = await input.prepare(bytes, controller.signal);
      owned = {value, disposed: false};
      if (controller.signal.aborted) { dispose(); return; }
      resolve(value);
    }).catch(error => {
      reject(error instanceof PromptFrameModelError ? error : new ModelPreparationError('model.preparation_failed'));
    }).finally(() => {
      stopTimer();
      controller.signal.removeEventListener('abort', onAbort);
    });
  });
  return {promise, cancel};
}
