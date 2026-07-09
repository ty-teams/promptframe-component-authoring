import { Player } from '@remotion/player';
import {
  PromptFramePreviewApp,
  resolvePromptFramePreviewLocale,
} from '@promptframe/component-kit/preview-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Component from './Component';
import previewEnvelope from './preview-props.json';
import { promptFrameDevPublicResources } from './promptframe-dev-public-resources.generated';
import { propsSchema, type ComponentProps } from './schema';

const preview = previewEnvelope as {
  durationFrames: number;
  fps: 30;
  width: number;
  height: number;
  props?: unknown;
};

const initialPropsParse = propsSchema.safeParse(preview.props ?? {});
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
    <PromptFramePreviewApp<ComponentProps>
      previewEnvelope={preview}
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
