import { Player } from '@remotion/player';
import {
  createPreviewCaseMatrix,
  formatPromptFramePreviewPropLabel,
  type PromptFramePreviewCase,
  type PromptFramePreviewFps,
} from '@promptframe/component-kit/preview';
import {
  buildPromptFramePreviewControlsFromSchema,
  PromptFramePreviewInspector,
} from '@promptframe/component-kit/preview-react';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Component from './Component';
import previewEnvelope from './preview-props.json';
import { promptFrameDevPublicResources, type PromptFrameDevPublicResource } from './promptframe-dev-public-resources.generated';
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

type PreviewTiming = {
  label: string;
  fps: PromptFramePreviewFps;
  durationFrames: number;
};

type PreviewCase = {
  name: string;
  width: number;
  height: number;
  fps: PromptFramePreviewFps;
  durationFrames: number;
  props: ComponentProps;
  generatedAt: string;
};

type PreviewLocale = 'en' | 'zh';

type PreviewMessageKey =
  | 'advancedJson'
  | 'aspect'
  | 'autoCases'
  | 'baselineReset'
  | 'custom'
  | 'diagnostics'
  | 'exportCase'
  | 'fps'
  | 'invalidJson'
  | 'invalidProps'
  | 'item'
  | 'jsonParseFallback'
  | 'localDiagnosticOnly'
  | 'noItems'
  | 'platformProbeEquivalent'
  | 'preview'
  | 'previewCaseName'
  | 'previewControlsAria'
  | 'props'
  | 'propsStress'
  | 'publicResources'
  | 'schemaValidationFailed';

const previewMessages: Record<PreviewLocale, Record<PreviewMessageKey, string>> = {
  en: {
    advancedJson: 'Advanced JSON',
    aspect: 'Aspect',
    autoCases: 'Auto cases',
    baselineReset: 'Baseline reset',
    custom: 'Custom',
    diagnostics: 'Diagnostics',
    exportCase: 'Export case',
    fps: 'FPS',
    invalidJson: 'Invalid JSON',
    invalidProps: 'Invalid props',
    item: 'Item',
    jsonParseFallback: 'Unable to parse JSON.',
    localDiagnosticOnly: 'Local diagnostic only',
    noItems: 'No items',
    platformProbeEquivalent: 'Platform probe equivalent',
    preview: 'Preview',
    previewCaseName: 'Preview case name',
    previewControlsAria: 'PromptFrame preview controls',
    props: 'Props',
    propsStress: 'Props stress',
    publicResources: 'Public resources',
    schemaValidationFailed: 'Schema validation failed.',
  },
  zh: {
    advancedJson: '高级 JSON',
    aspect: '画幅',
    autoCases: '自动案例',
    baselineReset: '基线重置',
    custom: '自定义',
    diagnostics: '诊断',
    exportCase: '导出案例',
    fps: '帧率',
    invalidJson: 'JSON 无效',
    invalidProps: '参数无效',
    item: '项目',
    jsonParseFallback: '无法解析 JSON。',
    localDiagnosticOnly: '仅本地诊断',
    noItems: '暂无项目',
    platformProbeEquivalent: '平台 Probe 等价',
    preview: '预览',
    previewCaseName: '预览案例名称',
    previewControlsAria: 'PromptFrame 预览控制台',
    props: '属性',
    propsStress: '属性压力',
    publicResources: '公共资源',
    schemaValidationFailed: 'Schema 校验失败。',
  },
};

function resolvePreviewLocale(): PreviewLocale {
  return 'en';
}

const previewLocale = resolvePreviewLocale();
const isZh = previewLocale === 'zh';

function t(key: PreviewMessageKey): string {
  return previewMessages[previewLocale][key];
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
const initialTiming: PreviewTiming = {
  label: `${preview.fps}fps`,
  fps: preview.fps,
  durationFrames: preview.durationFrames,
};
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
  aspectPresets: [],
  fpsPresets: [],
  durationScalePresets: [0.5, 2],
});
const baselinePreviewCase = generatedPreviewCases.find((previewCase) => previewCase.caseKind === 'baseline_reset');
const diagnosticPreviewCases = generatedPreviewCases.filter((previewCase) => (
  previewCase.caseKind === 'props_stress'
  || previewCase.caseKind === 'duration_diagnostic'
));

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing preview root element');
}

