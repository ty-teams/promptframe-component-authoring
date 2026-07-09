import React from 'react';
import {
  promptFramePublicResource,
  promptFramePublicResourceSlotFromSchema,
  promptFrameRuntimeResourceMatchesSlot,
  type PromptFramePublicResourceCandidate,
  type PromptFramePublicResourceSlot,
} from './resources.js';
import {
  createPreviewCaseMatrix,
  formatPromptFramePreviewPropLabel,
  type PromptFramePreviewCase,
  type PromptFramePreviewFps,
} from './preview.js';

export type PromptFramePreviewLocale = 'en' | 'zh';
export type PromptFramePreviewJsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
export type PromptFramePreviewControlType = 'array' | 'boolean' | 'color' | 'enum' | 'number' | 'object' | 'text';
export type PromptFramePreviewInspectorDensity = 'comfortable' | 'compact';
export type PromptFramePreviewInspectorScrollMode = 'parent' | 'self';
export type PromptFramePreviewJsonControlType = 'array' | 'object';

export interface PromptFramePreviewJsonSchemaLike {
  type?: PromptFramePreviewJsonSchemaType | PromptFramePreviewJsonSchemaType[];
  description?: string;
  const?: unknown;
  enum?: readonly unknown[];
  format?: string;
  minLength?: number;
  maxLength?: number;
  properties?: Record<string, PromptFramePreviewJsonSchemaLike>;
  items?: PromptFramePreviewJsonSchemaLike;
  required?: readonly string[];
  minimum?: number;
  maximum?: number;
  promptFrameResource?: PromptFramePublicResourceSlot;
  xPromptFrameResource?: PromptFramePublicResourceSlot;
}

export interface PromptFramePreviewControl {
  key: string;
  type: PromptFramePreviewControlType;
  label?: string;
  labelI18n?: Partial<Record<PromptFramePreviewLocale, string>>;
  description?: string;
  descriptionI18n?: Partial<Record<PromptFramePreviewLocale, string>>;
  required?: boolean;
  enumValues?: readonly unknown[];
  defaultValue?: unknown;
  schema?: PromptFramePreviewJsonSchemaLike;
}

export type PromptFramePreviewInspectorJsonDraftResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface PromptFramePreviewResourcePickerInput {
  control: PromptFramePreviewControl;
  resourceSlot: PromptFramePublicResourceSlot;
  value: unknown;
  readOnly: boolean;
  onSelect: (value: unknown) => void;
}

export interface PromptFramePreviewToolbarInput {
  previewProps: Record<string, unknown>;
  reset: () => void;
}

export interface PromptFramePreviewInspectorProps {
  controls: readonly PromptFramePreviewControl[];
  previewProps: Record<string, unknown>;
  initialPreviewProps?: Record<string, unknown>;
  editable?: boolean;
  locale?: PromptFramePreviewLocale;
  onPreviewPropsChange?: (next: Record<string, unknown>) => void;
  renderResourcePicker?: (input: PromptFramePreviewResourcePickerInput) => React.ReactNode;
  renderToolbarActions?: (input: PromptFramePreviewToolbarInput) => React.ReactNode;
  readOnlyNotice?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  density?: PromptFramePreviewInspectorDensity;
  scrollMode?: PromptFramePreviewInspectorScrollMode;
}

export interface PromptFramePreviewControlsFromSchemaOptions {
  propsSchema: unknown;
  defaultProps: Record<string, unknown>;
  labelFormatter?: (key: string) => string;
}

export interface PromptFramePreviewSize {
  label: string;
  width: number;
  height: number;
}

export interface PromptFramePreviewTiming {
  label: string;
  fps: number;
  durationFrames: number;
}

export interface PromptFramePreviewState<TProps extends Record<string, unknown> = Record<string, unknown>> {
  props: TProps;
  size: PromptFramePreviewSize;
  timing: PromptFramePreviewTiming;
  caseName: string;
  locale: PromptFramePreviewLocale;
}

export interface PromptFramePreviewInitialStateInput<TProps extends Record<string, unknown> = Record<string, unknown>> {
  props: TProps;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  caseName?: string;
  locale?: PromptFramePreviewLocale;
  sizeLabel?: string;
  timingLabel?: string;
}

export interface PromptFramePreviewLocaleResolutionInput {
  explicitLocale?: string | null | undefined;
  search?: string | null | undefined;
  envLocale?: string | null | undefined;
  navigatorLanguages?: readonly string[] | null | undefined;
}

export interface PromptFramePreviewEnvelope<TProps extends Record<string, unknown> = Record<string, unknown>> {
  durationFrames: number;
  fps: 30;
  width: number;
  height: number;
  props?: TProps;
}

export interface PromptFramePreviewStageRenderInput<TProps extends Record<string, unknown> = Record<string, unknown>> {
  props: TProps;
  width: number;
  height: number;
  fps: PromptFramePreviewFps;
  durationFrames: number;
}

