import { Player } from '@remotion/player';
import React from 'react';
import { createPromptFrameModelReader, PROMPTFRAME_MODEL_READER, readPromptFrameModelResponse, type PromptFrameModelRepresentation } from '@promptframe/contracts';
import {
  PromptFramePreviewApp,
  resolvePromptFramePreviewLocale,
} from '@promptframe/component-kit/preview-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Component from './Component';
import previewEnvelope from './preview-props.json';
import manifest from '../manifest.json';
import { promptFrameDevPublicResources } from './promptframe-dev-public-resources.generated';
import { propsSchema, type ComponentProps } from './schema';
import { promptFrameLocalPreview } from 'virtual:promptframe-local-preview';

const hostFetch = globalThis.fetch.bind(globalThis);
const runtimeEntries = promptFrameDevPublicResources.map(entry => ({ ...entry, url: entry.publicPath }));
let localModelResources: readonly PromptFrameModelRepresentation[] = [];
const modelReader = createPromptFrameModelReader({
  entries: () => [...runtimeEntries.filter(entry => entry.kind === 'model').map(entry => ({ ...entry, reference: entry.publicPath })), ...localModelResources],
  read: async (entry, signal) => readPromptFrameModelResponse(await hostFetch(entry.url, { signal, redirect: 'error' }), entry.sizeBytes, signal),
  digest: async bytes => 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), byte => byte.toString(16).padStart(2, '0')).join(''),
});
const hostResources = { contractVersion: 'component-public-resources.v0.1.0' as const, entries: runtimeEntries, [PROMPTFRAME_MODEL_READER]: modelReader.read };
const ModelBoundComponent = (props: ComponentProps) => {
  const runtimeProps = { ...props, promptFrameResources: hostResources };
  return React.createElement(Component, runtimeProps);
};
if (import.meta.hot) import.meta.hot.dispose(() => modelReader.dispose());
window.addEventListener('pagehide', () => modelReader.dispose(), { once: true });

const preview = previewEnvelope as {
  durationFrames: number;
  fps: 30;
  width: number;
  height: number;
  props?: unknown;
};

async function mountPreview() {
const localPreview = await promptFrameLocalPreview;
localModelResources = localPreview.models ?? [];
const initialPropsParse = propsSchema.safeParse(localPreview.props ?? preview.props ?? {});
const initialProps: ComponentProps = initialPropsParse.success
  ? initialPropsParse.data
  : propsSchema.parse({});

const previewLocale = resolvePromptFramePreviewLocale({
  search: typeof window !== 'undefined' ? window.location.search : undefined,
});

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing preview root element');
}

createRoot(root).render(
  <StrictMode>
    {localPreview.issues.length > 0 && <p role="alert" style={{ padding: 12 }}>
      本地预览素材不可用，当前显示包内示例。请核对所选文件、作品与 CLI 素材读取授权后刷新。
    </p>}
    <PromptFramePreviewApp<ComponentProps>
      previewEnvelope={{ ...preview, props: propsSchema.parse(preview.props ?? {}) }}
      designedDurationRange={manifest.designedDurationRange}
      initialProps={initialProps}
      propsSchema={propsSchema}
      publicResources={promptFrameDevPublicResources}
      locale={previewLocale}
      validateProps={(candidate) => {
        const parsed = propsSchema.safeParse(candidate);
        return parsed.success ? parsed.data : undefined;
      }}
      renderStage={({ props, width, height, fps, durationFrames }) => (
        <Player
          component={ModelBoundComponent}
          inputProps={props}
          durationInFrames={durationFrames}
          compositionWidth={width}
          compositionHeight={height}
          fps={fps}
          controls
          loop
          acknowledgeRemotionLicense
          style={{
            width: '100%',
            height: '100%',
            background: '#000',
          }}
        />
      )}
    />
  </StrictMode>,
);

}
void mountPreview();
