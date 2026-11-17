/** One bounded, cancellable preparation. A rejected/cancelled producer may
 * still settle: retire that value without ever adopting it. */
export function createVisualPreparation<T>(input: {
  prepare(signal: AbortSignal): T | Promise<T>;
  dispose(value: T): void;
  error(kind: 'timeout' | 'cancelled' | 'failed', cause?: unknown): Error;
  clock?: {schedule(callback: () => void, milliseconds: number): () => void};
}) {
  const controller = new AbortController();
  let owned: {value: T; disposed: boolean} | undefined;
  const dispose = () => {
    if (!owned || owned.disposed) return;
    owned.disposed = true;
    try { input.dispose(owned.value); } catch { console.error('preparation.release_failed'); }
  };
  const promise = new Promise<T>((resolve, reject) => {
    const onAbort = () => { stopTimer(); reject(controller.signal.reason); };
    const stopTimer = (input.clock?.schedule ?? ((callback, milliseconds) => {
      const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer);
    }))(() => controller.abort(input.error('timeout')), 15000);
    controller.signal.addEventListener('abort', onAbort, {once: true});
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      const value = await input.prepare(controller.signal);
      owned = {value, disposed: false};
      if (controller.signal.aborted) { dispose(); return; }
      resolve(value);
    }).catch(error => reject(input.error('failed', error))).finally(() => {
      stopTimer(); controller.signal.removeEventListener('abort', onAbort);
    });
  });
  return {promise, cancel() { controller.abort(input.error('cancelled')); dispose(); }};
}