export interface PromptFramePreviewAppProps<TProps extends Record<string, unknown> = Record<string, unknown>> {
  previewEnvelope: PromptFramePreviewEnvelope<TProps>;
  initialProps: TProps;
  propsSchema?: unknown;
  publicResources?: readonly PromptFramePublicResourceCandidate[];
  locale?: PromptFramePreviewLocale;
  validateProps?: (candidate: Record<string, unknown>) => TProps | undefined;
  renderStage: (input: PromptFramePreviewStageRenderInput<TProps>) => React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

type SchemaValueEditorProps = {
  schema?: PromptFramePreviewJsonSchemaLike;
  value: unknown;
  path: string;
  readOnly: boolean;
  locale: PromptFramePreviewLocale;
  onChange: (value: unknown) => void;
};

export function buildPromptFramePreviewControlsFromSchema({
  propsSchema,
  defaultProps,
  labelFormatter = (key) => key,
}: PromptFramePreviewControlsFromSchemaOptions): PromptFramePreviewControl[] {
  const shape = zodLikeObjectShape(propsSchema);
  const keys = uniqueStrings([...Object.keys(shape), ...Object.keys(defaultProps)]).slice(0, 200);
  return keys.map((key) => {
    const value = defaultProps[key];
    const schema = zodLikeToPreviewJsonSchema(shape[key], value) ?? schemaFromValue(value) ?? { type: 'string' };
    const type = previewControlTypeFromSchema(key, schema, value);
    return {
      key,
      type,
      label: labelFormatter(key),
      description: schema.description,
      required: shape[key] ? zodLikeFieldIsRequired(shape[key]) : undefined,
      enumValues: schema.enum,
      defaultValue: value,
      schema,
    };
  });
}

export function createPromptFramePreviewInitialState<TProps extends Record<string, unknown>>({
  props,
  width,
  height,
  fps,
  durationFrames,
  caseName = 'local-preview-case',
  locale = 'en',
  sizeLabel = `${width}:${height}`,
  timingLabel = `${fps}fps`,
}: PromptFramePreviewInitialStateInput<TProps>): PromptFramePreviewState<TProps> {
  return {
    props: cloneJsonValue(props),
    size: { label: sizeLabel, width, height },
    timing: { label: timingLabel, fps, durationFrames },
    caseName,
    locale,
  };
}

export function resetPromptFramePreviewState<TProps extends Record<string, unknown>>(
  initialState: PromptFramePreviewState<TProps>,
  _currentState?: PromptFramePreviewState<TProps>,
): PromptFramePreviewState<TProps> {
  return cloneJsonValue(initialState);
}

export function resolvePromptFramePreviewLocale({
  explicitLocale,
  search,
  envLocale,
  navigatorLanguages,
}: PromptFramePreviewLocaleResolutionInput = {}): PromptFramePreviewLocale {
  const candidates = [
    explicitLocale,
    localeFromSearch(search),
    envLocale,
    ...(navigatorLanguages ?? []),
  ];
  return candidates.some((candidate) => normalizePreviewLocale(candidate) === 'zh') ? 'zh' : 'en';
}

export function promptFramePreviewControlResourceSlot(
  control: PromptFramePreviewControl | undefined,
): PromptFramePublicResourceSlot | undefined {
  return promptFramePublicResourceSlotFromSchema(control?.schema);
}

const messages = {
  en: {
    addItem: 'Add item',
    advancedJson: 'Advanced JSON',
    array: 'array',
    copyProps: 'Copy props',
    delete: 'Delete',
    duplicate: 'Duplicate',
    invalidArray: 'Enter a valid JSON array.',
    invalidJson: 'Enter valid JSON.',
    invalidObject: 'Enter a valid JSON object.',
    missingDescription: 'No prop description was provided; add schema description or metadata.parameterDescriptions.',
    noControls: 'No schema-derived controls are available.',
    noStructuredFields: 'No structured fields are available; use Advanced JSON.',
    object: 'object',
    readOnly: 'Preview props are read-only in this surface.',
    reset: 'Reset',
  },
  zh: {
    addItem: '添加项',
    advancedJson: '高级 JSON',
    array: '数组',
    copyProps: '复制 props',
    delete: '删除',
    duplicate: '复制',
    invalidArray: '请输入有效的 JSON 数组。',
    invalidJson: '请输入有效的 JSON。',
    invalidObject: '请输入有效的 JSON 对象。',
    missingDescription: '组件未提供参数说明；请在 schema description 或 metadata.parameterDescriptions 补齐。',
    noControls: '当前组件没有可展示的 props 控件。',
    noStructuredFields: '该对象没有可递归展示的字段，可使用高级 JSON。',
    object: '对象',
    readOnly: '当前表面只能查看 props，不能直接修改。',
    reset: '重置默认值',
  },
} as const;

const previewAppMessages = {
  en: {
    aspect: 'Aspect',
    autoCases: 'Auto cases',
    baselineReset: 'Baseline reset',
    diagnostics: 'Diagnostics',
    exportCase: 'Export case',
    fps: 'FPS',
    invalidProps: 'Invalid props',
    noMatchingResources: 'No matching public resources. You can still type a publicPath manually.',
    platformProbeEquivalent: 'Platform probe equivalent',
    preview: 'Preview',
    previewCaseName: 'Preview case name',
    previewControlsAria: 'PromptFrame preview controls',
    props: 'Props',
    propsStress: 'Props stress',
    publicResources: 'Public resources',
  },
  zh: {
    aspect: '画幅',
    autoCases: '自动案例',
    baselineReset: '基线重置',
    diagnostics: '诊断',
    exportCase: '导出案例',
    fps: '帧率',
    invalidProps: '参数无效',
    noMatchingResources: '没有匹配的公共资源；你仍然可以手动输入 publicPath。',
    platformProbeEquivalent: '平台 Probe 等价',
    preview: '预览',
    previewCaseName: '预览案例名称',
    previewControlsAria: 'PromptFrame 预览控制台',
    props: '属性',
    propsStress: '属性压力',
    publicResources: '公共资源',
  },
} as const;

export function parsePromptFramePreviewInspectorJsonDraft(
  draft: string,
  expectedType: PromptFramePreviewJsonControlType,
  locale: PromptFramePreviewLocale = 'en',
  schema?: PromptFramePreviewJsonSchemaLike,
): PromptFramePreviewInspectorJsonDraftResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(draft);
  } catch {
    return { ok: false, error: messages[locale].invalidJson };
  }

  if (expectedType === 'array' && !Array.isArray(parsed)) {
    return { ok: false, error: messages[locale].invalidArray };
  }
  if (expectedType === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
    return { ok: false, error: messages[locale].invalidObject };
  }

  const schemaError = validatePromptFramePreviewValue(parsed, schema);
  if (schemaError) return { ok: false, error: schemaError };
  return { ok: true, value: parsed };
}

export function PromptFramePreviewInspector({
  controls,
  previewProps,
  initialPreviewProps = previewProps,
  editable = true,
  locale = 'en',
  onPreviewPropsChange,
  renderResourcePicker,
  renderToolbarActions,
  readOnlyNotice,
  className,
  style,
  density = 'comfortable',
  scrollMode = 'self',
}: PromptFramePreviewInspectorProps): React.ReactElement {
  const readOnly = !editable;
  const setControlValue = (key: string, value: unknown) => {
    if (readOnly || !onPreviewPropsChange) return;
    onPreviewPropsChange({ ...previewProps, [key]: value });
  };
  const reset = () => {
    if (readOnly || !onPreviewPropsChange) return;
    onPreviewPropsChange({ ...initialPreviewProps });
  };

  if (controls.length === 0) {
    return React.createElement(
      'div',
      {
        className,
        'data-preview-props-inspector': 'true',
        style: shellStyle(style, density),
      },
      React.createElement('div', { style: stateStyle }, messages[locale].noControls),
    );
  }

  const toolbarActions = renderToolbarActions?.({ previewProps, reset });
  return React.createElement(
    'div',
    {
      className,
      'data-preview-props-inspector': 'true',
      style: shellStyle(style, density),
    },
    readOnly
      ? React.createElement('div', { style: stateStyle }, readOnlyNotice ?? messages[locale].readOnly)
      : null,
    React.createElement(
      'div',
      { style: toolbarStyle },
      React.createElement(
        'button',
        {
          type: 'button',
          disabled: readOnly,
          onClick: reset,
          style: actionButtonStyle(readOnly),
        },
        messages[locale].reset,
      ),
      toolbarActions ?? React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => undefined,
          style: actionButtonStyle(false),
        },
        messages[locale].copyProps,
      ),
    ),
    React.createElement(
      'div',
      scrollMode === 'self'
        ? { 'data-preview-props-scroll-pane': 'true', style: scrollPaneStyle }
        : { style: contentStyle },
      controls.map((control) => (
        React.createElement(ControlEditor, {
          key: control.key,
          control,
          value: previewProps[control.key] !== undefined ? previewProps[control.key] : control.defaultValue,
          readOnly,
          locale,
          onChange: (value: unknown) => setControlValue(control.key, value),
          resourcePicker: renderResourcePicker,
        })
      )),
      React.createElement('pre', { style: jsonBoxStyle }, JSON.stringify(previewProps, null, 2)),
    ),
  );
}

