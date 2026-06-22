import { Player } from '@remotion/player';
import { createPreviewCaseMatrix, type PromptFramePreviewCase } from '@promptframe/component-kit/preview';
import { StrictMode, type ReactNode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Component from './Component';
import previewEnvelope from './preview-props.json';
import { propsSchema, type ComponentProps } from './schema';

const preview = previewEnvelope as {
  durationFrames: number;
  fps: 30;
  width: number;
  height: number;
  props?: unknown;
};

type PreviewSize = {
  label: string;
  width: number;
  height: number;
};

type PreviewCase = {
  name: string;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  props: ComponentProps;
  generatedAt: string;
};

type PropPath = Array<string | number>;

type PreviewLocale = 'en' | 'zh';

type PreviewMessageKey =
  | 'advancedJson'
  | 'aspect'
  | 'autoCases'
  | 'custom'
  | 'exportCase'
  | 'invalidJson'
  | 'invalidProps'
  | 'item'
  | 'jsonParseFallback'
  | 'noItems'
  | 'preview'
  | 'previewCaseName'
  | 'previewControlsAria'
  | 'props'
  | 'schemaValidationFailed';

const previewMessages: Record<PreviewLocale, Record<PreviewMessageKey, string>> = {
  en: {
    advancedJson: 'Advanced JSON',
    aspect: 'Aspect',
    autoCases: 'Auto cases',
    custom: 'Custom',
    exportCase: 'Export case',
    invalidJson: 'Invalid JSON',
    invalidProps: 'Invalid props',
    item: 'Item',
    jsonParseFallback: 'Unable to parse JSON.',
    noItems: 'No items',
    preview: 'Preview',
    previewCaseName: 'Preview case name',
    previewControlsAria: 'PromptFrame preview controls',
    props: 'Props',
    schemaValidationFailed: 'Schema validation failed.',
  },
  zh: {
    advancedJson: '高级 JSON',
    aspect: '画幅',
    autoCases: '自动案例',
    custom: '自定义',
    exportCase: '导出案例',
    invalidJson: 'JSON 无效',
    invalidProps: '参数无效',
    item: '项目',
    jsonParseFallback: '无法解析 JSON。',
    noItems: '暂无项目',
    preview: '预览',
    previewCaseName: '预览案例名称',
    previewControlsAria: 'PromptFrame 预览控制台',
    props: '属性',
    schemaValidationFailed: 'Schema 校验失败。',
  },
};

function resolvePreviewLocale(): PreviewLocale {
  const language = typeof navigator === 'undefined' ? '' : navigator.language.toLowerCase();
  return language.startsWith('zh') ? 'zh' : 'en';
}

const previewLocale = resolvePreviewLocale();
const isZh = previewLocale === 'zh';

function t(key: PreviewMessageKey): string {
  return previewMessages[previewLocale][key];
}

function formatPropLabel(rawKey: string): string {
  const spaced = rawKey
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  if (!spaced) {
    return rawKey;
  }

  return spaced.replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

const initialPropsParse = propsSchema.safeParse(preview.props ?? {});
const initialProps: ComponentProps = initialPropsParse.success
  ? initialPropsParse.data
  : propsSchema.parse({});

const previewAspectPresets = [
  { label: '16:9', width: 1280, height: 720 },
  { label: '9:16', width: 720, height: 1280 },
  { label: '1:1', width: 960, height: 960 },
] as const;

const matchedInitialSize = previewAspectPresets.find(
  ({ width, height }) => width === preview.width && height === preview.height,
);
const initialSize: PreviewSize = matchedInitialSize
  ? { ...matchedInitialSize }
  : { label: t('custom'), width: preview.width, height: preview.height };
const defaultPreviewCaseName = 'local-preview-case';
const generatedPreviewCases = createPreviewCaseMatrix<ComponentProps>({
  basePreview: {
    durationFrames: preview.durationFrames,
    fps: preview.fps,
    width: preview.width,
    height: preview.height,
  },
  baseProps: initialProps,
  validateProps: (candidate) => {
    const parsed = propsSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
  },
  aspectPresets: previewAspectPresets.map((preset) => ({
    id: `aspect-${preset.label.replace(':', '-')}`,
    name: preset.label,
    width: preset.width,
    height: preset.height,
  })),
});

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing preview root element');
}

function isColorValue(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isJsonLikeValue(value: unknown): value is Record<string, unknown> | unknown[] | null {
  return value === null || typeof value === 'object';
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatPathKey(path: PropPath): string {
  return path.map(String).join('.');
}

function getValueAtPath(rootValue: unknown, path: PropPath): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && typeof segment === 'number') {
      return current[segment];
    }
    if (isRecordValue(current) && typeof segment === 'string') {
      return current[segment];
    }
    return undefined;
  }, rootValue);
}

