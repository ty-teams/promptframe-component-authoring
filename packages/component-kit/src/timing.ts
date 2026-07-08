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

export interface RevealPhases {
  enterRange: [number, number];
  revealRange: [number, number];
  exitRange: [number, number];
  holdFrames: number;
  progressAt(frame: number): number;
}

export interface CreateRevealPhasesParams {
  fps: number;
  timeline: DurationTimeline;
  enterSeconds: number;
  revealSeconds: number;
  exitSeconds: number;
}

export function createRevealPhases(params: CreateRevealPhasesParams): RevealPhases {
  const fps = positiveInteger(params.fps, 'fps');
  const enterEnd = params.timeline.at(secondsToFrames(params.enterSeconds, fps));
  const revealEnd = params.timeline.at(secondsToFrames(params.revealSeconds, fps));
  const exitStart = params.timeline.at(secondsToFrames(params.exitSeconds, fps));
  if (revealEnd <= enterEnd) throw new Error('revealSeconds must be greater than enterSeconds');
  if (exitStart < revealEnd) throw new Error('exitSeconds must be greater than or equal to revealSeconds');

  return {
    enterRange: [0, enterEnd],
    revealRange: [enterEnd, revealEnd],
    exitRange: [exitStart, params.timeline.actualDuration],
    holdFrames: params.timeline.holdFrames,
    progressAt(frame: number): number {
      return clamp01(frame / revealEnd);
    },
  };
}

export interface FillProgress {
  startFrame: number;
  endFrame: number;
  at(frame: number): number;
}

export interface CreateFillProgressParams {
  durationFrames: number;
  startPercent: number;
  endPercent: number;
}

export function createFillProgress(params: CreateFillProgressParams): FillProgress {
  const durationFrames = positiveInteger(params.durationFrames, 'durationFrames');
  const startPercent = boundedPercent(params.startPercent, 'startPercent');
  const endPercent = boundedPercent(params.endPercent, 'endPercent');
  if (endPercent <= startPercent) throw new Error('endPercent must be greater than startPercent');
  const startFrame = Math.round(durationFrames * startPercent);
  const endFrame = Math.round(durationFrames * endPercent);
  return {
    startFrame,
    endFrame,
    at(frame: number): number {
      return clamp01((frame - startFrame) / (endFrame - startFrame));
    },
  };
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function boundedPercent(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
