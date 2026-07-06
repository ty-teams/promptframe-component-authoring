export interface ComponentPreviewConstraints {
  maxDurationFrames: number;
  maxWidth: number;
  maxHeight: number;
  maxFps: number;
}

export const COMPONENT_PREVIEW_CONSTRAINTS: ComponentPreviewConstraints = {
  maxDurationFrames: 180,
  maxWidth: 1280,
  maxHeight: 720,
  maxFps: 30,
};

export type PromptFramePreviewFps = 30 | 60;
export type PromptFramePreviewCaseKind = 'baseline_reset' | 'aspect' | 'props_stress' | 'fps_diagnostic';
export type PromptFramePreviewProbeCoverage = 'platform_probe_equivalent' | 'local_authoring_only';
export type PromptFramePreviewPropPath = Array<string | number>;
export type PromptFramePreviewPropControlKind =
  | 'boolean'
  | 'color'
  | 'json_array'
  | 'json_null'
  | 'json_object'
  | 'number'
  | 'text';
export type PromptFramePreviewPropInputType = 'color' | 'number' | 'select' | 'text';

export interface ComponentPreviewPropsEnvelope<TProps extends Record<string, unknown> = Record<string, unknown>> {
  durationFrames: number;
  fps: 30;
  width: number;
  height: number;
  props: TProps;
}

export interface PromptFramePreviewCase<TProps extends Record<string, unknown> = Record<string, unknown>>
  extends Omit<ComponentPreviewPropsEnvelope<TProps>, 'fps'> {
  id: string;
  name: string;
  description: string;
  caseKind: PromptFramePreviewCaseKind;
  probeCoverage: PromptFramePreviewProbeCoverage;
  fps: PromptFramePreviewFps;
}

export interface PromptFramePreviewPropControlDescriptor {
  path: PromptFramePreviewPropPath;
  pathKey: string;
  label: string;
  kind: PromptFramePreviewPropControlKind;
  inputType?: PromptFramePreviewPropInputType;
  jsonLike: boolean;
  primitive: boolean;
  structured: boolean;
}

export interface CreatePreviewCaseMatrixInput<TProps extends Record<string, unknown>> {
  basePreview: Omit<ComponentPreviewPropsEnvelope<TProps>, 'props'>;
  baseProps: TProps;
  validateProps?: (candidate: TProps) => TProps | undefined;
  fpsPresets?: ReadonlyArray<PromptFramePreviewFps>;
  aspectPresets?: ReadonlyArray<{
    id: string;
    name: string;
    width: number;
    height: number;
  }>;
}

const DEFAULT_PREVIEW_ASPECT_CASES = [
  { id: 'aspect-16-9', name: '16:9', width: 1280, height: 720 },
  { id: 'aspect-9-16', name: '9:16', width: 720, height: 1280 },
  { id: 'aspect-1-1', name: '1:1', width: 960, height: 960 },
] as const;

export function assertPreviewWithinConstraints(
  preview: ComponentPreviewPropsEnvelope,
  constraints: ComponentPreviewConstraints = COMPONENT_PREVIEW_CONSTRAINTS,
): void {
  const errors: string[] = [];
  if (preview.durationFrames > constraints.maxDurationFrames) errors.push(`durationFrames must be <= ${constraints.maxDurationFrames}`);
  if (preview.width > constraints.maxWidth) errors.push(`width must be <= ${constraints.maxWidth}`);
  if (preview.height > constraints.maxHeight) errors.push(`height must be <= ${constraints.maxHeight}`);
  if (preview.fps > constraints.maxFps) errors.push(`fps must be <= ${constraints.maxFps}`);
  if (errors.length > 0) throw new Error(errors.join('; '));
}

