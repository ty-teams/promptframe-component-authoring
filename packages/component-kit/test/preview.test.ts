import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coercePromptFramePreviewControlValue,
  createPreviewCaseMatrix,
  describePromptFramePreviewPropControl,
  formatPromptFramePreviewControlValue,
  formatPromptFramePreviewPropLabel,
  formatPromptFramePreviewPropPath,
  parsePromptFramePreviewJsonDraft,
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
  assert.equal(cases.find((previewCase) => previewCase.id === 'default')?.caseKind, 'baseline_reset');
  assert.equal(cases.find((previewCase) => previewCase.id === 'aspect-9-16')?.caseKind, 'aspect');
  assert.equal(cases.find((previewCase) => previewCase.id === 'aspect-1-1')?.caseKind, 'aspect');
  assert.equal(cases.find((previewCase) => previewCase.id === 'text-stress')?.caseKind, 'props_stress');
  assert.equal(cases.find((previewCase) => previewCase.id === 'number-high')?.caseKind, 'props_stress');
  assert.equal(cases.find((previewCase) => previewCase.id === 'boolean-flip')?.caseKind, 'props_stress');
  assert.ok(cases.some((previewCase) => (
    previewCase.id === 'array-dense'
    && previewCase.props.items.length === 8
  )));
  const propsStressCases = cases.filter((previewCase) => previewCase.caseKind === 'props_stress');
  assert.ok(propsStressCases.length > 0);
  assert.ok(propsStressCases.every((previewCase) => previewCase.width === 1280));
  assert.ok(propsStressCases.every((previewCase) => previewCase.height === 720));
  assert.ok(propsStressCases.every((previewCase) => previewCase.fps === 30));
  assert.ok(propsStressCases.every((previewCase) => previewCase.durationFrames === 90));
  assert.ok(propsStressCases.every((previewCase) => previewCase.probeCoverage === 'platform_probe_equivalent'));
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
  assert.equal(defaultCase.caseKind, 'baseline_reset');
  assert.equal(defaultCase.fps, 30);
  assert.equal(defaultCase.durationFrames, 90);
  assert.ok(fps60Case);
  assert.equal(fps60Case.caseKind, 'fps_diagnostic');
  assert.equal(fps60Case.probeCoverage, 'local_authoring_only');
  assert.equal(fps60Case.fps, 60);
  assert.equal(fps60Case.durationFrames, 180);
  assert.deepEqual(fps60Case.props, defaultCase.props);
});

test('createPreviewCaseMatrix can add designed-duration diagnostic cases', () => {
  const cases = createPreviewCaseMatrix({
    basePreview: {
      durationFrames: 120,
      fps: 30,
      width: 1280,
      height: 720,
    },
    baseProps: {
      title: 'Duration check',
    },
    aspectPresets: [],
    durationScalePresets: [0.5, 2],
  });

  const half = cases.find((previewCase) => previewCase.id === 'duration-0-5x');
  const double = cases.find((previewCase) => previewCase.id === 'duration-2x');
  assert.ok(half);
  assert.equal(half.caseKind, 'duration_diagnostic');
  assert.equal(half.probeCoverage, 'local_authoring_only');
  assert.equal(half.durationFrames, 60);
  assert.ok(double);
  assert.equal(double.caseKind, 'duration_diagnostic');
  assert.equal(double.durationFrames, 180);
});

test('preview prop control helpers classify and coerce values without stringifying objects', () => {
  assert.equal(formatPromptFramePreviewPropLabel('searchKeywords'), 'Search Keywords');
  assert.equal(formatPromptFramePreviewPropPath(['items', 0, 'label']), 'items.0.label');

  assert.deepEqual(describePromptFramePreviewPropControl(['enabled'], true), {
    path: ['enabled'],
    pathKey: 'enabled',
    label: 'Enabled',
    kind: 'boolean',
    inputType: 'select',
    jsonLike: false,
    primitive: true,
    structured: false,
  });
  assert.equal(describePromptFramePreviewPropControl(['accentColor'], '#38bdf8').kind, 'color');
  assert.equal(describePromptFramePreviewPropControl(['items'], [{ label: 'A' }]).kind, 'json_array');
  assert.equal(describePromptFramePreviewPropControl(['config'], { count: 1 }).kind, 'json_object');
  assert.equal(formatPromptFramePreviewControlValue({ count: 1 }), '');
  assert.equal(coercePromptFramePreviewControlValue(3, '4'), 4);
  assert.equal(coercePromptFramePreviewControlValue(true, 'false'), false);

  const parsed = parsePromptFramePreviewJsonDraft('{"count":2}');
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(parsed.value, { count: 2 });
  assert.equal(parsePromptFramePreviewJsonDraft('{broken').success, false);
});
