import { z } from 'zod';

export const propsSchema = z.object({
  kicker: z.string().describe('Short eyebrow text shown above the main title.').default('Marketplace Component'),
  title: z.string().describe('Main title text rendered in the component preview.').default('__DISPLAY_NAME__'),
  background: z.string().describe('Background color used by the component canvas.').default('#101114'),
  foreground: z.string().describe('Foreground text color used for readable copy.').default('#f4f1ea'),
});

export type ComponentProps = z.infer<typeof propsSchema>;

export const defaultProps: ComponentProps = propsSchema.parse({});
