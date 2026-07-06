import { promptFramePublicResource, type PromptFrameRuntimeResourceProps } from '@promptframe/component-kit';
import { createPromptFrameLayout } from '@promptframe/component-kit/layout';
import type { CSSProperties } from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import styles from './Component.module.css';
import type { ComponentProps } from './schema';

export default function Component(props: ComponentProps & PromptFrameRuntimeResourceProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const sampleResourceUrl = promptFramePublicResource(props, '/sample-data.json');
  const layout = createPromptFrameLayout({
    slotWidth: width,
    slotHeight: height,
    baseWidth: 1280,
    baseHeight: 720,
    minScale: 0.45,
    maxScale: 1.15,
  });
  const progress = interpolate(frame, [0, Math.max(1, fps * 2)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const rootStyle = {
    background: props.background,
    color: props.foreground,
    '--pf-padding': `${layout.px(72)}px`,
    '--pf-kicker-size': `${layout.px(24)}px`,
    '--pf-title-size': `${layout.px(68)}px`,
    '--pf-title-offset': `${layout.px(12)}px`,
  } as CSSProperties;

  return (
    <AbsoluteFill
      className={styles.root}
      style={rootStyle}
    >
      <div className={styles.copy} style={{ opacity: progress, transform: `translateY(${layout.px((1 - progress) * 24)}px)` }}>
        <p className={styles.kicker}>{props.kicker}</p>
        <h1 className={styles.title}>{props.title}</h1>
      </div>
      <div aria-hidden="true" className={styles.hiddenResource} data-promptframe-public-resource={sampleResourceUrl} />
    </AbsoluteFill>
  );
}
