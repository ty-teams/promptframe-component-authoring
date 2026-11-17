import assert from 'node:assert/strict';
import test from 'node:test';
import {createVisualPreparation} from '../src/visual-preparation.js';
const deferred = <T>() => {let resolve!: (v:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};};
const tick = async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const error=(kind:string)=>Error('visual.preparation_'+kind);

test('critical material is pending until decode, with one finite budget',async()=>{
  const texture=deferred<string>();let completed=false,expire!:()=>void,cleared=0,disposed=0;
  const task=createVisualPreparation({prepare:()=>texture.promise,dispose:()=>{disposed++;},error,
    clock:{schedule(fn,ms){assert.equal(ms,15000);expire=fn;return()=>{cleared++;};}}});
  void task.promise.then(()=>{completed=true;});await tick();assert.equal(completed,false);
  texture.resolve('decoded');assert.equal(await task.promise,'decoded');await tick();assert.equal(completed,true);assert(cleared>0);
  task.cancel();task.cancel();assert.equal(disposed,1);assert.equal(typeof expire,'function');
});
test('retired content never adopts a late decoded texture and disposes it once',async()=>{
  const texture=deferred<string>();let disposed=0,signal:AbortSignal|undefined;
  const task=createVisualPreparation({prepare:s=>{signal=s;return texture.promise;},dispose:()=>{disposed++;},error});
  await tick();const rejected=assert.rejects(task.promise,/visual.preparation_cancelled/);task.cancel();await rejected;
  assert(signal?.aborted);texture.resolve('old');await tick();assert.equal(disposed,1);
});
test('timeout and arbitrary producer text remain safe failures, not readiness',async()=>{
  let expire!:()=>void;const pending=deferred<string>();
  const task=createVisualPreparation({prepare:()=>pending.promise,dispose:()=>{},error,
    clock:{schedule(fn){expire=fn;return()=>{};}}});
  const rejected=assert.rejects(task.promise,/visual.preparation_timeout/);expire();await rejected;
  const failed=createVisualPreparation({prepare:()=>{throw Error('https://private.invalid/?credential=hidden');},dispose:()=>{},error});
  await assert.rejects(failed.promise,e=>e instanceof Error&&e.message==='visual.preparation_failed');
});