export function PromptFramePreviewApp<TProps extends Record<string, unknown>>({
  previewEnvelope,
  initialProps,
  propsSchema,
  publicResources = [],
  locale = 'en',
  validateProps,
  renderStage,
  className,
  style,
}: PromptFramePreviewAppProps<TProps>): React.ReactElement {
  const initialState = React.useMemo(
    () => createPromptFramePreviewInitialState<TProps>({
      props: initialProps,
      width: previewEnvelope.width,
      height: previewEnvelope.height,
      fps: previewEnvelope.fps,
      durationFrames: previewEnvelope.durationFrames,
      caseName: 'local-preview-case',
      locale,
      sizeLabel: previewSizeLabel(previewEnvelope.width, previewEnvelope.height),
    }),
    [initialProps, locale, previewEnvelope.durationFrames, previewEnvelope.fps, previewEnvelope.height, previewEnvelope.width],
  );
  const [previewState, setPreviewState] = React.useState<PromptFramePreviewState<TProps>>(initialState);
  const [status, setStatus] = React.useState('');

  React.useEffect(() => {
    setPreviewState(initialState);
  }, [initialState]);

  const t = (key: keyof typeof previewAppMessages.en) => previewAppMessages[previewState.locale][key];
  const controls = React.useMemo(
    () => buildPromptFramePreviewControlsFromSchema({
      propsSchema,
      defaultProps: initialProps,
      labelFormatter: formatPromptFramePreviewPropLabel,
    }),
    [initialProps, propsSchema],
  );
  const generatedPreviewCases = React.useMemo(
    () => createPreviewCaseMatrix<TProps>({
      basePreview: {
        durationFrames: previewEnvelope.durationFrames,
        fps: previewEnvelope.fps,
        width: previewEnvelope.width,
        height: previewEnvelope.height,
      },
      baseProps: initialProps,
      validateProps: validateProps
        ? (candidate) => validateProps(candidate)
        : undefined,
      aspectPresets: [],
      durationScalePresets: [0.5, 2],
    }),
    [initialProps, previewEnvelope.durationFrames, previewEnvelope.fps, previewEnvelope.height, previewEnvelope.width, validateProps],
  );
  const baselinePreviewCase = generatedPreviewCases.find((previewCase) => previewCase.caseKind === 'baseline_reset');
  const diagnosticPreviewCases = generatedPreviewCases.filter((previewCase) => (
    previewCase.caseKind === 'props_stress'
    || previewCase.caseKind === 'duration_diagnostic'
  ));

  const updateProps = (nextCandidate: Record<string, unknown>) => {
    const parsed = validateProps ? validateProps(nextCandidate) : nextCandidate as TProps;
    if (!parsed) {
      setStatus(t('invalidProps'));
      return;
    }
    setStatus('');
    setPreviewState((current) => ({ ...current, props: parsed }));
  };

  const reset = () => {
    setStatus('');
    setPreviewState(resetPromptFramePreviewState(initialState, previewState));
  };

  const applyGeneratedPreviewCase = (previewCase: PromptFramePreviewCase<TProps>) => {
    setPreviewState((current) => {
      const next: PromptFramePreviewState<TProps> = {
        ...current,
        caseName: previewCase.id,
        props: previewCase.props,
      };
      if (previewCase.caseKind === 'duration_diagnostic') {
        next.timing = {
          label: previewCase.name,
          fps: previewCase.fps,
          durationFrames: previewCase.durationFrames,
        };
      }
      return next;
    });
  };

  const exportPreviewCase = () => {
    const previewCase = {
      name: normalizePreviewCaseName(previewState.caseName),
      width: previewState.size.width,
      height: previewState.size.height,
      fps: previewState.timing.fps,
      durationFrames: previewState.timing.durationFrames,
      props: previewState.props,
      generatedAt: new Date().toISOString(),
    };
    const fileName = `${slugifyPreviewCaseName(previewState.caseName)}.json`;
    const browser = browserDownloadPrimitives();
    if (browser) {
      const blob = new browser.Blob([JSON.stringify(previewCase, null, 2)], { type: 'application/json' });
      const url = browser.URL.createObjectURL(blob);
      const link = browser.document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      browser.URL.revokeObjectURL(url);
    }
    setStatus(previewState.locale === 'zh'
      ? `已导出 ${fileName}。请保存到 .promptframe/local-previews/。`
      : `Exported ${fileName}. Save it under .promptframe/local-previews/.`);
  };

  const fillPlayerByWidth = previewState.size.width >= previewState.size.height;

  return React.createElement(
    'main',
    {
      className,
      'data-promptframe-preview-app': 'true',
      style: previewAppShellStyle(style),
    },
    React.createElement(
      'section',
      {
        'data-promptframe-preview-stage': 'true',
        style: previewStageStyle,
      },
      React.createElement(
        'div',
        {
          'data-promptframe-preview-player': 'true',
          style: previewPlayerStyle(previewState.size, fillPlayerByWidth),
        },
        renderStage({
          props: previewState.props,
          width: previewState.size.width,
          height: previewState.size.height,
          fps: previewState.timing.fps as PromptFramePreviewFps,
          durationFrames: previewState.timing.durationFrames,
        }),
      ),
    ),
    React.createElement(
      'aside',
      {
        'aria-label': t('previewControlsAria'),
        style: previewAsideStyle,
      },
      React.createElement(
        'div',
        {
          'data-promptframe-preview-controls-scroll': 'true',
          style: previewScrollStyle,
        },
        React.createElement(
          'section',
          {
            'data-promptframe-preview-aspect-toolbar': 'true',
            style: previewToolbarStickyStyle,
          },
          React.createElement('h2', { style: previewHeadingStyle }, t('preview')),
          React.createElement(
            'div',
            { 'aria-label': t('aspect'), style: previewAspectGridStyle },
            previewAspectPresets.map((preset) => React.createElement(
              'button',
              {
                key: preset.label,
                'data-promptframe-preview-aspect-case': preset.label,
                type: 'button',
                onClick: () => setPreviewState((current) => ({ ...current, size: { ...preset } })),
                style: previewButtonStyle(previewState.size.label === preset.label),
              },
              preset.label,
            )),
          ),
          React.createElement(
            'p',
            { style: previewMutedTextStyle },
            `${t('fps')}: ${previewState.timing.label} / ${previewState.timing.durationFrames} frames`,
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              'data-promptframe-preview-reset': 'true',
              onClick: reset,
              style: previewPrimaryButtonStyle,
            },
            messages[previewState.locale].reset,
          ),
        ),
        React.createElement(
          'section',
          { style: previewSectionStyle },
          React.createElement(
            'label',
            { style: previewLabelStyle },
            React.createElement('span', { style: previewLabelTextStyle }, t('previewCaseName')),
            React.createElement('input', {
              'data-promptframe-preview-case-name': 'true',
              type: 'text',
              value: previewState.caseName,
              onChange: (event: unknown) => {
                setPreviewState((current) => ({ ...current, caseName: eventValue(event) }));
              },
              style: inputStyle,
            }),
          ),
          React.createElement(
            'button',
            {
              'data-promptframe-preview-case-export': 'true',
              type: 'button',
              onClick: exportPreviewCase,
              style: previewPrimaryButtonStyle,
            },
            t('exportCase'),
          ),
          status ? React.createElement('p', { 'aria-live': 'polite', style: previewMutedTextStyle }, status) : null,
          React.createElement(
            'div',
            { style: previewGeneratedCasesStyle },
            React.createElement('strong', { style: previewLabelTextStyle }, t('autoCases')),
            baselinePreviewCase ? React.createElement(
              'button',
              {
                'data-promptframe-preview-baseline-reset': 'true',
                'data-promptframe-preview-case-apply': baselinePreviewCase.id,
                'data-promptframe-preview-case-kind': baselinePreviewCase.caseKind,
                type: 'button',
                title: baselinePreviewCase.description,
                onClick: () => applyGeneratedPreviewCase(baselinePreviewCase),
                style: previewPrimaryButtonStyle,
              },
              t('baselineReset'),
            ) : null,
            React.createElement('span', { style: previewMutedTextStyle }, `${t('propsStress')} / ${t('diagnostics')}`),
            React.createElement(
              'div',
              { style: previewDiagnosticGridStyle },
              diagnosticPreviewCases.map((previewCase) => React.createElement(
                'button',
                {
                  key: previewCase.id,
                  'data-promptframe-preview-case-apply': previewCase.id,
                  'data-promptframe-preview-case-kind': previewCase.caseKind,
                  type: 'button',
                  title: `${previewCase.description} ${previewCaseCoverageLabel(previewCase, previewState.locale)}`,
                  onClick: () => applyGeneratedPreviewCase(previewCase),
                  style: previewSecondaryButtonStyle,
                },
                React.createElement('span', { style: previewCaseNameStyle }, previewCase.name),
                React.createElement('span', { style: previewMutedTextStyle }, previewCaseCoverageLabel(previewCase, previewState.locale)),
              )),
            ),
          ),
        ),
        React.createElement(
          'section',
          { style: previewPropsSectionStyle },
          React.createElement('h2', { style: previewHeadingStyle }, t('props')),
          React.createElement(PromptFramePreviewInspector, {
            controls,
            initialPreviewProps: initialState.props,
            previewProps: previewState.props,
            editable: true,
            locale: previewState.locale,
            onPreviewPropsChange: updateProps,
            renderResourcePicker: (input) => renderPreviewAppResourcePicker({
              ...input,
              publicResources,
              locale: previewState.locale,
            }),
            renderToolbarActions: () => null,
            scrollMode: 'parent',
          }),
        ),
      ),
    ),
  );
}

