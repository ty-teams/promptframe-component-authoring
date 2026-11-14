import { z } from 'zod';

export const PROMPTFRAME_STYLE_CONTRACT_VERSION = 'promptframe-style.v0.1.0' as const;

export const promptFrameToneSchema = z.enum([
  'business',
  'tech',
  'minimal',
  'warm',
  'playful',
  'luxury',
  'documentary',
]);
export type PromptFrameTone = z.infer<typeof promptFrameToneSchema>;

export const promptFrameDensitySchema = z.enum(['compact', 'balanced', 'spacious']);
export type PromptFrameDensity = z.infer<typeof promptFrameDensitySchema>;

export const promptFrameMotionIntensitySchema = z.enum(['none', 'subtle', 'balanced', 'expressive']);
export type PromptFrameMotionIntensity = z.infer<typeof promptFrameMotionIntensitySchema>;

export const promptFrameFontScaleSchema = z.enum(['small', 'normal', 'large']);
export type PromptFrameFontScale = z.infer<typeof promptFrameFontScaleSchema>;

export const promptFrameHexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const promptFrameStyleIntentSchema = z.object({
  contractVersion: z.literal(PROMPTFRAME_STYLE_CONTRACT_VERSION).default(PROMPTFRAME_STYLE_CONTRACT_VERSION),
  stylePackId: z.string().trim().min(1).max(80).optional(),
  tone: promptFrameToneSchema.optional(),
  accentColor: promptFrameHexColorSchema.optional(),
  density: promptFrameDensitySchema.optional(),
  motionIntensity: promptFrameMotionIntensitySchema.optional(),
  fontScale: promptFrameFontScaleSchema.optional(),
  brandTokens: z.object({
    primaryColor: promptFrameHexColorSchema.optional(),
    logoAssetId: z.string().trim().min(1).max(160).regex(/^asset:\/\/[a-zA-Z0-9._:-]+$/).optional(),
    fontFamilyHint: z.string().trim().min(1).max(120).optional(),
  }).strict().optional(),
}).strict();
export type PromptFrameStyleIntent = z.infer<typeof promptFrameStyleIntentSchema>;
