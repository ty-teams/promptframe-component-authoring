import { z } from 'zod';

export const componentPublicResourceKindSchema = z.enum([
  'image', 'audio', 'video', 'font', 'json', 'text',
]);
export type ComponentPublicResourceKind = z.infer<typeof componentPublicResourceKindSchema>;

/** Describes input selection; it does not authorize access to an asset. */
export const componentResourceSlotSchema = z.object({
  kinds: z.array(componentPublicResourceKindSchema).min(1).max(6),
  sources: z.array(z.enum(['public', 'asset'])).min(1).max(2).default(['public', 'asset']),
  accept: z.array(z.string().min(1).max(120)).max(20).optional(),
  maxFileBytes: z.number().int().positive().max(64 * 1024 * 1024).optional(),
}).strict().superRefine((value, context) => {
  for (const field of ['kinds', 'sources'] as const) {
    if (new Set(value[field]).size !== value[field].length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Duplicate resource slot entry.' });
    }
  }
});
export type ComponentResourceSlot = z.infer<typeof componentResourceSlotSchema>;

export interface PromptFrameAssetReference { assetId: string; variant?: string }

export function parsePromptFrameAssetReference(reference: string): PromptFrameAssetReference | undefined {
  if (reference.length > 2_000) return undefined;
  const match = /^asset-proxy:\/\/(asset[_-][A-Za-z0-9][A-Za-z0-9_-]{0,179})(?:\?variant=([A-Za-z0-9][A-Za-z0-9._-]{0,159}))?$/u.exec(reference);
  return match ? { assetId: match[1]!, ...(match[2] ? { variant: match[2] } : {}) } : undefined;
}

export interface ComponentResourceReference {
  path: (string | number)[];
  reference: string;
  source: 'public' | 'asset';
  slot: ComponentResourceSlot;
  asset?: PromptFrameAssetReference;
}

export class ComponentResourceReferenceError extends Error {
  constructor(readonly code: 'component.resource.slot_invalid' | 'component.resource.reference_invalid'
    | 'component.resource.source_not_allowed' | 'component.resource.budget_exceeded') {
    super(code); this.name = 'ComponentResourceReferenceError';
  }
}

/** Walks declared slots only. Selection metadata never supplies identity or an
 * access decision; each returned asset still requires host authorization. */
export function collectPromptFrameResourceReferences(schema: unknown, props: unknown): ComponentResourceReference[] {
  const found: ComponentResourceReference[] = [];
  let visited = 0;
  const visit = (schema: unknown, value: unknown, path: (string | number)[], depth: number) => {
    if (++visited > 10_000 || depth > 16) throw new ComponentResourceReferenceError('component.resource.budget_exceeded');
    if (!isRecord(schema)) return;
    const metadata = schema.promptFrameResource;
    // Legacy public-only metadata keeps its original selection behavior.
    if (isRecord(metadata) && Object.hasOwn(metadata, 'sources')) {
      const parsed = componentResourceSlotSchema.safeParse(metadata);
      if (!parsed.success) throw new ComponentResourceReferenceError('component.resource.slot_invalid');
      if (value === undefined || value === null) return;
      if (typeof value !== 'string' || !value || value.length > 2_000 || value !== value.trim()) {
        throw new ComponentResourceReferenceError('component.resource.reference_invalid');
      }
      const asset = parsePromptFrameAssetReference(value);
      const source = asset ? 'asset' : 'public';
      if (!asset && (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/api/assets/proxy/')
        || value.startsWith('/api-proxy/assets/proxy/') || value.startsWith('//') || value.includes('\\')
        || !/^\/?[A-Za-z0-9._~!$&'()+,;=@/-]+$/u.test(value)
        || value.includes('//') || value.split('/').some(part => part === '.' || part === '..'))) {
        throw new ComponentResourceReferenceError('component.resource.reference_invalid');
      }
      if (!parsed.data.sources.includes(source)) throw new ComponentResourceReferenceError('component.resource.source_not_allowed');
      if (found.length >= 64) throw new ComponentResourceReferenceError('component.resource.budget_exceeded');
      found.push({ path, reference: value, source, slot: parsed.data, ...(asset ? { asset } : {}) });
      return;
    }
    if (Array.isArray(value) && schema.items) {
      value.forEach((item, index) => visit(schema.items, item, [...path, index], depth + 1));
    } else if (isRecord(value) && isRecord(schema.properties)) {
      for (const [key, child] of Object.entries(schema.properties)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new ComponentResourceReferenceError('component.resource.slot_invalid');
        visit(child, value[key], [...path, key], depth + 1);
      }
    }
  };
  visit(schema, props, [], 0);
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A JSON string stores a public path or an asset reference. The host resolves
 * asset references before rendering and keeps credentials outside components. */
export function promptFrameResourceSchema(options: z.input<typeof componentResourceSlotSchema>) {
  const slot = componentResourceSlotSchema.parse(options);
  const schema = z.string().min(1).max(2_000);
  Object.assign(schema._def, { promptFrameResource: slot });
  return schema;
}
