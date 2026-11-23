import { z } from 'zod';

export const COMPONENT_SHOWCASE_CONTRACT_VERSION = 'component-showcase/v1' as const;
const frames = z.array(z.number().int().nonnegative().safe()).min(1).max(8);
export const componentShowcaseSchema = z.object({
  defaultFrames: frames.optional(),
  presets: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    propsOverride: z.record(z.unknown()),
    frames: frames.optional(),
  }).strict()).max(2).optional(),
}).strict().superRefine((value, context) => {
  const ids = new Set(['default']);
  for (const [index, preset] of (value.presets ?? []).entries()) {
    if (ids.has(preset.id)) context.addIssue({ code: 'custom', path: ['presets', index, 'id'], message: 'Showcase preset IDs must be unique and cannot be default.' });
    ids.add(preset.id);
  }
});

export type ComponentShowcase = z.infer<typeof componentShowcaseSchema>;
export interface ComponentShowcasePreview {
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  props: Record<string, unknown>;
}
export interface ComponentShowcaseGroup extends ComponentShowcasePreview {
  id: string;
  label: string;
  frames: number[];
}

/** Compile the published, static JSON schema facts without loading a component.
 * Resource authorization and component runtime predicates remain with the caller. */
export function createComponentShowcasePropsValidator(schema: unknown) {
  let validator:z.ZodTypeAny;
  try{validator=staticSchema(schema,[]);}
  catch(error){
    if(error instanceof ComponentShowcaseError)throw new ComponentShowcaseError(error.code,error.path,'schema');
    throw error;
  }
  return (props: Record<string, unknown>, path: Array<string | number>): Record<string, unknown> => {
    const result = validator.safeParse(props);
    if (!result.success) {
      const issue = result.error.issues[0];
      fail('props_invalid', [...path, ...(issue?.path ?? []), ...(issue?.code === 'unrecognized_keys' ? issue.keys.slice(0, 1) : [])]);
    }
    if (!record(result.data)) return fail('props_json_required', path);
    return result.data;
  };
}

export class ComponentShowcaseError extends Error {
  constructor(readonly code: string, readonly path: Array<string | number>,readonly source?:'schema') {
    super(`${code}: ${path.join('.')}`);
    this.name = 'ComponentShowcaseError';
  }
}
const fail = (code: string, path: Array<string | number>): never => { throw new ComponentShowcaseError(`component.showcase.${code}`, path); };

/** Sampling is local to the exact preview duration. No repeated/padded frames. */
export function componentShowcaseDefaultFrames(durationFrames: number): number[] {
  if (!Number.isSafeInteger(durationFrames) || durationFrames < 1) fail('duration_invalid', ['durationFrames']);
  const count = Math.min(6, durationFrames);
  return count === 1 ? [0] : Array.from({ length: count }, (_, index) => Math.round(index * (durationFrames - 1) / (count - 1)));
}

/** The caller supplies the same full props validator used for normal preview.
 * This structural helper does not load component modules or grant resource access. */
export function resolveComponentShowcaseGroups(input: {
  preview: ComponentShowcasePreview;
  showcase?: unknown;
  validateProps: (props: Record<string, unknown>, path: Array<string | number>) => Record<string, unknown>;
}): ComponentShowcaseGroup[] {
  const duration = input.preview.durationFrames;
  const automaticFrames = componentShowcaseDefaultFrames(duration);
  // Check JSON keys before object-schema parsing can discard __proto__.
  const parsed = componentShowcaseSchema.safeParse(input.showcase === undefined ? {} : cloneJson(input.showcase, []));
  if (!parsed.success) fail('invalid', parsed.error.issues[0]?.path ?? []);
  const showcase = parsed.data!;
  const resolveFrames = (requested: number[] | undefined, path: Array<string | number>) => {
    if (!requested) return [...automaticFrames];
    const min = Math.min(6, duration), max = Math.min(8, duration);
    if (requested.length < min || requested.length > max) fail('frame_count', path);
    for (const [index, frame] of requested.entries()) {
      if (frame >= duration) fail('frame_out_of_range', [...path, index]);
      if (index && frame <= requested[index - 1]!) fail('frames_not_increasing', [...path, index]);
    }
    return [...requested];
  };
  const group = (id: string, label: string, props: Record<string, unknown>, requested: number[] | undefined,
    propsPath: Array<string | number>, framesPath: Array<string | number>): ComponentShowcaseGroup => ({
    ...input.preview, id, label, props: input.validateProps(props, propsPath),
    frames: resolveFrames(requested, framesPath),
  });
  const defaults = group('default', 'Default', cloneJson(input.preview.props, ['props']), showcase.defaultFrames, ['props'], ['defaultFrames']);
  return [defaults, ...(showcase.presets ?? []).map((preset, index) => {
    const propsPath = ['presets', index, 'propsOverride'];
    return group(preset.id, preset.label, mergeProps(input.preview.props, preset.propsOverride, propsPath), preset.frames,
      propsPath, ['presets', index, 'frames']);
  })];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function cloneJson<T>(value: T, path: Array<string | number>, depth = 0): T {
  if (depth > 32) fail('props_depth', path);
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => cloneJson(item, [...path, index], depth + 1)) as T;
  if (!record(value)) return fail('props_json_required', path);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('props_key', [...path, key]);
    return [key, cloneJson(item, [...path, key], depth + 1)];
  })) as T;
}
function mergeProps(base: Record<string, unknown>, override: Record<string, unknown>, path: Array<string | number>): Record<string, unknown> {
  const result = cloneJson(base, path), replacement = cloneJson(override, path);
  for (const [key, value] of Object.entries(replacement)) {
    result[key] = record(value) && record(result[key])
      ? mergeProps(result[key] as Record<string, unknown>, value, [...path, key]) : value;
  }
  return result;
}