export function createPreviewCaseMatrix<TProps extends Record<string, unknown>>({
  basePreview,
  baseProps,
  validateProps,
  fpsPresets,
  aspectPresets = DEFAULT_PREVIEW_ASPECT_CASES,
}: CreatePreviewCaseMatrixInput<TProps>): PromptFramePreviewCase<TProps>[] {
  const cases: PromptFramePreviewCase<TProps>[] = [];
  const seen = new Set<string>();
  const addCase = (previewCase: PromptFramePreviewCase<TProps>) => {
    const parsedProps = validatePreviewProps(previewCase.props, validateProps);
    if (!parsedProps) return;
    const normalizedCase = {
      ...previewCase,
      props: parsedProps,
    };
    const signature = [
      `${normalizedCase.durationFrames}@${normalizedCase.fps}fps`,
      `${normalizedCase.width}x${normalizedCase.height}`,
      stableJson(normalizedCase.props),
    ].join(':');
    if (seen.has(signature)) return;
    seen.add(signature);
    cases.push(normalizedCase);
  };

  addCase({
    id: 'default',
    name: 'Default',
    description: 'Canonical src/preview-props.json case.',
    caseKind: 'baseline_reset',
    probeCoverage: 'platform_probe_equivalent',
    ...basePreview,
    props: cloneProps(baseProps),
  });

  for (const fps of normalizeFpsPresets(fpsPresets)) {
    if (fps === basePreview.fps) continue;
    addCase({
      id: `fps-${fps}`,
      name: `${fps}fps`,
      description: `${fps}fps timing case scaled from ${basePreview.fps}fps for fps-adaptive diagnostics.`,
      caseKind: 'fps_diagnostic',
      probeCoverage: 'local_authoring_only',
      ...basePreview,
      fps,
      durationFrames: scaleDurationFramesForFps(basePreview.durationFrames, basePreview.fps, fps),
      props: cloneProps(baseProps),
    });
  }

  for (const preset of aspectPresets) {
    addCase({
      id: preset.id,
      name: preset.name,
      description: `Aspect case ${preset.name}.`,
      caseKind: 'aspect',
      probeCoverage: 'platform_probe_equivalent',
      ...basePreview,
      width: preset.width,
      height: preset.height,
      props: cloneProps(baseProps),
    });
  }

  for (const variant of createPropsStressVariants(baseProps)) {
    addCase({
      id: variant.id,
      name: variant.name,
      description: variant.description,
      caseKind: 'props_stress',
      probeCoverage: 'platform_probe_equivalent',
      ...basePreview,
      props: variant.props,
    });
  }

  return cases;
}

export function formatPromptFramePreviewPropLabel(rawKey: string): string {
  const spaced = rawKey
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  if (!spaced) return rawKey;
  return spaced.replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

export function formatPromptFramePreviewPropPath(path: PromptFramePreviewPropPath): string {
  return path.map(String).join('.');
}

export function describePromptFramePreviewPropControl(
  path: PromptFramePreviewPropPath,
  value: unknown,
  label = formatPromptFramePreviewPropLabel(String(path.at(-1) ?? 'value')),
): PromptFramePreviewPropControlDescriptor {
  const pathKey = formatPromptFramePreviewPropPath(path);
  if (Array.isArray(value)) {
    return {
      path,
      pathKey,
      label,
      kind: 'json_array',
      jsonLike: true,
      primitive: false,
      structured: true,
    };
  }
  if (value === null) {
    return {
      path,
      pathKey,
      label,
      kind: 'json_null',
      jsonLike: true,
      primitive: false,
      structured: true,
    };
  }
  if (typeof value === 'object') {
    return {
      path,
      pathKey,
      label,
      kind: 'json_object',
      jsonLike: true,
      primitive: false,
      structured: true,
    };
  }
  if (typeof value === 'boolean') {
    return {
      path,
      pathKey,
      label,
      kind: 'boolean',
      inputType: 'select',
      jsonLike: false,
      primitive: true,
      structured: false,
    };
  }
  if (typeof value === 'number') {
    return {
      path,
      pathKey,
      label,
      kind: 'number',
      inputType: 'number',
      jsonLike: false,
      primitive: true,
      structured: false,
    };
  }
  if (typeof value === 'string' && isHexColor(value)) {
    return {
      path,
      pathKey,
      label,
      kind: 'color',
      inputType: 'color',
      jsonLike: false,
      primitive: true,
      structured: false,
    };
  }
  return {
    path,
    pathKey,
    label,
    kind: 'text',
    inputType: 'text',
    jsonLike: false,
    primitive: true,
    structured: false,
  };
}

export function isPromptFramePreviewJsonLikeValue(value: unknown): value is Record<string, unknown> | unknown[] | null {
  return value === null || typeof value === 'object';
}

export function formatPromptFramePreviewControlValue(value: unknown): string | number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return typeof value === 'string' ? value : '';
}

