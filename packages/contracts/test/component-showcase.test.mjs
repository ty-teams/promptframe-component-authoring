import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { componentShowcaseDefaultFrames, resolveComponentShowcaseGroups, ComponentShowcaseError, createComponentShowcasePropsValidator } from '../dist/index.js';

const preview = { width: 960, height: 540, fps: 30, durationFrames: 120,
  props: { title: 'Original', camera: { distance: 3, target: [0, 1, 0] }, values: [1, 2] } };
const schema = z.object({ title: z.string(), camera: z.object({ distance: z.number().positive(), target: z.array(z.number()).length(3) }), values: z.array(z.number()) }).strict();
const resolve = (showcase, value = preview) => resolveComponentShowcaseGroups({ preview: value, showcase, validateProps: props => schema.parse(props) });
const rejects = (showcase, code, path) => assert.throws(() => resolve(showcase), error => error instanceof ComponentShowcaseError && error.code === code && error.path.join('.') === path);

test('legacy preview supplies one default group and exact evenly spaced local frames', () => {
  const [group] = resolve(undefined);
  assert.equal(group.id, 'default');
  assert.deepEqual(group.frames, [0, 24, 48, 71, 95, 119]);
  assert.deepEqual(group.props, preview.props);
  for (const count of [1, 4, 6, 7, 120]) {
    const frames = componentShowcaseDefaultFrames(count);
    assert.equal(frames.length, Math.min(6, count));
    assert.equal(new Set(frames).size, frames.length);
    assert.equal(frames[0], 0); assert.equal(frames.at(-1), count - 1);
  }
});
test('presets merge object fields, replace arrays, preserve explicit zero and isolate all copies', () => {
  const [base, alternate] = resolve({ presets: [{ id: 'closer', label: 'Closer', propsOverride: { camera: { distance: 1, target: [0, 0, 0] }, values: [] } }] });
  assert.equal(alternate.props.camera.distance, 1); assert.deepEqual(alternate.props.camera.target, [0, 0, 0]);
  assert.deepEqual(alternate.props.values, []); assert.equal(alternate.props.title, 'Original');
  alternate.props.camera.target[0] = 8;
  assert.deepEqual(base.props, preview.props); assert.equal(preview.props.camera.target[0], 0);
  assert.deepEqual(base.frames, alternate.frames);
});
test('author frames are exact, ordered and bounded by this preview duration', () => {
  assert.deepEqual(resolve({ defaultFrames: [0, 10, 20, 30, 50, 70, 100, 119] })[0].frames, [0, 10, 20, 30, 50, 70, 100, 119]);
  rejects({ defaultFrames: [0, 10, 20, 30, 50, 120] }, 'component.showcase.frame_out_of_range', 'defaultFrames.5');
  rejects({ defaultFrames: [0, 10, 20, 20, 50, 119] }, 'component.showcase.frames_not_increasing', 'defaultFrames.3');
  rejects({ defaultFrames: [0, 119] }, 'component.showcase.frame_count', 'defaultFrames');
  assert.deepEqual(resolve({ defaultFrames: [0, 1, 2, 3] }, { ...preview, durationFrames: 4 })[0].frames, [0, 1, 2, 3]);
});
test('three total groups are allowed; reserved, duplicate and extra preset IDs reject at the source field', () => {
  const preset = id => ({ id, label: id, propsOverride: {} });
  assert.equal(resolve({ presets: [preset('a'), preset('b')] }).length, 3);
  rejects({ presets: [preset('default')] }, 'component.showcase.invalid', 'presets.0.id');
  rejects({ presets: [preset('a'), preset('a')] }, 'component.showcase.invalid', 'presets.1.id');
  rejects({ presets: [preset('a'), preset('b'), preset('c')] }, 'component.showcase.invalid', 'presets');
});
test('every merged group passes the caller full schema including nested constraints', () => {
  assert.throws(() => resolve({ presets: [{ id: 'bad', label: 'Bad', propsOverride: { camera: { distance: -1 } } }] }), z.ZodError);
  assert.throws(() => resolve({ presets: [{ id: 'bad', label: 'Bad', propsOverride: { extra: true } }] }), z.ZodError);
  let count = 0;
  resolveComponentShowcaseGroups({ preview, showcase: { presets: [{ id: 'a', label: 'A', propsOverride: {} }] }, validateProps: (props, path) => {
    assert.equal(path.join('.'), count ? 'presets.0.propsOverride' : 'props'); count++; return schema.parse(props);
  } });
  assert.equal(count, 2);
});
test('non-JSON, prototype keys, malformed structure and unbounded nested data cannot enter a group', () => {
  rejects({ presets: [{ id: 'a', label: 'A', propsOverride: JSON.parse('{"__proto__":{"polluted":true}}') }] }, 'component.showcase.props_key', 'presets.0.propsOverride.__proto__');
  rejects({ unknown: true }, 'component.showcase.invalid', '');
  rejects(null, 'component.showcase.invalid', '');
  rejects({ presets: [{ id: 'a', label: 'A', propsOverride: { values: [Infinity] } }] }, 'component.showcase.props_json_required', 'presets.0.propsOverride.values.0');
  let deep = {};
  for (let index = 0; index < 40; index++) deep = { nested: deep };
  assert.throws(() => resolve({ presets: [{ id: 'deep', label: 'Deep', propsOverride: deep }] }), error => error instanceof ComponentShowcaseError && error.code === 'component.showcase.props_depth');
  assert.throws(() => resolve(undefined, { ...preview, durationFrames: 0 }), ComponentShowcaseError);
  assert.equal({}.polluted, undefined);
});

test('static props validation preserves defaults, nullable data and exact nested field errors', () => {
  const validate = createComponentShowcasePropsValidator({ type: 'object', required: ['count'], properties: {
    count: { type: 'integer', minimum: 1, maximum: 120 }, color: { type: 'string', nullable: true, default: null },
    mode: { type: 'string', enum: ['slow', 'fast'], default: 'slow' },
  } });
  assert.deepEqual(validate({ count: 12 }, []), { count: 12, color: null, mode: 'slow' });
  for (const [props, field] of [[{ count: 0 }, 'count'], [{ count: 12, mode: 'bad' }, 'mode'], [{ count: 12, extra: true }, 'extra']]) {
    assert.throws(() => validate(props, ['presets', 0, 'propsOverride']), error => error.code === 'component.showcase.props_invalid'
      && error.path.join('.') === 'presets.0.propsOverride.' + field);
  }
});
test('unresolved schema references and undeclared required properties fail before validating props', () => {
  for (const schema of [{ $ref: 'https://invalid.example/schema' }, { type: 'object', required: ['missing'], properties: {} }])
    assert.throws(() => createComponentShowcasePropsValidator(schema), error => error.code === 'component.showcase.schema_unsupported');
});