function ControlEditor({
  control,
  value,
  readOnly,
  locale,
  onChange,
  resourcePicker,
}: {
  control: PromptFramePreviewControl;
  value: unknown;
  readOnly: boolean;
  locale: PromptFramePreviewLocale;
  onChange: (value: unknown) => void;
  resourcePicker?: PromptFramePreviewInspectorProps['renderResourcePicker'];
}): React.ReactElement {
  const label = controlLabel(control, locale);
  const description = controlDescription(control, locale);
  const resourceSlot = promptFramePreviewControlResourceSlot(control);
  const commonProps = {
    'aria-readonly': readOnly ? 'true' : undefined,
  };

  if (control.type === 'array' || control.type === 'object') {
    const schema = control.schema ?? schemaFromControl(control);
    return React.createElement(
      'section',
      {
        ...commonProps,
        'data-preview-props-structured-control': control.key,
        style: complexControlStyle,
      },
      React.createElement('div', { style: controlHeaderStyle },
        React.createElement('strong', null, `${label}${control.required ? ' *' : ''}`),
        React.createElement('span', null, control.type === 'array' ? messages[locale].array : messages[locale].object),
      ),
      renderDescription(description, control.key, locale),
      React.createElement(SchemaValueEditor, {
        schema,
        value: value ?? createDefaultValueFromSchema(schema),
        path: control.key,
        readOnly,
        locale,
        onChange,
      }),
      React.createElement(
        'details',
        { 'data-preview-props-advanced-json': control.key, style: advancedJsonStyle },
        React.createElement('summary', null, messages[locale].advancedJson),
        React.createElement(PreviewJsonControlEditor, {
          control,
          value,
          readOnly,
          locale,
          onChange,
        }),
      ),
    );
  }

  return React.createElement(
    'label',
    {
      ...commonProps,
      style: fieldShellStyle,
    },
    React.createElement('span', { style: fieldLabelStyle }, `${label}${control.required ? ' *' : ''}`),
    renderScalarInput({
      kind: control.type,
      path: control.key,
      value,
      readOnly,
      schema: schemaFromControl(control),
      enumValues: control.enumValues,
      onChange,
    }),
    renderDescription(description, control.key, locale),
    resourcePicker && resourceSlot
      ? resourcePicker({
        control,
        resourceSlot,
        value,
        readOnly,
        onSelect: onChange,
      })
      : null,
  );
}

function SchemaValueEditor({
  schema,
  value,
  path,
  readOnly,
  locale,
  onChange,
}: SchemaValueEditorProps): React.ReactElement {
  const type = primarySchemaType(schema) ?? inferSchemaTypeFromValue(value);
  if (type === 'array') {
    const items = Array.isArray(value) ? value : [];
    const itemSchema = schema?.items;
    return React.createElement(
      'div',
      { 'data-preview-props-array-control': path, style: arrayControlStyle },
      React.createElement(
        'div',
        { style: arrayToolbarStyle },
        React.createElement('span', null, `${items.length} ${messages[locale].array}`),
        React.createElement('button', {
          type: 'button',
          disabled: readOnly,
          'data-preview-props-array-add': path,
          onClick: () => {
            if (!readOnly) onChange([...items, createDefaultValueFromSchema(itemSchema)]);
          },
          style: inlineActionButtonStyle,
        }, messages[locale].addItem),
      ),
      items.length === 0
        ? React.createElement('span', { style: emptyStructuredStyle }, messages[locale].noStructuredFields)
        : items.map((item, index) => {
          const itemPath = `${path}[${index}]`;
          return React.createElement(
            'div',
            { key: itemPath, 'data-preview-props-array-item': itemPath, style: arrayItemStyle },
            React.createElement(
              'div',
              { style: arrayItemHeaderStyle },
              React.createElement('strong', null, `Item ${index + 1}`),
              React.createElement('span', null,
                React.createElement('button', {
                  type: 'button',
                  disabled: readOnly,
                  onClick: () => {
                    if (!readOnly) onChange([...items.slice(0, index + 1), cloneJsonValue(item), ...items.slice(index + 1)]);
                  },
                  style: inlineActionButtonStyle,
                }, messages[locale].duplicate),
                React.createElement('button', {
                  type: 'button',
                  disabled: readOnly,
                  onClick: () => {
                    if (!readOnly) onChange(items.filter((_, candidateIndex) => candidateIndex !== index));
                  },
                  style: inlineActionButtonStyle,
                }, messages[locale].delete),
              ),
            ),
            React.createElement(SchemaValueEditor, {
              schema: itemSchema ?? schemaFromValue(item),
              value: item,
              path: itemPath,
              readOnly,
              locale,
              onChange: (nextValue) => onChange(items.map((candidate, candidateIndex) => (candidateIndex === index ? nextValue : candidate))),
            }),
          );
        }),
      renderFieldError(path, validatePromptFramePreviewValue(items, schema)),
    );
  }
  if (type === 'object') {
    const record = isPlainRecord(value) ? value : {};
    const properties = schema?.properties ?? {};
    const keys = uniqueStrings([...Object.keys(properties), ...Object.keys(record)]).slice(0, 200);
    return React.createElement(
      'div',
      { 'data-preview-props-object-group': path, style: objectGroupStyle },
      keys.length === 0
        ? React.createElement('span', { style: emptyStructuredStyle }, messages[locale].noStructuredFields)
        : keys.map((key) => {
          const childSchema = properties[key] ?? schemaFromValue(record[key]);
          const childPath = `${path}.${key}`;
          return React.createElement(SchemaValueEditor, {
            key,
            schema: childSchema,
            value: record[key] ?? createDefaultValueFromSchema(childSchema),
            path: childPath,
            readOnly,
            locale,
            onChange: (nextValue) => onChange({ ...record, [key]: nextValue }),
          });
        }),
      renderFieldError(path, validatePromptFramePreviewValue(record, schema)),
    );
  }
  return React.createElement(
    'label',
    { style: fieldShellStyle },
    React.createElement('span', { style: fieldLabelStyle }, lastPathSegment(path)),
    renderScalarInput({
      kind: scalarKindFromSchema(schema, value),
      path,
      value,
      readOnly,
      schema,
      enumValues: schema?.enum,
      onChange,
    }),
    schema?.description ? React.createElement('span', { style: descriptionStyle }, schema.description) : null,
    renderFieldError(path, validatePromptFramePreviewValue(value, schema)),
  );
}