function staticSchema(value: unknown, path: Array<string | number>, depth = 0): z.ZodTypeAny {
  if (!record(value) || depth > 32 || ['$ref', 'oneOf', 'allOf', 'not', 'if', 'dependentSchemas'].some(key => Object.hasOwn(value, key)))
    return fail('schema_unsupported', path);
  const child = (node: unknown, key: string | number) => staticSchema(node, [...path, key], depth + 1);
  const limit = (key: string) => {
    const result = value[key];
    if (result !== undefined && (typeof result !== 'number' || !Number.isFinite(result))) fail('schema_invalid', [...path, key]);
    return result as number | undefined;
  };
  let result: z.ZodTypeAny;
  if (value.anyOf !== undefined) {
    if (!Array.isArray(value.anyOf) || value.anyOf.length < 2 || value.anyOf.length > 16) return fail('schema_unsupported', path);
    const variants = value.anyOf.map((node, index) => child(node, index));
    result = z.union(variants as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  } else if (value.type === 'object') {
    const properties = value.properties === undefined ? {} : value.properties;
    if (!record(properties) || value.required !== undefined && (!Array.isArray(value.required) || value.required.some(key => typeof key !== 'string')))
      return fail('schema_invalid', path);
    const required = new Set(value.required as string[] | undefined);
    if ([...required].some(key => !Object.hasOwn(properties, key))) return fail('schema_unsupported', path);
    const shape = Object.fromEntries(Object.entries(properties).map(([key, node]) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('props_key', [...path, key]);
      const field = child(node, key);
      return [key, required.has(key) || record(node) && Object.hasOwn(node, 'default') ? field : field.optional()];
    }));
    const object = z.object(shape);
    result = value.additionalProperties === true ? object.passthrough()
      : record(value.additionalProperties) ? object.catchall(child(value.additionalProperties, '*')) : object.strict();
  } else if (value.type === 'array') {
    let array = z.array(child(value.items ?? {}, 'items'));
    if (limit('minItems') !== undefined) array = array.min(limit('minItems')!);
    if (limit('maxItems') !== undefined) array = array.max(limit('maxItems')!);
    result = array;
  } else if (value.type === 'string') {
    let string = z.string();
    if (limit('minLength') !== undefined) string = string.min(limit('minLength')!);
    if (limit('maxLength') !== undefined) string = string.max(limit('maxLength')!);
    if (value.pattern !== undefined) {
      if (typeof value.pattern !== 'string') return fail('schema_invalid', path);
      try { string = string.regex(new RegExp(value.pattern)); } catch { return fail('schema_invalid', path); }
    }
    if (value.format === 'uri') string = string.url();
    result = string;
  } else if (value.type === 'number' || value.type === 'integer') {
    let number = z.number().finite();
    if (value.type === 'integer') number = number.int();
    if (limit('minimum') !== undefined) number = number.min(limit('minimum')!);
    if (limit('maximum') !== undefined) number = number.max(limit('maximum')!);
    if (limit('exclusiveMinimum') !== undefined) number = number.gt(limit('exclusiveMinimum')!);
    if (limit('exclusiveMaximum') !== undefined) number = number.lt(limit('exclusiveMaximum')!);
    result = number;
  } else if (value.type === 'boolean') result = z.boolean();
  else if (value.type === 'null') result = z.null();
  else if (value.type === undefined) result = z.unknown();
  else return fail('schema_unsupported', path);
  if (value.enum !== undefined || Object.hasOwn(value, 'const')) {
    const values = Object.hasOwn(value, 'const') ? [value.const] : value.enum;
    if (!Array.isArray(values) || !values.length) return fail('schema_invalid', path);
    result = result.refine(item => values.some(allowed => JSON.stringify(allowed) === JSON.stringify(item)));
  }
  if (value.nullable === true) result = result.nullable();
  if (Object.hasOwn(value, 'default')) {
    const fallback=cloneJson(value.default,[...path,'default']);
    if(!result.safeParse(fallback).success)return fail('schema_default_invalid',[...path,'default']);
    result = result.default(() => cloneJson(fallback,[...path,'default']));
  }
  return result;
}
