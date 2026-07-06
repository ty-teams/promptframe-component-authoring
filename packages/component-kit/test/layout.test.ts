import assert from 'node:assert/strict';
import test from 'node:test';
import { createPromptFrameLayout } from '../src/index.js';

test('createPromptFrameLayout scales design px into the current slot', () => {
  const layout = createPromptFrameLayout({
    slotWidth: 640,
    slotHeight: 360,
    baseWidth: 1280,
    baseHeight: 720,
  });

  assert.equal(layout.scale, 0.5);
  assert.equal(layout.px(72), 36);
  assert.equal(layout.px(1), 0.5);
});

test('createPromptFrameLayout clamps scale and rounds deterministically', () => {
  const layout = createPromptFrameLayout({
    slotWidth: 333,
    slotHeight: 222,
    baseWidth: 1000,
    baseHeight: 500,
    minScale: 0.4,
    maxScale: 0.8,
    precision: 2,
  });

  assert.equal(layout.scale, 0.4);
  assert.equal(layout.px(37), 14.8);
  assert.equal(layout.clamp(12, 24, 48), 'clamp(4.8px, 9.6px, 19.2px)');
});

test('createPromptFrameLayout rejects invalid geometry without reading browser globals', () => {
  assert.throws(
    () => createPromptFrameLayout({
      slotWidth: 0,
      slotHeight: 360,
      baseWidth: 1280,
      baseHeight: 720,
    }),
    /slotWidth must be a positive finite number/,
  );
});