function PreviewJsonControlEditor({
  control,
  value,
  readOnly,
  locale,
  onChange,
}: {
  control: PromptFramePreviewControl;
  value: unknown;
  readOnly: boolean;
  locale: PromptFramePreviewLocale;
  onChange: (value: unknown) => void;
}) {
  const expectedType = control.type === 'array' ? 'array' : 'object';
  const serializedValue = React.useMemo(
    () => JSON.stringify(value !== undefined ? value : createDefaultValueFromSchema(control.schema), null, 2),
    [control.schema, value],
  );
  const [draft, setDraft] = React.useState(serializedValue);
  const [error, setError] = React.useState<string | null>(null);
  const errorId = `preview-props-json-error-${control.key.replace(/[^A-Za-z0-9_-]/g, '-')}`;

  React.useEffect(() => {
    setDraft(serializedValue);
    setError(null);
  }, [serializedValue]);

  return React.createElement(React.Fragment, null,
    React.createElement('textarea', {
      readOnly,
      disabled: readOnly,
      'aria-invalid': error ? 'true' : undefined,
      'aria-describedby': error ? errorId : undefined,
      'data-preview-props-json-control': control.key,
      value: draft,
      onChange: (event: unknown) => {
        if (readOnly) return;
        const nextDraft = eventValue(event);
        setDraft(nextDraft);
        const parsed = parsePromptFramePreviewInspectorJsonDraft(nextDraft, expectedType, locale, control.schema);
        if (!parsed.ok) {
          setError(parsed.error);
          return;
        }
        setError(null);
        onChange(parsed.value);
      },
      style: textAreaStyle,
    }),
    error
      ? React.createElement('span', { id: errorId, 'data-preview-props-json-error': control.key, style: errorStyle }, error)
      : null,
  );
}

function renderScalarInput({
  kind,
  path,
  value,
  readOnly,
  schema,
  enumValues,
  onChange,
}: {
  kind: PromptFramePreviewControlType;
  path: string;
  value: unknown;
  readOnly: boolean;
  schema?: PromptFramePreviewJsonSchemaLike;
  enumValues?: readonly unknown[];
  onChange: (value: unknown) => void;
}): React.ReactElement {
  if (kind === 'boolean') {
    return React.createElement('input', {
      type: 'checkbox',
      checked: Boolean(value),
      disabled: readOnly,
      'data-preview-props-field': path,
      onChange: (event: unknown) => onChange(eventChecked(event)),
    });
  }
  if (kind === 'enum') {
    return React.createElement(
      'select',
      {
        value: String(value ?? ''),
        disabled: readOnly,
        'data-preview-props-field': path,
        onChange: (event: unknown) => onChange(coerceEnumValue(eventValue(event), enumValues)),
        style: inputStyle,
      },
      (enumValues ?? []).map((option) => React.createElement('option', { key: String(option), value: String(option) }, String(option))),
    );
  }
  if (kind === 'number') {
    return React.createElement('input', {
      type: 'number',
      value: typeof value === 'number' ? value : '',
      min: schema?.minimum,
      max: schema?.maximum,
      step: primarySchemaType(schema) === 'integer' ? 1 : 'any',
      readOnly,
      disabled: readOnly,
      'data-preview-props-field': path,
      onChange: (event: unknown) => {
        const nextValue = eventValue(event);
        onChange(nextValue.trim() === '' ? undefined : Number(nextValue));
      },
      style: inputStyle,
    });
  }
  if (kind === 'color') {
    return React.createElement('span', { style: colorFieldStyle },
      React.createElement('span', {
        'data-preview-props-color-swatch': path,
        style: {
          ...colorSwatchStyle,
          background: typeof value === 'string' ? value : '#000000',
        },
      }),
      React.createElement('input', {
        type: 'color',
        value: typeof value === 'string' && isHexColor(value) ? value : '#000000',
        disabled: readOnly,
        'data-preview-props-field': path,
        onChange: (event: unknown) => onChange(eventValue(event)),
        style: inputStyle,
      }),
    );
  }
  return React.createElement('input', {
    type: 'text',
    value: String(value ?? ''),
    readOnly,
    disabled: readOnly,
    'data-preview-props-field': path,
    onChange: (event: unknown) => onChange(eventValue(event)),
    style: inputStyle,
  });
}

const previewAspectPresets: PromptFramePreviewSize[] = [
  { label: '16:9', width: 1280, height: 720 },
  { label: '9:16', width: 720, height: 1280 },
  { label: '1:1', width: 960, height: 960 },
];

function renderPreviewAppResourcePicker({
  control,
  resourceSlot,
  readOnly,
  onSelect,
  publicResources,
  locale,
}: PromptFramePreviewResourcePickerInput & {
  publicResources: readonly PromptFramePublicResourceCandidate[];
  locale: PromptFramePreviewLocale;
}): React.ReactElement {
  const candidates = publicResources.filter((resource) => promptFrameRuntimeResourceMatchesSlot(resource, resourceSlot));
  return React.createElement(
    'div',
    {
      'data-promptframe-preview-resource-picker': control.key,
      style: resourcePickerShellStyle,
    },
    React.createElement('span', { style: resourcePickerTitleStyle }, previewAppMessages[locale].publicResources),
    candidates.length === 0
      ? React.createElement('span', { 'data-promptframe-preview-resource-empty': control.key, style: previewMutedTextStyle }, previewAppMessages[locale].noMatchingResources)
      : React.createElement(
        'div',
        { style: resourcePickerButtonGridStyle },
        candidates.map((resource) => React.createElement(
          'button',
          {
            key: resource.publicPath,
            'data-promptframe-preview-resource-select': resource.publicPath,
            type: 'button',
            disabled: readOnly,
            title: `${resource.publicPath} / ${resource.contentType}`,
            onClick: () => onSelect(promptFramePublicResource(undefined, resource.publicPath, resource.publicPath)),
            style: previewTinyButtonStyle(readOnly),
          },
          resourceLabel(resource),
        )),
      ),
  );
}

