import { z } from 'zod';

export const propsSchema = z.object({
  kicker: z.string().default('Marketplace Component'),
  title: z.string().default('__DISPLAY_NAME__'),
  background: z.string().default('#101114'),
  foreground: z.string().default('#f4f1ea'),
});

export type ComponentProps = z.infer<typeof propsSchema>;

export const defaultProps: ComponentProps = propsSchema.parse({});
