import { z } from 'zod';

export const propsSchema = z.object({
  title: z.string().describe('Accessible name of the shot.').default('Two arrows'),
  lowerLength: z.number().min(40).max(300).describe('Length of the lower arrow in a 640-unit viewBox.').default(140),
  cueFrame: z.number().int().min(0).max(119).describe('First local frame with the lower arrow highlighted, at 30 fps.').default(72),
});
export type ComponentProps = z.infer<typeof propsSchema>;
export const defaultProps = propsSchema.parse({});