function previewSizeLabel(width: number, height: number): string {
  return previewAspectPresets.find((preset) => preset.width === width && preset.height === height)?.label ?? 'Custom';
}

function normalizePreviewCaseName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : 'local-preview-case';
}

function slugifyPreviewCaseName(name: string): string {
  const slug = normalizePreviewCaseName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'local-preview-case';
}

function previewCaseCoverageLabel(previewCase: PromptFramePreviewCase, locale: PromptFramePreviewLocale): string {
  return previewCase.probeCoverage === 'platform_probe_equivalent'
    ? previewAppMessages[locale].platformProbeEquivalent
    : 'Local diagnostic only';
}

function resourceLabel(resource: PromptFramePublicResourceCandidate): string {
  return resource.publicPath.split('/').filter(Boolean).pop() ?? resource.publicPath;
}

function validatePromptFramePreviewValue(
  value: unknown,
  schema?: PromptFramePreviewJsonSchemaLike,
  path = '',
): string | null {
  if (!schema) return null;
  const type = primarySchemaType(schema);
  if ('const' in schema && schema.const !== undefined && !isJsonEqual(schema.const, value)) {
    return `${path ? `${path} ` : ''}must match the const value.`;
  }
  if (type && !schemaTypeMatches(value, type)) return `${path ? `${path} ` : ''}must be ${type}.`;
  if (type === 'string' && typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `${path ? `${path} ` : ''}must be at least ${schema.minLength} characters.`;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `${path ? `${path} ` : ''}must be at most ${schema.maxLength} characters.`;
    }
    if (schema.format === 'color' && !isHexColor(value)) {
      return `${path ? `${path} ` : ''}must be a valid color value.`;
    }
  }
  if ((type === 'number' || type === 'integer') && typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${path ? `${path} ` : ''}must be >= ${schema.minimum}.`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path ? `${path} ` : ''}must be <= ${schema.maximum}.`;
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    return `${path ? `${path} ` : ''}must be one of ${schema.enum.map(String).join(', ')}.`;
  }
  if ((type === 'object' || schema.properties) && isPlainRecord(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) return `${path ? `${path}.${key}` : key} is required.`;
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (!(key in value)) continue;
      const childError = validatePromptFramePreviewValue(value[key], childSchema, path ? `${path}.${key}` : key);
      if (childError) return childError;
    }
  }
  if ((type === 'array' || schema.items) && Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const childError = validatePromptFramePreviewValue(value[index], schema.items, `${path}[${index}]`);
      if (childError) return childError;
    }
  }
  return null;
}

function renderDescription(description: string | undefined, key: string, locale: PromptFramePreviewLocale) {
  if (description) return React.createElement('span', { style: descriptionStyle }, description);
  return React.createElement('span', { 'data-preview-props-missing-description': key, style: missingDescriptionStyle }, messages[locale].missingDescription);
}

function renderFieldError(path: string, error: string | null) {
  if (!error) return null;
  return React.createElement('span', { 'data-preview-props-field-error': path, style: errorStyle }, error);
}

function controlLabel(control: PromptFramePreviewControl, locale: PromptFramePreviewLocale): string {
  return control.labelI18n?.[locale] ?? control.labelI18n?.en ?? control.labelI18n?.zh ?? control.label ?? control.key;
}

function controlDescription(control: PromptFramePreviewControl, locale: PromptFramePreviewLocale): string | undefined {
  return control.descriptionI18n?.[locale] ?? control.descriptionI18n?.en ?? control.descriptionI18n?.zh ?? control.description;
}

function schemaFromControl(control: PromptFramePreviewControl): PromptFramePreviewJsonSchemaLike {
  if (control.schema) return control.schema;
  if (control.type === 'enum') return { type: 'string', enum: control.enumValues };
  if (control.type === 'text' || control.type === 'color') return { type: 'string' };
  if (control.type === 'number') return { type: 'number' };
  if (control.type === 'boolean') return { type: 'boolean' };
  return { type: control.type };
}

function schemaFromValue(value: unknown): PromptFramePreviewJsonSchemaLike | undefined {
  if (Array.isArray(value)) return { type: 'array', items: schemaFromValue(value[0]) };
  if (isPlainRecord(value)) {
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, schemaFromValue(nested) ?? {}])),
    };
  }
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'number') return { type: 'number' };
  if (typeof value === 'string') return { type: 'string' };
  return undefined;
}

function previewControlTypeFromSchema(
  key: string,
  schema: PromptFramePreviewJsonSchemaLike,
  value: unknown,
): PromptFramePreviewControlType {
  if (schema.enum?.length) return 'enum';
  const type = primarySchemaType(schema);
  if (type === 'array') return 'array';
  if (type === 'object') return 'object';
  if (type === 'boolean') return 'boolean';
  if (type === 'number' || type === 'integer') return 'number';
  if (typeof value === 'string' && /color|colour|accent|background/i.test(key) && isHexColor(value)) return 'color';
  return 'text';
}

function zodLikeToPreviewJsonSchema(schemaLike: unknown, fallbackValue?: unknown): PromptFramePreviewJsonSchemaLike | undefined {
  if (!schemaLike) return undefined;
  const unwrapped = unwrapZodLikeSchema(schemaLike);
  const def = zodLikeDef(unwrapped);
  const typeName = zodLikeTypeName(unwrapped);
  const description = zodLikeDescription(schemaLike) ?? zodLikeDescription(unwrapped);
  let schema: PromptFramePreviewJsonSchemaLike | undefined;

  if (typeName.includes('array')) {
    schema = {
      type: 'array',
      items: zodLikeToPreviewJsonSchema(def?.type ?? def?.element, Array.isArray(fallbackValue) ? fallbackValue[0] : undefined),
    };
  } else if (typeName.includes('object')) {
    const shape = zodLikeObjectShape(unwrapped);
    const properties = Object.fromEntries(
      Object.entries(shape).map(([key, child]) => [key, zodLikeToPreviewJsonSchema(child, isPlainRecord(fallbackValue) ? fallbackValue[key] : undefined) ?? {}]),
    );
    schema = {
      type: 'object',
      properties,
      required: Object.entries(shape)
        .filter(([, child]) => zodLikeFieldIsRequired(child))
        .map(([key]) => key),
    };
  } else if (typeName.includes('enum')) {
    schema = {
      type: 'string',
      enum: zodLikeEnumValues(def?.values ?? def?.entries ?? def?.options),
    };
  } else if (typeName.includes('literal')) {
    const literalValue = def?.value;
    schema = {
      type: schemaFromValue(literalValue)?.type,
      const: literalValue,
    };
  } else if (typeName.includes('boolean')) {
    schema = { type: 'boolean' };
  } else if (typeName.includes('number')) {
    schema = { type: 'number', ...zodLikeNumericBounds(def) };
  } else if (typeName.includes('bigint')) {
    schema = { type: 'integer', ...zodLikeNumericBounds(def) };
  } else if (typeName.includes('string')) {
    schema = { type: 'string', ...zodLikeStringBounds(def) };
  } else {
    schema = schemaFromValue(fallbackValue);
  }

  const resourceSlot = promptFramePublicResourceSlotFromSchema(schemaLike) ?? promptFramePublicResourceSlotFromSchema(def);
  return schema ? {
    ...schema,
    ...(description ? { description } : {}),
    ...(resourceSlot ? { promptFrameResource: resourceSlot } : {}),
  } : undefined;
}