function setValueAtPath(rootValue: unknown, path: PropPath, nextValue: unknown): unknown {
  if (path.length === 0) {
    return nextValue;
  }

  const [segment, ...rest] = path;
  if (Array.isArray(rootValue) && typeof segment === 'number') {
    const clone = [...rootValue];
    clone[segment] = setValueAtPath(clone[segment], rest, nextValue);
    return clone;
  }

  if (isRecordValue(rootValue) && typeof segment === 'string') {
    return {
      ...rootValue,
      [segment]: setValueAtPath(rootValue[segment], rest, nextValue),
    };
  }

  return rootValue;
}

function formatJsonValue(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '';
}

function formatPrimitiveControlValue(value: unknown): string | number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return typeof value === 'string' ? value : '';
}

function coerceControlValue(currentValue: unknown, rawValue: string): unknown {
  if (typeof currentValue === 'number') {
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) ? numeric : currentValue;
  }
  if (typeof currentValue === 'boolean') {
    return rawValue === 'true';
  }
  if (isJsonLikeValue(currentValue)) {
    try {
      return JSON.parse(rawValue);
    } catch {
      return currentValue;
    }
  }
  return rawValue;
}

function parseJsonDraft(rawValue: string): { success: true; value: unknown } | { success: false; message: string } {
  try {
    return { success: true, value: JSON.parse(rawValue) };
  } catch (error) {
    const message = error instanceof Error ? error.message : t('jsonParseFallback');
    return { success: false, message: `${t('invalidJson')}: ${message}` };
  }
}

function formatPropsParseError(error: { issues?: Array<{ path?: Array<string | number>; message?: string }> }): string {
  const firstIssue = error.issues?.[0];
  const path = firstIssue?.path?.length ? `${firstIssue.path.join('.')}: ` : '';
  return `${path}${firstIssue?.message ?? t('schemaValidationFailed')}`;
}

function normalizePreviewCaseName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : defaultPreviewCaseName;
}

function slugifyPreviewCaseName(name: string): string {
  const slug = normalizePreviewCaseName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : defaultPreviewCaseName;
}

function buildPreviewCase({
  name,
  inputProps,
  previewSize,
}: {
  name: string;
  inputProps: ComponentProps;
  previewSize: PreviewSize;
}): PreviewCase {
  return {
    name: normalizePreviewCaseName(name),
    width: previewSize.width,
    height: previewSize.height,
    fps: preview.fps,
    durationFrames: preview.durationFrames,
    props: inputProps,
    generatedAt: new Date().toISOString(),
  };
}