export function coercePromptFramePreviewControlValue(currentValue: unknown, rawValue: string): unknown {
  if (typeof currentValue === 'number') {
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) ? numeric : currentValue;
  }
  if (typeof currentValue === 'boolean') return rawValue === 'true';
  if (isPromptFramePreviewJsonLikeValue(currentValue)) {
    const parsed = parsePromptFramePreviewJsonDraft(rawValue);
    return parsed.success ? parsed.value : currentValue;
  }
  return rawValue;
}

export function parsePromptFramePreviewJsonDraft(
  rawValue: string,
): { success: true; value: unknown } | { success: false; message: string } {
  try {
    return { success: true, value: JSON.parse(rawValue) };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unable to parse JSON.',
    };
  }
}

function normalizeFpsPresets(fpsPresets: ReadonlyArray<PromptFramePreviewFps> | undefined): PromptFramePreviewFps[] {
  return Array.from(new Set(fpsPresets ?? [])).sort((left, right) => left - right);
}

function scaleDurationFramesForFps(durationFrames: number, sourceFps: number, targetFps: number): number {
  return Math.max(1, Math.round((durationFrames * targetFps) / sourceFps));
}

function createPropsStressVariants<TProps extends Record<string, unknown>>(
  baseProps: TProps,
): Array<{
  id: string;
  name: string;
  description: string;
  props: TProps;
}> {
  return [
    {
      id: 'text-stress',
      name: 'Text stress',
      description: 'Longer bounded strings for layout overflow checks.',
      props: mapProps(baseProps, stressStringValue),
    },
    {
      id: 'number-low',
      name: 'Number low',
      description: 'Lower bounded numeric values for empty or small-state checks.',
      props: mapProps(baseProps, lowNumberValue),
    },
    {
      id: 'number-high',
      name: 'Number high',
      description: 'Higher bounded numeric values for dense-state checks.',
      props: mapProps(baseProps, highNumberValue),
    },
    {
      id: 'boolean-flip',
      name: 'Boolean flip',
      description: 'Flipped boolean flags for alternate-state checks.',
      props: mapProps(baseProps, flipBooleanValue),
    },
    {
      id: 'array-dense',
      name: 'Array dense',
      description: 'Repeated list items up to a bounded length for dense-state checks.',
      props: mapProps(baseProps, denseArrayValue),
    },
  ].filter((variant) => stableJson(variant.props) !== stableJson(baseProps));
}

function mapProps<TProps extends Record<string, unknown>>(
  baseProps: TProps,
  mapper: (value: unknown, key: string) => unknown,
): TProps {
  const next = cloneProps(baseProps);
  for (const key of Object.keys(next)) {
    next[key as keyof TProps] = mapper(next[key], key) as TProps[keyof TProps];
  }
  return next;
}

function stressStringValue(value: unknown, key: string): unknown {
  if (typeof value !== 'string') return value;
  if (isHexColor(value)) return value;
  const base = value.trim().length > 0 ? value.trim() : key;
  return `${base} - extended preview copy for responsive layout and text wrapping checks`.slice(0, 96);
}

function lowNumberValue(value: unknown): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  if (value <= 0) return value;
  return 0;
}

function highNumberValue(value: unknown): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const doubled = Math.abs(value) < 1 ? value + 1 : value * 2;
  return Math.min(Math.max(doubled, value + 1), 100);
}

function flipBooleanValue(value: unknown): unknown {
  return typeof value === 'boolean' ? !value : value;
}

function denseArrayValue(value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0 || value.length >= 8) return value;
  const next = [...value];
  let index = 0;
  while (next.length < 8) {
    next.push(cloneJsonValue(value[index % value.length]));
    index += 1;
  }
  return next;
}

function validatePreviewProps<TProps extends Record<string, unknown>>(
  candidate: TProps,
  validateProps?: (candidate: TProps) => TProps | undefined,
): TProps | undefined {
  if (!validateProps) return candidate;
  try {
    return validateProps(candidate);
  } catch {
    return undefined;
  }
}

function cloneProps<TProps extends Record<string, unknown>>(props: TProps): TProps {
  return cloneJsonValue(props) as TProps;
}

function cloneJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJsonValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}