function zodLikeObjectShape(schemaLike: unknown): Record<string, unknown> {
  const unwrapped = unwrapZodLikeSchema(schemaLike);
  if (!isPlainRecord(unwrapped)) return {};
  const directShape = unwrapped.shape;
  if (isPlainRecord(directShape)) return directShape;
  if (typeof directShape === 'function') return recordFromMaybe(directShape());
  const def = zodLikeDef(unwrapped);
  if (typeof def?.shape === 'function') return recordFromMaybe(def.shape());
  return recordFromMaybe(def?.shape);
}

function zodLikeFieldIsRequired(schemaLike: unknown): boolean {
  const typeName = zodLikeTypeName(schemaLike);
  if (typeName.includes('optional') || typeName.includes('default') || typeName.includes('catch') || typeName.includes('nullable')) {
    return false;
  }
  return true;
}

function unwrapZodLikeSchema(schemaLike: unknown): unknown {
  let current = schemaLike;
  for (let depth = 0; depth < 20; depth += 1) {
    const def = zodLikeDef(current);
    const typeName = zodLikeTypeName(current);
    if (
      typeName.includes('default')
      || typeName.includes('optional')
      || typeName.includes('nullable')
      || typeName.includes('catch')
      || typeName.includes('effects')
      || typeName.includes('branded')
      || typeName.includes('readonly')
      || typeName.includes('promise')
    ) {
      const next = def?.innerType ?? def?.schema ?? def?.type;
      if (next && next !== current) {
        current = next;
        continue;
      }
    }
    return current;
  }
  return current;
}

function zodLikeDescription(schemaLike: unknown): string | undefined {
  if (!isPlainRecord(schemaLike)) return undefined;
  if (typeof schemaLike.description === 'string' && schemaLike.description.trim()) return schemaLike.description;
  const def = zodLikeDef(schemaLike);
  return typeof def?.description === 'string' && def.description.trim() ? def.description : undefined;
}

function zodLikeDef(schemaLike: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(schemaLike) && isPlainRecord(schemaLike._def) ? schemaLike._def : undefined;
}

function zodLikeTypeName(schemaLike: unknown): string {
  const def = zodLikeDef(schemaLike);
  const raw = def?.typeName ?? def?.type;
  return typeof raw === 'string' ? raw.toLowerCase() : '';
}

function zodLikeEnumValues(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (isPlainRecord(value)) return Object.values(value).filter((item) => typeof item === 'string' || typeof item === 'number');
  return undefined;
}

function zodLikeNumericBounds(def: Record<string, unknown> | undefined): Pick<PromptFramePreviewJsonSchemaLike, 'minimum' | 'maximum'> {
  const checks = Array.isArray(def?.checks) ? def.checks : [];
  const bounds: Pick<PromptFramePreviewJsonSchemaLike, 'minimum' | 'maximum'> = {};
  for (const check of checks) {
    if (!isPlainRecord(check)) continue;
    if (check.kind === 'min' && typeof check.value === 'number') bounds.minimum = check.value;
    if (check.kind === 'max' && typeof check.value === 'number') bounds.maximum = check.value;
  }
  return bounds;
}

function zodLikeStringBounds(def: Record<string, unknown> | undefined): Pick<PromptFramePreviewJsonSchemaLike, 'minLength' | 'maxLength'> {
  const checks = Array.isArray(def?.checks) ? def.checks : [];
  const bounds: Pick<PromptFramePreviewJsonSchemaLike, 'minLength' | 'maxLength'> = {};
  for (const check of checks) {
    if (!isPlainRecord(check)) continue;
    if (check.kind === 'min' && typeof check.value === 'number') bounds.minLength = check.value;
    if (check.kind === 'max' && typeof check.value === 'number') bounds.maxLength = check.value;
  }
  return bounds;
}