function downloadPreviewCase(previewCase: PreviewCase): string {
  const fileName = `${slugifyPreviewCaseName(previewCase.name)}.json`;
  const blob = new Blob([JSON.stringify(previewCase, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);

  return fileName;
}

function PreviewApp() {
  const [inputProps, setInputProps] = useState<ComponentProps>(initialProps);
  const [previewSize, setPreviewSize] = useState(initialSize);
  const [previewCaseName, setPreviewCaseName] = useState(defaultPreviewCaseName);
  const [exportStatus, setExportStatus] = useState('');
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [jsonDraftErrors, setJsonDraftErrors] = useState<Record<string, string>>({});

  const updateInputPropAtPath = (path: PropPath, rawValue: string) => {
    const draftKey = formatPathKey(path);
    const currentValue = getValueAtPath(inputProps, path);
    let nextValue: unknown;

    if (isJsonLikeValue(currentValue)) {
      setJsonDrafts((current) => ({ ...current, [draftKey]: rawValue }));

      const parsedJson = parseJsonDraft(rawValue);
      if (!parsedJson.success) {
        setJsonDraftErrors((current) => ({ ...current, [draftKey]: parsedJson.message }));
        return;
      }
      nextValue = parsedJson.value;
    } else {
      nextValue = coerceControlValue(currentValue, rawValue);
    }

    const nextCandidate = setValueAtPath(inputProps, path, nextValue);
    const parsed = propsSchema.safeParse(nextCandidate);
    if (!parsed.success) {
      setJsonDraftErrors((current) => ({
        ...current,
        [draftKey]: `${t('invalidProps')}: ${formatPropsParseError(parsed.error)}`,
      }));
      return;
    }

    setJsonDraftErrors((current) => {
      if (!(draftKey in current)) {
        return current;
      }
      const next = { ...current };
      delete next[draftKey];
      return next;
    });
    setInputProps(parsed.data);
  };

  const exportPreviewCase = () => {
    const previewCase = buildPreviewCase({ name: previewCaseName, inputProps, previewSize });
    const fileName = downloadPreviewCase(previewCase);
    setExportStatus(isZh
      ? `已导出 ${fileName}。请保存到 .promptframe/local-previews/。`
      : `Exported ${fileName}. Save it under .promptframe/local-previews/.`);
  };

  const applyGeneratedPreviewCase = (previewCase: PromptFramePreviewCase<ComponentProps>) => {
    setInputProps(previewCase.props);
    setJsonDrafts({});
    setJsonDraftErrors({});
    setPreviewSize({
      label: previewCase.name,
      width: previewCase.width,
      height: previewCase.height,
    });
    setPreviewCaseName(previewCase.id);
    setExportStatus(isZh
      ? `已载入 ${previewCase.name}。如有需要可继续调整属性，然后导出为本地预览案例。`
      : `Loaded ${previewCase.name}. Adjust props if needed, then export it as a local preview case.`);
  };

  const renderDraftError = (draftKey: string): ReactNode => {
    const jsonDraftError = jsonDraftErrors[draftKey];
    return jsonDraftError ? (
      <span
        data-promptframe-json-draft-error={draftKey}
        role="alert"
        style={{ color: '#b91c1c', fontSize: 12, lineHeight: 1.45 }}
      >
        {jsonDraftError}
      </span>
    ) : null;
  };

  const renderJsonFallback = (path: PropPath, value: unknown): ReactNode => {
    const draftKey = formatPathKey(path);
    return (
      <details style={{ display: 'grid', gap: 8 }}>
        <summary style={{ color: '#475569', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
          {t('advancedJson')}
        </summary>
        <textarea
          data-promptframe-prop-json={draftKey}
          value={jsonDrafts[draftKey] ?? formatJsonValue(value)}
          onChange={(event) => updateInputPropAtPath(path, event.currentTarget.value)}
          rows={5}
          spellCheck={false}
          style={{
            width: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
            border: jsonDraftErrors[draftKey] ? '1px solid #dc2626' : '1px solid #cbd5e1',
            borderRadius: 6,
            padding: '8px 10px',
            font: 'inherit',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            resize: 'vertical',
          }}
        />
        {renderDraftError(draftKey)}
      </details>
    );
  };

  const renderPrimitiveControl = (path: PropPath, value: unknown): ReactNode => {
    const draftKey = formatPathKey(path);
    if (typeof value === 'boolean') {
      return (
        <select
          data-promptframe-prop-field={draftKey}
          value={formatPrimitiveControlValue(value)}
          onChange={(event) => updateInputPropAtPath(path, event.currentTarget.value)}
          style={{
            width: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
            border: jsonDraftErrors[draftKey] ? '1px solid #dc2626' : '1px solid #cbd5e1',
            borderRadius: 6,
            padding: '8px 10px',
            font: 'inherit',
          }}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }

    return (
      <input
        data-promptframe-prop-field={draftKey}
        type={isColorValue(value) ? 'color' : typeof value === 'number' ? 'number' : 'text'}
        value={formatPrimitiveControlValue(value)}
        onChange={(event) => updateInputPropAtPath(path, event.currentTarget.value)}
        style={{
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          border: jsonDraftErrors[draftKey] ? '1px solid #dc2626' : '1px solid #cbd5e1',
          borderRadius: 6,
          padding: isColorValue(value) ? 4 : '8px 10px',
          font: 'inherit',
        }}
      />
    );
  };

  const renderPropControl = (path: PropPath, label: string, value: unknown, depth = 0): ReactNode => {
    const draftKey = formatPathKey(path);

    if (Array.isArray(value)) {
      return (
        <div
          key={draftKey}
          data-promptframe-prop-structured={draftKey}
          style={{
            display: 'grid',
            gap: 8,
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: 10,
            background: depth === 0 ? '#fff' : '#f8fafc',
          }}
        >
          <span style={{ color: '#334155', fontSize: 13, fontWeight: 700 }}>{label}</span>
          {value.length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {value.map((item, index) => (
                <div
                  data-promptframe-prop-array-item={`${draftKey}.${index}`}
                  key={`${draftKey}.${index}`}
                  style={{ display: 'grid', gap: 8, borderLeft: '2px solid #cbd5e1', paddingLeft: 10 }}
                >
                  {renderPropControl([...path, index], `${t('item')} ${index + 1}`, item, depth + 1)}
                </div>
              ))}
            </div>
          ) : (
            <span style={{ color: '#64748b', fontSize: 12 }}>{t('noItems')}</span>
          )}
          {renderJsonFallback(path, value)}
        </div>
      );
    }

    if (isRecordValue(value)) {
      return (
        <div
          key={draftKey}
          data-promptframe-prop-structured={draftKey}
          style={{
            display: 'grid',
            gap: 8,
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: 10,
            background: depth === 0 ? '#fff' : '#f8fafc',
          }}
        >
          <span style={{ color: '#334155', fontSize: 13, fontWeight: 700 }}>{label}</span>
          {Object.entries(value).map(([childKey, childValue]) => (
            <div key={`${draftKey}.${childKey}`} style={{ display: 'grid', gap: 6, paddingLeft: depth > 0 ? 8 : 0 }}>
              {renderPropControl([...path, childKey], formatPropLabel(childKey), childValue, depth + 1)}
            </div>
          ))}
          {renderJsonFallback(path, value)}
        </div>
      );
    }

    if (value === null) {
      return (
        <div key={draftKey} data-promptframe-prop-structured={draftKey} style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: '#334155', fontSize: 13, fontWeight: 700 }}>{label}</span>
          {renderJsonFallback(path, value)}
        </div>
      );
    }

    return (
      <label key={draftKey} style={{ display: 'grid', gap: 6, fontSize: 13 }}>
        <span style={{ color: '#334155', fontWeight: 700 }}>{label}</span>
        {renderPrimitiveControl(path, value)}
        {renderDraftError(draftKey)}
      </label>
    );
  };

  return (
    <main
      style={{
        height: '100vh',
        margin: 0,
        background: '#111827',
        color: '#f8fafc',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)',
        gap: 24,
        padding: 24,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <section
        data-promptframe-preview-stage
        style={{
          minWidth: 0,
          minHeight: 0,
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        <div
          data-promptframe-preview-player
          style={{
            width: `min(100%, 1280px, calc((100vh - 48px) * ${previewSize.width / previewSize.height}))`,
            maxHeight: '100%',
            aspectRatio: `${previewSize.width} / ${previewSize.height}`,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Player
            component={Component}
            inputProps={inputProps}
            durationInFrames={preview.durationFrames}
            compositionWidth={previewSize.width}
            compositionHeight={previewSize.height}
            fps={preview.fps}
            controls
            loop
            acknowledgeRemotionLicense
            style={{
              width: '100%',
              maxHeight: '100%',
              aspectRatio: `${previewSize.width} / ${previewSize.height}`,
              background: '#000',
              boxShadow: '0 18px 60px rgba(0, 0, 0, 0.38)',
            }}
          />
        </div>
      </section>

      <aside
        aria-label={t('previewControlsAria')}
        style={{
          alignSelf: 'stretch',
          background: '#f8fafc',
          color: '#111827',
          borderRadius: 8,
          padding: 18,
          boxSizing: 'border-box',
          maxHeight: '100%',
          overflowY: 'auto',
        }}
      >
        <section>
          <h2 style={{ fontSize: 16, margin: '0 0 12px', letterSpacing: 0 }}>{t('preview')}</h2>
          <div
            aria-label={t('aspect')}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}
          >
            {previewAspectPresets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setPreviewSize(preset)}
                style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  background: previewSize.label === preset.label ? '#111827' : '#fff',
                  color: previewSize.label === preset.label ? '#fff' : '#111827',
                  font: 'inherit',
                  padding: '8px 10px',
                  cursor: 'pointer',
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div
            style={{
              marginTop: 16,
              borderTop: '1px solid #e2e8f0',
              paddingTop: 16,
              display: 'grid',
              gap: 10,
            }}
          >
            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              <span style={{ color: '#334155', fontWeight: 700 }}>{t('previewCaseName')}</span>
              <input
                data-promptframe-preview-case-name
                type="text"
                value={previewCaseName}
                onChange={(event) => setPreviewCaseName(event.currentTarget.value)}
                style={{
                  width: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  padding: '8px 10px',
                  font: 'inherit',
                }}
              />
            </label>
            <button
              data-promptframe-preview-case-export
              type="button"
              onClick={exportPreviewCase}
              style={{
                border: '1px solid #111827',
                borderRadius: 6,
                background: '#111827',
                color: '#fff',
                font: 'inherit',
                fontWeight: 700,
                padding: '9px 12px',
                cursor: 'pointer',
              }}
            >
              {t('exportCase')}
            </button>
            {exportStatus ? (
              <p aria-live="polite" style={{ margin: 0, color: '#475569', fontSize: 12 }}>
                {exportStatus}
              </p>
            ) : null}
            <div style={{ display: 'grid', gap: 8 }}>
              <strong style={{ color: '#334155', fontSize: 13 }}>{t('autoCases')}</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {generatedPreviewCases.map((previewCase) => (
                  <button
                    data-promptframe-preview-case-apply={previewCase.id}
                    key={previewCase.id}
                    type="button"
                    title={previewCase.description}
                    onClick={() => applyGeneratedPreviewCase(previewCase)}
                    style={{
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      background: '#fff',
                      color: '#111827',
                      font: 'inherit',
                      fontSize: 12,
                      padding: '8px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    {previewCase.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 12px', letterSpacing: 0 }}>{t('props')}</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {Object.entries(inputProps).map(([key, value]) => renderPropControl([key], formatPropLabel(key), value))}
          </div>
        </section>
      </aside>
    </main>
  );
}

createRoot(root).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
