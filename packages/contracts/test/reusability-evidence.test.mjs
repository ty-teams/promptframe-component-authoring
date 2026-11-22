import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSchemaReusability } from '../dist/reusability-evaluator.js';

const source = `import {z} from 'zod';export const propsSchema=z.object({
  headline:z.string().default('Stable label'),
  points:z.number().int().min(0).max(9).default(2),
  visible:z.boolean().default(true)
});`;
const previewProps = { headline: 'Stable label', points: 2, visible: true };

test('schema reuse evidence does not read comments or infer a data shape from property names', () => {
  const baseline = evaluateSchemaReusability({ schemaSourceText: source, previewProps });
  const comment = evaluateSchemaReusability({ schemaSourceText: '// campaign z.array metrics rows\n' + source, previewProps });
  assert.deepEqual(comment, baseline);
  assert.equal(baseline.recommendation, 'allow');
  assert.deepEqual(baseline.configurableInputs, ['headline', 'points', 'visible']);
  assert(!baseline.signals.some(signal => ['hardcodedContentRisk', 'styleConfigurability', 'domainNeutrality'].includes(signal.id)));
  const renamed = evaluateSchemaReusability({ schemaSourceText: source.replaceAll('headline', 'imageNamedText'),
    previewProps: { imageNamedText: 'Stable label', points: 2, visible: true } });
  assert.equal(renamed.score, baseline.score);
  assert.equal(renamed.recommendation, baseline.recommendation);
});

test('removing an actual input or preset removes only its corresponding evidence', () => {
  const missingPreview = evaluateSchemaReusability({ schemaSourceText: source, previewProps: { headline: 'Stable label', visible: true } });
  assert.deepEqual(missingPreview.configurableInputs, ['headline', 'points', 'visible']);
  assert.deepEqual(missingPreview.previewInputs, ['headline', 'visible']);
  const deleted = evaluateSchemaReusability({ schemaSourceText: source.replace("  points:z.number().int().min(0).max(9).default(2),\n", ''),
    previewProps: { headline: 'Stable label', visible: true } });
  assert.deepEqual(deleted.configurableInputs, ['headline', 'visible']);
  assert.deepEqual(deleted.defaultOrOptionalInputs, ['headline', 'visible']);
  assert.deepEqual(deleted.previewInputs, ['headline', 'visible']);
});

test('wrong types and bounds do not count as compatible preview values', () => {
  const result = evaluateSchemaReusability({ schemaSourceText: source, previewProps: { headline: 7, points: 10.5, visible: 'true', extra: 'ignored' } });
  assert.deepEqual(result.previewInputs, []);
  assert.equal(result.recommendation, 'warn');
  assert(!['manual_review', 'reject'].includes(result.recommendation));
});

test('constants and singleton input domains do not manufacture configurable-input evidence', () => {
  const result = evaluateSchemaReusability({ schemaSourceText: `import {z} from 'zod';export const propsSchema=z.object({
    fixed:z.literal('same'), mode:z.enum(['only']), number:z.number().min(3).max(3), useful:z.boolean()
  });`, previewProps: { fixed: 'same', mode: 'only', number: 3, useful: false } });
  assert.deepEqual(result.configurableInputs, ['useful']);
  assert.deepEqual(result.previewInputs, ['useful']);
});

test('nested values must match their declared types before becoming preview evidence', () => {
  const nested = `import {z} from 'zod';export const propsSchema=z.object({items:z.array(z.object({n:z.number().int()})),label:z.string()});`;
  const result = evaluateSchemaReusability({ schemaSourceText: nested, previewProps: { items: [{n:1.5}], label: 'aaaa!' } });
  assert.deepEqual(result.previewInputs, ['label']);
  const valid = evaluateSchemaReusability({ schemaSourceText: nested, previewProps: { items: [{n:1}], label: 'a' } });
  assert.deepEqual(valid.previewInputs, ['items', 'label']);
});

test('missing schema evidence is an advisory and does not infer source quality', () => {
  const result = evaluateSchemaReusability({ schemaSourceText: 'export const propsSchema=unknownExternalSchema;', previewProps: {} });
  assert.equal(result.recommendation, 'warn');
  assert.deepEqual(result.configurableInputs, []);
  assert(result.signals.every(signal => !/hardcoded|domain-neutral|campaign/.test(signal.reason)));
});

test('an invalid default is not counted merely because defaulted inputs are optional', () => {
  const result = evaluateSchemaReusability({ schemaSourceText: `import {z} from 'zod';
    export const propsSchema=z.object({count:z.number().int().min(0).default(-1)});`, previewProps: {count:2} });
  assert.deepEqual(result.configurableInputs,['count']);
  assert.deepEqual(result.defaultOrOptionalInputs,[]);
  assert.deepEqual(result.previewInputs,['count']);
});
