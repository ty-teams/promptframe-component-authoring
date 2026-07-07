import React from 'react';

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

type SchemaValueEditorProps = {
  schema?: PromptFramePreviewJsonSchemaLike;
  value: unknown;
  path: string;
  readOnly: boolean;
  locale: PromptFramePreviewLocale;
  onChange: (value: unknown) => void;
};

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
          value: previewProps[control.key] ?? control.defaultValue,
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
    resourcePicker?.({
      control,
      value,
      readOnly,
      onSelect: onChange,
    }) ?? null,
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
  return React.createElement('textarea', {
    readOnly,
    disabled: readOnly,
    'data-preview-props-json-control': control.key,
    defaultValue: JSON.stringify(value ?? createDefaultValueFromSchema(control.schema), null, 2),
    onChange: (event: unknown) => {
      if (readOnly) return;
      const parsed = parsePromptFramePreviewInspectorJsonDraft(eventValue(event), expectedType, locale, control.schema);
      if (parsed.ok) onChange(parsed.value);
    },
    style: textAreaStyle,
  });
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
