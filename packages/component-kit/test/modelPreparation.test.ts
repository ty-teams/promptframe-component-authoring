import assert from 'node:assert/strict';
import test from 'node:test';
import {PromptFrameModelError} from '@promptframe/contracts';
import {createModelPreparation, ModelPreparationError} from '../src/model-preparation.js';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
function fakeClock() {
  const callbacks = new Set<() => void>(), budgets: number[] = [];
  return {callbacks, budgets, schedule(callback: () => void, milliseconds: number) {
    budgets.push(milliseconds); callbacks.add(callback);
    return () => {callbacks.delete(callback);};
  }, fire() {for (const callback of [...callbacks]) callback();}};
}
const tick = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};

test('model preparation waits for actual bytes and parser, then retires its value once', async () => {
  const bytes = deferred<ArrayBuffer>(), parsed = deferred<object>(), clock = fakeClock();
  let calls = 0, disposed = 0;
  const task = createModelPreparation({read: () => bytes.promise,
    prepare: async data => {assert.equal(data.byteLength, 4); calls++; return parsed.promise;},
    dispose: () => {disposed++;}, clock});
  await tick(); assert.equal(calls, 0); bytes.resolve(new ArrayBuffer(4)); await tick();
  assert.equal(calls, 1); assert.equal(disposed, 0);
  const model = {}; parsed.resolve(model); assert.equal(await task.promise, model); await tick();
  assert.deepEqual(clock.budgets, [15000]); assert.equal(clock.callbacks.size, 0);
  task.cancel(); task.cancel(); assert.equal(disposed, 1);
});
test('a reader identity rejection never invokes the author parser', async () => {
  const clock = fakeClock(); let calls = 0;
  const task = createModelPreparation({read: async () => {throw new PromptFrameModelError('model.identity_mismatch');},
    prepare: () => {calls++;}, dispose: () => {}, clock});
  await assert.rejects(task.promise, (error: unknown) => error instanceof PromptFrameModelError && error.code === 'model.identity_mismatch');
  await tick(); assert.equal(calls, 0); assert.equal(clock.callbacks.size, 0);
});
test('cancelling before read does not start IO or parsing', async () => {
  const clock = fakeClock(); let calls = 0;
  const task = createModelPreparation({read: async () => {calls++; return new ArrayBuffer(1);},
    prepare: () => {calls++;}, dispose: () => {}, clock});
  const rejected = assert.rejects(task.promise, (error: unknown) => error instanceof ModelPreparationError && error.code === 'model.preparation_cancelled');
  task.cancel(); await rejected; await tick(); assert.equal(calls, 0); assert.equal(clock.callbacks.size, 0);
});
test('late bytes after cancellation cannot start parsing', async () => {
  const bytes = deferred<ArrayBuffer>(), clock = fakeClock(); let calls = 0;
  const task = createModelPreparation({read: () => bytes.promise,
    prepare: () => {calls++;}, dispose: () => {}, clock});
  await tick(); const rejected = assert.rejects(task.promise, ModelPreparationError); task.cancel();
  bytes.resolve(new ArrayBuffer(2)); await rejected; await tick(); assert.equal(calls, 0);
});
test('the whole read plus parser shares one finite deadline and disposes late geometry', async () => {
  const parsed = deferred<object>(), clock = fakeClock(); let signal: AbortSignal | undefined, disposed = 0;
  const task = createModelPreparation({read: async received => {signal = received; return new ArrayBuffer(1);},
    prepare: () => parsed.promise, dispose: () => {disposed++;}, clock});
  await tick(); const rejected = assert.rejects(task.promise, (error: unknown) => error instanceof ModelPreparationError && error.code === 'model.preparation_timeout');
  clock.fire(); await rejected; assert.equal(signal?.aborted, true);
  parsed.resolve({}); await tick(); assert.equal(disposed, 1); assert.equal(clock.callbacks.size, 0);
  task.cancel(); assert.equal(disposed, 1);
});
test('arbitrary parser exception text is not a public diagnostic', async () => {
  const clock = fakeClock();
  const task = createModelPreparation({read: async () => new ArrayBuffer(1),
    prepare: () => {throw new Error('https://private.invalid/?credential=hidden');}, dispose: () => {}, clock});
  await assert.rejects(task.promise, (error: unknown) => error instanceof ModelPreparationError
    && error.code === 'model.preparation_failed' && !error.message.includes('private'));
  await tick(); assert.equal(clock.callbacks.size, 0);
});
test('an older cancelled preparation cannot supply the newer preparation result', async () => {
  const parsed = deferred<string>(), clock = fakeClock(), retired: string[] = [];
  const old = createModelPreparation({read: async () => new ArrayBuffer(1), prepare: () => parsed.promise, dispose: value => {retired.push(value);}, clock});
  await tick(); const rejected = assert.rejects(old.promise, ModelPreparationError); old.cancel();
  const current = createModelPreparation({read: async () => new ArrayBuffer(2), prepare: () => 'current', dispose: value => {retired.push(value);}, clock});
  assert.equal(await current.promise, 'current'); parsed.resolve('old'); await rejected; await tick();
  assert.deepEqual(retired, ['old']); current.cancel(); assert.deepEqual(retired, ['old', 'current']);
});
