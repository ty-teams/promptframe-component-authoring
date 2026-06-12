import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPreviewCaseMatrix,
  type PromptFramePreviewCase,
} from '../src/preview.js';

test('createPreviewCaseMatrix builds bounded aspect and props stress cases', () => {
  const cases = createPreviewCaseMatrix({
    basePreview: {
      durationFrames: 90,
      fps: 30,
      width: 1280,
      height: 720,
    },
    baseProps: {
      title: 'Revenue',
      count: 42,
      enabled: true,
      accentColor: '#38bdf8',
      items: [{ label: 'A' }],
    },
    validateProps: (candidate) => {
      if (typeof candidate.title !== 'string' || candidate.title.length > 120) return undefined;
      if (typeof candidate.count !== 'number' || candidate.count < 0 || candidate.count > 100) return undefined;
      if (!Array.isArray(candidate.items) || candidate.items.length > 8) return undefined;
      return candidate;
    },
  });

  assert.ok(cases.length >= 5);
  assert.ok(cases.some((previewCase) => previewCase.id === 'default'));
  assert.ok(cases.some((previewCase) => previewCase.id === 'aspect-9-16'));
  assert.ok(cases.some((previewCase) => previewCase.id === 'aspect-1-1'));
  assert.ok(cases.some((previewCase) => previewCase.id === 'text-stress'));
  assert.ok(cases.some((previewCase) => previewCase.id === 'number-high'));
  assert.ok(cases.some((previewCase) => previewCase.id === 'boolean-flip'));
  assert.ok(cases.some((previewCase) => (
    previewCase.id === 'array-dense'
    && previewCase.props.items.length === 8
  )));
  assert.ok(cases.every((previewCase) => previewCase.width <= 1280));
  assert.ok(cases.every((previewCase) => previewCase.height <= 1280));
  assert.ok(cases.every((previewCase) => previewCase.fps === 30));
  assert.ok(cases.every((previewCase) => previewCase.props.title.length <= 120));
  assert.ok(cases.every((previewCase) => previewCase.props.accentColor === '#38bdf8'));
});

test('createPreviewCaseMatrix de-duplicates invalid or repeated cases', () => {
  const cases = createPreviewCaseMatrix({
    basePreview: {
      durationFrames: 180,
      fps: 30,
      width: 960,
      height: 960,
    },
    baseProps: {
      label: 'A',
      count: 1,
    },
    validateProps: (candidate) => {
      if (candidate.count !== 1) return undefined;
      return candidate;
    },
  });

  const signatures = new Set(cases.map((previewCase: PromptFramePreviewCase<{ label: string; count: number }>) => (
    `${previewCase.width}x${previewCase.height}:${JSON.stringify(previewCase.props)}`
  )));
  assert.equal(signatures.size, cases.length);
  assert.ok(cases.some((previewCase) => previewCase.id === 'default'));
  assert.ok(cases.every((previewCase) => previewCase.props.count === 1));
});

test('createPreviewCaseMatrix can add fps-adaptive timing variants without changing source preview policy', () => {
  const cases = createPreviewCaseMatrix({
    basePreview: {
      durationFrames: 90,
      fps: 30,
      width: 1280,
      height: 720,
    },
    baseProps: {
      title: 'Fps check',
    },
    fpsPresets: [30, 60],
  });

  const defaultCase = cases.find((previewCase) => previewCase.id === 'default');
  const fps60Case = cases.find((previewCase) => previewCase.id === 'fps-60');

  assert.ok(defaultCase);
  assert.equal(defaultCase.fps, 30);
  assert.equal(defaultCase.durationFrames, 90);
  assert.ok(fps60Case);
  assert.equal(fps60Case.fps, 60);
  assert.equal(fps60Case.durationFrames, 180);
  assert.deepEqual(fps60Case.props, defaultCase.props);
});