function formatPropsParseError(error: { issues?: Array<{ path?: Array<string | number>; message?: string }> }): string {
  const firstIssue = error.issues?.[0];
  const path = firstIssue?.path?.length ? `${firstIssue.path.join('.')}: ` : '';
  return `${path}${firstIssue?.message ?? t('schemaValidationFailed')}`;
}

const previewInspectorControls = buildPromptFramePreviewControlsFromSchema({
  propsSchema,
  defaultProps: initialProps,
  labelFormatter: formatPromptFramePreviewPropLabel,
});

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
  previewTiming,
}: {
  name: string;
  inputProps: ComponentProps;
  previewSize: PreviewSize;
  previewTiming: PreviewTiming;
}): PreviewCase {
  return {
    name: normalizePreviewCaseName(name),
    width: previewSize.width,
    height: previewSize.height,
    fps: previewTiming.fps,
    durationFrames: previewTiming.durationFrames,
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

function previewCaseCoverageLabel(previewCase: PromptFramePreviewCase<ComponentProps>): string {
  return previewCase.probeCoverage === 'platform_probe_equivalent'
    ? t('platformProbeEquivalent')
    : t('localDiagnosticOnly');
}

function resourceLabel(resource: PromptFrameDevPublicResource): string {
  return resource.publicPath.split('/').filter(Boolean).pop() ?? resource.publicPath;
}

function renderLocalResourcePicker({
  control,
  readOnly,
  onSelect,
}: {
  control: { key: string; type: string };
  readOnly: boolean;
  onSelect: (value: unknown) => void;
}) {
  if (control.type !== 'text' || promptFrameDevPublicResources.length === 0) return null;
  return (
    <div
      data-promptframe-preview-resource-picker={control.key}
      style={{ display: 'grid', gap: 6, marginTop: 8 }}
    >
      <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>{t('publicResources')}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {promptFrameDevPublicResources.map((resource) => (
          <button
            data-promptframe-preview-resource-select={resource.publicPath}
            key={resource.publicPath}
            type="button"
            disabled={readOnly}
            title={`${resource.publicPath} / ${resource.contentType}`}
            onClick={() => onSelect(resource.publicPath)}
            style={{
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              background: '#fff',
              color: '#111827',
              cursor: readOnly ? 'not-allowed' : 'pointer',
              font: 'inherit',
              fontSize: 12,
              padding: '5px 8px',
            }}
          >
            {resourceLabel(resource)}
          </button>
        ))}
      </div>
    </div>
  );
}

function PreviewApp() {
  const [inputProps, setInputProps] = useState<ComponentProps>(initialProps);
  const [previewSize, setPreviewSize] = useState(initialSize);
  const [previewTiming, setPreviewTiming] = useState<PreviewTiming>(initialTiming);
  const [previewCaseName, setPreviewCaseName] = useState(defaultPreviewCaseName);
  const [exportStatus, setExportStatus] = useState('');

  const updateInputProps = (nextCandidate: Record<string, unknown>) => {
    const parsed = propsSchema.safeParse(nextCandidate);
    if (!parsed.success) {
      setExportStatus(`${t('invalidProps')}: ${formatPropsParseError(parsed.error)}`);
      return;
    }

    setExportStatus('');
    setInputProps(parsed.data);
  };

  const exportPreviewCase = () => {
    const previewCase = buildPreviewCase({ name: previewCaseName, inputProps, previewSize, previewTiming });
    const fileName = downloadPreviewCase(previewCase);
    setExportStatus(isZh
      ? `已导出 ${fileName}。请保存到 .promptframe/local-previews/。`
      : `Exported ${fileName}. Save it under .promptframe/local-previews/.`);
  };

  const applyGeneratedPreviewCase = (previewCase: PromptFramePreviewCase<ComponentProps>) => {
    if (previewCase.caseKind === 'baseline_reset') {
      setInputProps(previewCase.props);
    }
    if (previewCase.caseKind === 'props_stress') {
      setInputProps(previewCase.props);
    }
    if (previewCase.caseKind === 'duration_diagnostic') {
      setPreviewTiming({
        label: previewCase.name,
        fps: previewCase.fps,
        durationFrames: previewCase.durationFrames,
      });
      setInputProps(previewCase.props);
    }

    setPreviewCaseName(previewCase.id);
    setExportStatus(isZh
      ? `已载入 ${previewCase.name}。如有需要可继续调整属性，然后导出为本地预览案例。`
      : `Loaded ${previewCase.name}. Adjust props if needed, then export it as a local preview case.`);
  };

  const fillPlayerByWidth = previewSize.width >= previewSize.height;

  return (
    <main
      style={{
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
      }}
    >
      <section
        data-promptframe-preview-stage
        style={{
          minWidth: 0,
          minHeight: 0,
          width: '100%',
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        <div
          data-promptframe-preview-player
          style={{
            width: fillPlayerByWidth ? '100%' : 'auto',
            height: fillPlayerByWidth ? 'auto' : '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: `${previewSize.width} / ${previewSize.height}`,
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
            background: '#000',
            boxShadow: '0 18px 60px rgba(0, 0, 0, 0.38)',
          }}
        >
          <Player
            component={Component}
            inputProps={inputProps}
            durationInFrames={previewTiming.durationFrames}
            compositionWidth={previewSize.width}
            compositionHeight={previewSize.height}
            fps={previewTiming.fps}
            controls
            loop
            acknowledgeRemotionLicense
            style={{
              width: '100%',
              height: '100%',
              background: '#000',
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
          boxSizing: 'border-box',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          data-promptframe-preview-controls-scroll
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: 18,
            boxSizing: 'border-box',
            overscrollBehavior: 'contain',
          }}
        >
        <section
          data-promptframe-preview-aspect-toolbar
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            background: '#f8fafc',
            paddingBottom: 12,
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <h2 style={{ fontSize: 16, margin: '0 0 12px', letterSpacing: 0 }}>{t('preview')}</h2>
          <div
            aria-label={t('aspect')}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}
          >
            {previewAspectPresets.map((preset) => (
              <button
                key={preset.label}
                data-promptframe-preview-aspect-case={preset.label}
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
          <p style={{ color: '#64748b', fontSize: 12, margin: '8px 0 0' }}>
            {t('fps')}: {previewTiming.label} / {previewTiming.durationFrames} frames
          </p>
        </section>

        <section>
          <div
            style={{
              marginTop: 16,
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
              {baselinePreviewCase ? (
                <button
                  data-promptframe-preview-baseline-reset
                  data-promptframe-preview-case-apply={baselinePreviewCase.id}
                  data-promptframe-preview-case-kind={baselinePreviewCase.caseKind}
                  type="button"
                  title={baselinePreviewCase.description}
                  onClick={() => applyGeneratedPreviewCase(baselinePreviewCase)}
                  style={{
                    border: '1px solid #111827',
                    borderRadius: 6,
                    background: '#111827',
                    color: '#fff',
                    font: 'inherit',
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '8px 10px',
                    cursor: 'pointer',
                  }}
                >
                  {t('baselineReset')}
                </button>
              ) : null}
              <span style={{ color: '#64748b', fontSize: 12 }}>{t('propsStress')} / {t('diagnostics')}</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {diagnosticPreviewCases.map((previewCase) => (
                  <button
                    data-promptframe-preview-case-apply={previewCase.id}
                    data-promptframe-preview-case-kind={previewCase.caseKind}
                    key={previewCase.id}
                    type="button"
                    title={`${previewCase.description} ${previewCaseCoverageLabel(previewCase)}`}
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
                    <span style={{ display: 'block', fontWeight: 700 }}>{previewCase.name}</span>
                    <span style={{ display: 'block', color: '#64748b', fontSize: 11 }}>
                      {previewCaseCoverageLabel(previewCase)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 12px', letterSpacing: 0 }}>{t('props')}</h2>
          <PromptFramePreviewInspector
            controls={previewInspectorControls}
            initialPreviewProps={initialProps as Record<string, unknown>}
            previewProps={inputProps as Record<string, unknown>}
            editable
            locale={previewLocale}
            onPreviewPropsChange={updateInputProps}
            renderResourcePicker={renderLocalResourcePicker}
            renderToolbarActions={() => <></>}
            scrollMode="parent"
          />
        </section>
        </div>
      </aside>
    </main>
  );
}

createRoot(root).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
