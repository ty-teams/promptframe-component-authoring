export const COMPONENT_PREVIEW_MAX_SECONDS = 30;

/** Manifest ranges are frames, never seconds. This selects preview timing only;
 * it does not change the duration of a component in a production document. */
export function selectComponentPreviewDurationFrames(input: {
  fps: number;
  durationFrames: number;
  designedDurationRange?: { min: number; max: number };
}): number {
  if (!Number.isSafeInteger(input.fps) || input.fps < 1 || input.fps > 60
    || !Number.isSafeInteger(input.durationFrames) || input.durationFrames < 1) {
    throw new Error('component.preview.timing_invalid');
  }
  const range = input.designedDurationRange;
  if (range && (!Number.isSafeInteger(range.min) || !Number.isSafeInteger(range.max)
    || range.min < 1 || range.max < range.min)) throw new Error('component.preview.designed_range_invalid');
  return Math.min(range?.max ?? input.durationFrames, COMPONENT_PREVIEW_MAX_SECONDS * input.fps);
}
