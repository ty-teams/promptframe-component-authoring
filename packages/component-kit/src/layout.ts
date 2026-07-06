export interface PromptFrameLayoutOptions {
  slotWidth: number;
  slotHeight: number;
  baseWidth: number;
  baseHeight: number;
  minScale?: number;
  maxScale?: number;
  precision?: number;
}

export interface PromptFrameLayout {
  slotWidth: number;
  slotHeight: number;
  baseWidth: number;
  baseHeight: number;
  scale: number;
  px(value: number): number;
  clamp(min: number, preferred: number, max: number): string;
}

export function createPromptFrameLayout(options: PromptFrameLayoutOptions): PromptFrameLayout {
  const slotWidth = positiveFinite(options.slotWidth, 'slotWidth');
  const slotHeight = positiveFinite(options.slotHeight, 'slotHeight');
  const baseWidth = positiveFinite(options.baseWidth, 'baseWidth');
  const baseHeight = positiveFinite(options.baseHeight, 'baseHeight');
  const precision = options.precision ?? 3;
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw new Error('precision must be an integer between 0 and 6');
  }

  const minScale = options.minScale === undefined ? 0 : nonNegativeFinite(options.minScale, 'minScale');
  const maxScale = options.maxScale === undefined ? Number.POSITIVE_INFINITY : positiveFinite(options.maxScale, 'maxScale');
  if (maxScale < minScale) {
    throw new Error('maxScale must be greater than or equal to minScale');
  }

  const rawScale = Math.min(slotWidth / baseWidth, slotHeight / baseHeight);
  const scale = round(clampNumber(rawScale, minScale, maxScale), precision);
  const px = (value: number): number => round(finite(value, 'value') * scale, precision);

  return {
    slotWidth,
    slotHeight,
    baseWidth,
    baseHeight,
    scale,
    px,
    clamp(min: number, preferred: number, max: number): string {
      const scaledMin = px(min);
      const scaledPreferred = px(preferred);
      const scaledMax = px(max);
      if (scaledMax < scaledMin) {
        throw new Error('clamp max must be greater than or equal to min');
      }
      return `clamp(${formatCssPx(scaledMin)}, ${formatCssPx(scaledPreferred)}, ${formatCssPx(scaledMax)})`;
    },
  };
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function positiveFinite(value: number, label: string): number {
  const result = finite(value, label);
  if (result <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
  return result;
}

function nonNegativeFinite(value: number, label: string): number {
  const result = finite(value, label);
  if (result < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return result;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function formatCssPx(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : String(value)}px`;
}
