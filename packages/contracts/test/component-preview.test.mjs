import assert from 'node:assert/strict';
import test from 'node:test';
import { selectComponentPreviewDurationFrames as select } from '../dist/index.js';

test('preview selects manifest maximum in frames and caps elapsed time at thirty seconds', () => {
  assert.equal(select({fps:30,durationFrames:60,designedDurationRange:{min:30,max:240}}),240);
  assert.equal(select({fps:30,durationFrames:60,designedDurationRange:{min:30,max:1200}}),900);
  assert.equal(select({fps:60,durationFrames:60,designedDurationRange:{min:30,max:2400}}),1800);
  assert.equal(select({fps:30,durationFrames:900,designedDurationRange:{min:900,max:900}}),900);
  assert.equal(select({fps:30,durationFrames:900,designedDurationRange:{min:1200,max:2400}}),900);
});
test('legacy preview keeps its positive frame fallback within the same cap', () => {
  assert.equal(select({fps:30,durationFrames:60}),60);
  assert.equal(select({fps:60,durationFrames:2400}),1800);
});
test('invalid timing and malformed declared ranges do not silently grant extra preview time', () => {
  for (const value of [0,-1,NaN,Infinity,1.5]) assert.throws(()=>select({fps:30,durationFrames:value}));
  assert.throws(()=>select({fps:0,durationFrames:60}));
  assert.throws(()=>select({fps:30,durationFrames:60,designedDurationRange:{min:50,max:49}}));
});
