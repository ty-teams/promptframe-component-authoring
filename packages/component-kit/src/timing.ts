export interface DurationTimeline {
  actualDuration: number;
  designedDuration: number;
  actionDuration: number;
  scale: number;
  holdFrames: number;
  at(frame: number): number;
  frame(value: number): number;
  range(start: number, end: number): [number, number];
  stagger(baseDelay: number, index: number, baseStagger: number): number;
  scaledFps(actualFps: number): number;
}

export interface CreateDurationTimelineParams {
  actualDuration: number;
  designedDuration: number;
  minScale?: number;
}

export function createDurationTimeline(params: CreateDurationTimelineParams): DurationTimeline {
  const actualDuration = positiveInteger(params.actualDuration, 'actualDuration');
  const designedDuration = positiveInteger(params.designedDuration, 'designedDuration');
  const minScale = params.minScale ?? 0.3;
  if (minScale <= 0 || minScale > 1) throw new Error('minScale must be > 0 and <= 1');

  const rawScale = Math.min(actualDuration, designedDuration) / designedDuration;
  const scale = Math.max(minScale, rawScale);
  const actionDuration = Math.round(designedDuration * scale);
  const holdFrames = Math.max(0, actualDuration - actionDuration);
  const at = (frame: number) => Math.round(frame * scale);
  const range = (start: number, end: number): [number, number] => [at(start), at(end)];
  const stagger = (baseDelay: number, index: number, baseStagger: number) => at(baseDelay + index * baseStagger);
  const scaledFps = (actualFps: number) => scale < 1 ? actualFps / scale : actualFps;

  return {
    actualDuration,
    designedDuration,
    actionDuration,
    scale,
    holdFrames,
    at,
    frame: at,
    range,
    stagger,
    scaledFps,
  };
}

export interface ScaledSpringTiming {
  frame: number;
  fps: number;
}

export function getScaledSpringTiming(
  frame: number,
  fps: number,
  delay: number,
  timeline: DurationTimeline,
): ScaledSpringTiming {
  return {
    frame: Math.max(0, frame - timeline.at(delay)),
    fps: timeline.scaledFps(fps),
  };
}

export function secondsToFrames(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error('seconds must be a non-negative finite number');
  }
  const normalizedFps = positiveInteger(fps, 'fps');
  return Math.round(seconds * normalizedFps);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}
