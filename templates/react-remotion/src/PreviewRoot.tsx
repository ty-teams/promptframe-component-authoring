import { Player } from '@remotion/player';
import { createPreviewCaseMatrix, type PromptFramePreviewCase } from '@promptframe/component-kit/preview';
import { StrictMode, useState } from 'react';
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
  : { label: 'Custom', width: preview.width, height: preview.height };
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

  const updateInputProp = (key: string, rawValue: string) => {
    const currentValue = inputProps[key as keyof ComponentProps];
    if (isJsonLikeValue(currentValue)) {
      setJsonDrafts((current) => ({ ...current, [key]: rawValue }));
    }
    setInputProps((current) => {
      const currentValue = current[key as keyof ComponentProps];
      const nextCandidate = {
        ...current,
        [key]: coerceControlValue(currentValue, rawValue),
      };
      const parsed = propsSchema.safeParse(nextCandidate);
      return parsed.success ? parsed.data : current;
    });
  };

  const exportPreviewCase = () => {
    const previewCase = buildPreviewCase({ name: previewCaseName, inputProps, previewSize });
    const fileName = downloadPreviewCase(previewCase);
    setExportStatus(`Exported ${fileName}. Save it under .promptframe/local-previews/.`);
  };

  const applyGeneratedPreviewCase = (previewCase: PromptFramePreviewCase<ComponentProps>) => {
    setInputProps(previewCase.props);
    setJsonDrafts({});
    setPreviewSize({
      label: previewCase.name,
      width: previewCase.width,
      height: previewCase.height,
    });
    setPreviewCaseName(previewCase.id);
    setExportStatus(`Loaded ${previewCase.name}. Adjust props if needed, then export it as a local preview case.`);
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
        aria-label="PromptFrame preview controls"
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
          <h2 style={{ fontSize: 16, margin: '0 0 12px', letterSpacing: 0 }}>Preview</h2>
          <div
            aria-label="Aspect ratio"
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
              <span style={{ color: '#334155', fontWeight: 700 }}>Preview case name</span>
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
              Export case
            </button>
            {exportStatus ? (
              <p aria-live="polite" style={{ margin: 0, color: '#475569', fontSize: 12 }}>
                {exportStatus}
              </p>
            ) : null}
            <div style={{ display: 'grid', gap: 8 }}>
              <strong style={{ color: '#334155', fontSize: 13 }}>Auto cases</strong>
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
          <h2 style={{ fontSize: 16, margin: '0 0 12px', letterSpacing: 0 }}>Props</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {Object.entries(inputProps).map(([key, value]) => (
              <label key={key} style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                <span style={{ color: '#334155', fontWeight: 700 }}>{key}</span>
                {isJsonLikeValue(value) ? (
                  <textarea
                    data-promptframe-prop-json={key}
                    value={jsonDrafts[key] ?? formatJsonValue(value)}
                    onChange={(event) => updateInputProp(key, event.currentTarget.value)}
                    rows={5}
                    spellCheck={false}
                    style={{
                      width: '100%',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      padding: '8px 10px',
                      font: 'inherit',
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                      resize: 'vertical',
                    }}
                  />
                ) : typeof value === 'boolean' ? (
                  <select
                    value={formatPrimitiveControlValue(value)}
                    onChange={(event) => updateInputProp(key, event.currentTarget.value)}
                    style={{
                      width: '100%',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      padding: '8px 10px',
                      font: 'inherit',
                    }}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    type={isColorValue(value) ? 'color' : typeof value === 'number' ? 'number' : 'text'}
                    value={formatPrimitiveControlValue(value)}
                    onChange={(event) => updateInputProp(key, event.currentTarget.value)}
                    style={{
                      width: '100%',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      padding: isColorValue(value) ? 4 : '8px 10px',
                      font: 'inherit',
                    }}
                  />
                )}
              </label>
            ))}
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
