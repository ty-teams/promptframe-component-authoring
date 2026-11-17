import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useBufferState, useDelayRender} from 'remotion';
import {readPromptFrameModel, type PromptFrameRuntimeResourceProps} from './resources.js';
import {createModelPreparation} from './model-preparation.js';
import {createVisualPreparation} from './visual-preparation.js';

export class VisualPreparationError extends Error {
  constructor(readonly code: 'visual.preparation_timeout' | 'visual.preparation_cancelled' | 'visual.preparation_failed') {
    super(code); this.name = 'VisualPreparationError';
  }
}

/** Declare critical async visual work before a placeholder can paint. The
 * identity must change with its resource/version (and frame, if frame-specific).
 * Use stable callbacks. The value is ready only after the result commit's
 * synchronous layout effects have applied it and drawn the actual picture.
 * This grants no IO capability; use the original authorized resource readers. */
export function usePromptFramePreparation<T>(identity: unknown, options: {
  prepare(signal: AbortSignal): T | Promise<T>;
  dispose(value: T): void;
}): T | null {
  const scope = useMemo(() => ({identity, prepare: options.prepare, dispose: options.dispose}),
    [identity, options.prepare, options.dispose]);
  return usePreparedVisual(scope, () => createVisualPreparation({prepare: scope.prepare, dispose: scope.dispose,
    error: kind => new VisualPreparationError(`visual.preparation_${kind}`)}), 'PromptFrame critical visual preparation', identity !== null);
}

/** Bounded preparation of one currently host-bound GLB. The SDK owns render
 * readiness; author code receives neither a delay handle nor another IO API.
 * Keep prepare/dispose stable, for example with module functions/useCallback. */
export function usePromptFrameModel<T, Props extends object>(
  resourcesOrProps: Props | undefined,
  reference: string,
  options: {
    prepare(bytes: ArrayBuffer, signal: AbortSignal): T | Promise<T>;
    dispose(value: T): void;
  },
): T | null {
  const resources = (resourcesOrProps as PromptFrameRuntimeResourceProps | undefined)?.promptFrameResources ?? resourcesOrProps;
  const scope = useMemo(() => ({resources, reference, prepare: options.prepare, dispose: options.dispose}),
    [resources, reference, options.prepare, options.dispose]);
  return usePreparedVisual(scope, () => createModelPreparation({
    read: signal => readPromptFrameModel(scope.resources, scope.reference, {signal}),
    prepare: scope.prepare, dispose: scope.dispose,
  }), 'PromptFrame authorized GLB preparation');
}

function usePreparedVisual<T, S>(scope: S, create: () => {promise: Promise<T>; cancel(): void}, label: string, enabled = true): T | null {
  const [result, setResult] = useState<{scope: S; value: T} | null>(null);
  const [failure, setFailure] = useState<{scope: S; error: Error} | null>(null);
  const lifetime = useRef<{scope: S; release(): void} | null>(null);
  const {delayRender, continueRender, cancelRender} = useDelayRender();
  const {delayPlayback} = useBufferState();
  useLayoutEffect(() => {
    if (!enabled) return;
    let current = true, released = false;
    const handle = delayRender(label, {timeoutInMilliseconds: 16000, retries: 0});
    let playback: ReturnType<typeof delayPlayback>;
    try { playback = delayPlayback(); }
    catch (error) { continueRender(handle); throw error; }
    const release = () => {
      if (released) return;
      released = true; playback.unblock(); continueRender(handle);
    };
    lifetime.current = {scope, release};
    const load = create();
    void load.promise.then(value => {
      if (current) setResult({scope, value});
    }, error => {
      if (!current) return;
      setFailure({scope, error});
      release();
      // Remotion records its scoped cancellation and then throws. The same
      // typed failure also propagates through React, without an extra
      // unhandled Promise rejection.
      try { cancelRender(error); } catch { /* failure is stored above */ }
    });
    return () => {
      current = false; load.cancel(); release();
      if (lifetime.current?.scope === scope) lifetime.current = null;
    };
  }, [scope, enabled, delayRender, continueRender, cancelRender, delayPlayback]);
  useLayoutEffect(() => {
    if (result?.scope !== scope) return;
    let current = true;
    // The author mounts and draws this value in the rest of the same commit's
    // layout effects. Publish readiness only after that commit has completed;
    // a prepared parser result alone does not witness the first canvas draw.
    queueMicrotask(() => {
      if (current && lifetime.current?.scope === scope) lifetime.current.release();
    });
    return () => { current = false; };
  }, [result, scope]);
  if (failure?.scope === scope) throw failure.error;
  return result?.scope === scope ? result.value : null;
}
