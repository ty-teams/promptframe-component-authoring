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

export class ComponentShowcaseError extends Error {
  constructor(readonly code: string, readonly path: Array<string | number>) {
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