function recordFromMaybe(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function createDefaultValueFromSchema(schema?: PromptFramePreviewJsonSchemaLike): unknown {
  const type = primarySchemaType(schema);
  if (type === 'array') return [];
  if (type === 'object') {
    return Object.fromEntries(Object.entries(schema?.properties ?? {}).map(([key, child]) => [key, createDefaultValueFromSchema(child)]));
  }
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return 0;
  if (schema?.enum?.length) return schema.enum[0];
  return '';
}

function primarySchemaType(schema?: PromptFramePreviewJsonSchemaLike): PromptFramePreviewJsonSchemaType | undefined {
  const type = schema?.type;
  return Array.isArray(type) ? type.find((candidate) => candidate !== 'null') : type;
}

function inferSchemaTypeFromValue(value: unknown): PromptFramePreviewJsonSchemaType {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

function scalarKindFromSchema(schema: PromptFramePreviewJsonSchemaLike | undefined, value: unknown): PromptFramePreviewControlType {
  if (schema?.enum?.length) return 'enum';
  const type = primarySchemaType(schema);
  if (type === 'boolean') return 'boolean';
  if (type === 'number' || type === 'integer') return 'number';
  if (typeof value === 'string' && isHexColor(value)) return 'color';
  return 'text';
}

function schemaTypeMatches(value: unknown, type: PromptFramePreviewJsonSchemaType): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isPlainRecord(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function coerceEnumValue(value: string, values?: readonly unknown[]): unknown {
  return values?.find((candidate) => String(candidate) === value) ?? value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function browserDownloadPrimitives(): {
  Blob: new (parts: string[], options: { type: string }) => unknown;
  URL: {
    createObjectURL(blob: unknown): string;
    revokeObjectURL(url: string): void;
  };
  document: {
    createElement(tagName: 'a'): {
      href: string;
      download: string;
      click(): void;
    };
  };
} | undefined {
  const global = globalThis as unknown as {
    Blob?: new (parts: string[], options: { type: string }) => unknown;
    URL?: {
      createObjectURL?: (blob: unknown) => string;
      revokeObjectURL?: (url: string) => void;
    };
    document?: {
      createElement?: (tagName: 'a') => {
        href: string;
        download: string;
        click: () => void;
      };
    };
  };
  if (
    !global.Blob
    || !global.URL?.createObjectURL
    || !global.URL.revokeObjectURL
    || !global.document?.createElement
  ) {
    return undefined;
  }
  return {
    Blob: global.Blob,
    URL: {
      createObjectURL: global.URL.createObjectURL,
      revokeObjectURL: global.URL.revokeObjectURL,
    },
    document: {
      createElement: (tagName) => {
        const element = global.document?.createElement?.(tagName);
        if (element) return element;
        return { href: '', download: '', click: () => undefined };
      },
    },
  };
}

function localeFromSearch(search: string | null | undefined): string | undefined {
  if (!search) return undefined;
  const query = search.startsWith('?') ? search.slice(1) : search;
  for (const part of query.split('&')) {
    const [rawKey, rawValue = ''] = part.split('=');
    const key = decodeURIComponentSafe(rawKey.replace(/\+/g, ' '));
    if (key !== 'locale' && key !== 'lang') continue;
    return decodeURIComponentSafe(rawValue.replace(/\+/g, ' '));
  }
  return undefined;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePreviewLocale(candidate: string | null | undefined): PromptFramePreviewLocale | undefined {
  if (!candidate) return undefined;
  const normalized = candidate.trim().toLowerCase().replace('_', '-');
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  return undefined;
}

function eventValue(event: unknown): string {
  const target = eventTarget(event);
  return typeof target.value === 'string' ? target.value : '';
}

function eventChecked(event: unknown): boolean {
  const target = eventTarget(event);
  return target.checked === true;
}

function eventTarget(event: unknown): { value?: unknown; checked?: unknown } {
  if (!event || typeof event !== 'object') return {};
  const candidate = event as {
    currentTarget?: { value?: unknown; checked?: unknown };
    target?: { value?: unknown; checked?: unknown };
  };
  return candidate.currentTarget ?? candidate.target ?? {};
}

function lastPathSegment(path: string): string {
  return path.replace(/\[\d+\]/g, '').split('.').filter(Boolean).at(-1) ?? path;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function shellStyle(style: React.CSSProperties | undefined, density: PromptFramePreviewInspectorDensity): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: density === 'compact' ? 8 : 12,
    color: 'var(--pf-preview-text, #172033)',
    ...style,
  };
}

const stateStyle: React.CSSProperties = {
  border: '1px dashed var(--pf-preview-border, #cbd5e1)',
  borderRadius: 8,
  padding: 12,
  color: 'var(--pf-preview-muted, #64748b)',
};

const toolbarStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const contentStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const scrollPaneStyle: React.CSSProperties = { ...contentStyle, maxHeight: 420, overflow: 'auto', paddingRight: 4 };
const complexControlStyle: React.CSSProperties = { border: '1px solid var(--pf-preview-border, #e2e8f0)', borderRadius: 8, padding: 12, display: 'grid', gap: 8 };
const controlHeaderStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' };
const fieldShellStyle: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12 };
const fieldLabelStyle: React.CSSProperties = { fontWeight: 700 };
const inputStyle: React.CSSProperties = { border: '1px solid var(--pf-preview-border, #cbd5e1)', borderRadius: 6, padding: '7px 9px', font: 'inherit' };
const textAreaStyle: React.CSSProperties = { ...inputStyle, minHeight: 96, width: '100%', fontFamily: 'monospace' };
const descriptionStyle: React.CSSProperties = { color: 'var(--pf-preview-muted, #64748b)', fontSize: 12 };
const missingDescriptionStyle: React.CSSProperties = { ...descriptionStyle, fontStyle: 'italic' };
const errorStyle: React.CSSProperties = { color: '#b91c1c', fontSize: 12 };
const objectGroupStyle: React.CSSProperties = { display: 'grid', gap: 8, padding: 8, borderLeft: '2px solid var(--pf-preview-border, #e2e8f0)' };
const arrayControlStyle: React.CSSProperties = { display: 'grid', gap: 8 };
const arrayToolbarStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const arrayItemStyle: React.CSSProperties = { border: '1px solid var(--pf-preview-border, #e2e8f0)', borderRadius: 8, padding: 8, display: 'grid', gap: 8 };
const arrayItemHeaderStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const inlineActionButtonStyle: React.CSSProperties = { border: '1px solid var(--pf-preview-border, #cbd5e1)', borderRadius: 6, padding: '5px 8px', background: '#fff' };
const emptyStructuredStyle: React.CSSProperties = { color: 'var(--pf-preview-muted, #64748b)', fontSize: 12 };
const advancedJsonStyle: React.CSSProperties = { display: 'grid', gap: 6 };
const colorFieldStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const colorSwatchStyle: React.CSSProperties = { width: 20, height: 20, borderRadius: 999, border: '1px solid var(--pf-preview-border, #cbd5e1)', display: 'inline-block' };
const jsonBoxStyle: React.CSSProperties = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, overflow: 'auto', fontSize: 12 };
const previewStageStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, width: '100%', height: '100%', display: 'grid', placeItems: 'center', overflow: 'hidden' };
const previewAsideStyle: React.CSSProperties = { alignSelf: 'stretch', background: '#f8fafc', color: '#111827', borderRadius: 8, boxSizing: 'border-box', maxHeight: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const previewScrollStyle: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 18, boxSizing: 'border-box', overscrollBehavior: 'contain' };
const previewToolbarStickyStyle: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc', paddingBottom: 12, borderBottom: '1px solid #e2e8f0', display: 'grid', gap: 8 };
const previewHeadingStyle: React.CSSProperties = { fontSize: 16, margin: 0, letterSpacing: 0 };
const previewAspectGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 };
const previewMutedTextStyle: React.CSSProperties = { color: '#64748b', fontSize: 12, margin: 0 };
const previewSectionStyle: React.CSSProperties = { marginTop: 16, display: 'grid', gap: 10 };
const previewPropsSectionStyle: React.CSSProperties = { marginTop: 22 };
const previewLabelStyle: React.CSSProperties = { display: 'grid', gap: 6, fontSize: 13 };
const previewLabelTextStyle: React.CSSProperties = { color: '#334155', fontWeight: 700, fontSize: 13 };
const previewGeneratedCasesStyle: React.CSSProperties = { display: 'grid', gap: 8 };
const previewDiagnosticGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 };
const previewPrimaryButtonStyle: React.CSSProperties = { border: '1px solid #111827', borderRadius: 6, background: '#111827', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 700, padding: '8px 10px', cursor: 'pointer' };
const previewSecondaryButtonStyle: React.CSSProperties = { border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', color: '#111827', font: 'inherit', fontSize: 12, padding: '8px 10px', cursor: 'pointer', display: 'grid', gap: 4 };
const previewCaseNameStyle: React.CSSProperties = { display: 'block', fontWeight: 700 };
const resourcePickerShellStyle: React.CSSProperties = { display: 'grid', gap: 6, marginTop: 8 };
const resourcePickerTitleStyle: React.CSSProperties = { color: '#64748b', fontSize: 12, fontWeight: 700 };
const resourcePickerButtonGridStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

function actionButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    border: '1px solid var(--pf-preview-border, #cbd5e1)',
    borderRadius: 6,
    padding: '6px 10px',
    background: '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  };
}

function previewAppShellStyle(style: React.CSSProperties | undefined): React.CSSProperties {
  return {
    width: '100%',
    height: '100%',
    margin: 0,
    background: '#111827',
    color: '#f8fafc',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)',
    gap: 24,
    padding: 24,
    boxSizing: 'border-box',
    overflow: 'hidden',
    ...style,
  };
}

function previewPlayerStyle(size: PromptFramePreviewSize, fillByWidth: boolean): React.CSSProperties {
  return {
    width: fillByWidth ? '100%' : 'auto',
    height: fillByWidth ? 'auto' : '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    aspectRatio: `${size.width} / ${size.height}`,
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
    background: '#000',
    boxShadow: '0 18px 60px rgba(0, 0, 0, 0.38)',
  };
}

function previewButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    background: active ? '#111827' : '#fff',
    color: active ? '#fff' : '#111827',
    font: 'inherit',
    padding: '8px 10px',
    cursor: 'pointer',
  };
}

function previewTinyButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    background: '#fff',
    color: '#111827',
    cursor: disabled ? 'not-allowed' : 'pointer',
    font: 'inherit',
    fontSize: 12,
    padding: '5px 8px',
  };
}
