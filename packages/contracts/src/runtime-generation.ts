import {z} from 'zod';

/** One supported component runtime. These are host-provided versions, not
 * dependencies a component may replace or install into its preview host. */
export const PROMPTFRAME_COMPONENT_RUNTIME_GENERATION = Object.freeze({
  id: 'runtime-2026.11',
  node: '20.20.2',
  nodeAbi: '115',
  platform: 'linux',
  arch: 'x64',
  libc: 'glibc-2.36',
  packageManager: 'pnpm@10.30.1',
  react: '19.2.5',
  reactDom: '19.2.5',
  remotion: '4.0.487',
  componentKit: '0.1.41',
} as const);

export const componentRuntimeGenerationIdSchema = z.literal(PROMPTFRAME_COMPONENT_RUNTIME_GENERATION.id);

/** Missing declarations remain compatible and are not inserted into old
 * manifests: their canonical bytes and existing component refs stay intact. */
export function resolveComponentRuntimeGeneration(declared?: string) {
  if (declared !== undefined) componentRuntimeGenerationIdSchema.parse(declared);
  return PROMPTFRAME_COMPONENT_RUNTIME_GENERATION;
}
