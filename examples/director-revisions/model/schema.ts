import { promptFrameResourceSchema } from '@promptframe/contracts';
import { z } from 'zod';

export const propsSchema = z.object({
  title: z.string().describe('Accessible name of the shot.').default('Model study'),
  model: promptFrameResourceSchema({
    kinds: ['model'], sources: ['public', 'asset'],
    accept: ['model/gltf-binary'], maxFileBytes: 1048576,
  }).describe('Self-contained solid-color model for this shot.').default('/blue.glb'),
});
export type ComponentProps = z.infer<typeof propsSchema>;
export const defaultProps = propsSchema.parse({});
