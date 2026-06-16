import { promptFramePublicResource, type PromptFrameRuntimeResourceProps } from '@promptframe/component-kit';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ComponentProps } from './schema';

export default function Component(props: ComponentProps & PromptFrameRuntimeResourceProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sampleResourceUrl = promptFramePublicResource(props, '/sample-data.json');
  const progress = interpolate(frame, [0, Math.max(1, fps * 2)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: props.background,
        color: props.foreground,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        justifyContent: 'center',
        padding: 72,
      }}
    >
      <div style={{ opacity: progress, transform: `translateY(${(1 - progress) * 24}px)` }}>
        <p style={{ margin: 0, fontSize: 24, letterSpacing: 0, opacity: 0.72 }}>
          {props.kicker}
        </p>
        <h1 style={{ margin: '12px 0 0', fontSize: 68, lineHeight: 1.02, letterSpacing: 0 }}>
          {props.title}
        </h1>
      </div>
      <div aria-hidden="true" data-promptframe-public-resource={sampleResourceUrl} style={{ display: 'none' }} />
    </AbsoluteFill>
  );
}
