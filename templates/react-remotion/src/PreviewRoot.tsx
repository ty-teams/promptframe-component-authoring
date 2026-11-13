import { Player } from '@remotion/player';
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

const preview = previewEnvelope as {
  durationFrames: number;
  fps: 30;
  width: number;
  height: number;
  props?: unknown;
};

async function mountPreview() {
const localPreview = await promptFrameLocalPreview;
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
          component={Component}
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
