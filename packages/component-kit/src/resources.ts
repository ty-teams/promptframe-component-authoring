import {
  COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION,
  componentResourceSlotSchema,
  type ComponentPublicResourceEntry,
  type ComponentPublicResourceKind,
  type ComponentRuntimeResourceManifest,
} from '@promptframe/contracts';

export type PromptFrameRuntimeResources = ComponentRuntimeResourceManifest;
export type PromptFrameRuntimeResourceEntry = ComponentRuntimeResourceManifest['entries'][number];
export type PromptFramePublicResourceCandidate = ComponentPublicResourceEntry | PromptFrameRuntimeResourceEntry;

export interface PromptFramePublicResourceSlot {
  sources?: readonly ('public' | 'asset')[];
  accept?: readonly string[];
  kinds?: readonly ComponentPublicResourceKind[];
  maxFileBytes?: number;
}

export interface PromptFrameRuntimeResourceProps {
  promptFrameResources?: PromptFrameRuntimeResources;
}

export class PromptFrameResourceError extends Error {
  constructor(readonly code: 'resource.reference_unresolved' | 'resource.representation_invalid') {
    super(code);
    this.name = 'PromptFrameResourceError';
  }
}

/** Asset authorization and URL renewal belong to the host. This helper never
 * fetches, reads credentials, or falls back from an unresolved asset reference. */
export function promptFrameResource<Props extends object>(
  resourcesOrProps: Props | undefined,
  reference: string | null | undefined,
  fallback?: string,
): string {
  const runtime = resourcesOrProps as PromptFrameRuntimeResources | PromptFrameRuntimeResourceProps | undefined;
  const fallbackPath = fallback === undefined ? undefined : normalizePromptFramePublicResourcePath(fallback);
  if (fallback !== undefined && !fallbackPath) throw new PromptFrameResourceError('resource.representation_invalid');
  if (reference == null || reference === '') {
    return fallbackPath ? promptFramePublicResource(runtime, fallbackPath) : '';
  }
  if (reference.trim() !== reference) throw new PromptFrameResourceError('resource.representation_invalid');
  if (/^asset-proxy:/i.test(reference)
    || reference.startsWith('/api/assets/proxy/') || reference.startsWith('/api-proxy/assets/proxy/')) {
    throw new PromptFrameResourceError('resource.reference_unresolved');
  }
  // These representations are supplied by preview preparation or the render
  // input resolver. This is presentation, never an authorization decision.
  if (/^(?:https?:|blob:)/i.test(reference)) {
    try {
      const URLConstructor = (globalThis as { URL?: new (value: string) => {
        username: string; password: string; protocol: string; origin: string;
      } }).URL;
      if (!URLConstructor) throw new Error();
      const url = new URLConstructor(reference);
      if (url.username || url.password || !['http:', 'https:', 'blob:'].includes(url.protocol)) throw new Error();
      if (url.protocol === 'blob:' && url.origin === 'null'
        && !/^blob:null\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(reference)) throw new Error();
      return reference;
    } catch { throw new PromptFrameResourceError('resource.representation_invalid'); }
  }
  const path = normalizePromptFramePublicResourcePath(reference);
  if (!path) throw new PromptFrameResourceError('resource.representation_invalid');
  return promptFramePublicResource(runtime, path, fallbackPath);
}

export function promptFramePublicResource(
  resourcesOrProps: PromptFrameRuntimeResources | PromptFrameRuntimeResourceProps | undefined,
  publicPath: string,
  fallback?: string,
): string {
  const normalized = normalizePromptFramePublicResourcePath(publicPath);
  if (!normalized) return fallback ?? '';

  const resources = extractPromptFrameRuntimeResources(resourcesOrProps);
  const match = resources?.entries.find((entry) => entry.publicPath === normalized);
  return match?.url ?? fallback ?? normalized;
}

export function normalizePromptFramePublicResourcePath(publicPath: string): `/${string}` | undefined {
  const value = publicPath.trim();
  if (!value || value !== publicPath) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//') || value.includes('\\')) return undefined;
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  if (withSlash.includes('//')) return undefined;
  const parts = withSlash.slice(1).split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return undefined;
  return /^[A-Za-z0-9._~!$&'()+,;=@/-]+$/.test(withSlash) ? withSlash as `/${string}` : undefined;
}

export function promptFramePublicResourceSlotFromSchema(schema: unknown): PromptFramePublicResourceSlot | undefined {
  if (!isRecord(schema)) return undefined;
  const candidate = schema.promptFrameResource ?? schema.xPromptFrameResource;
  if (!isRecord(candidate)) return undefined;
  if (Object.hasOwn(candidate, 'sources')) {
    const parsed = componentResourceSlotSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
  }

  const accept = stringArray(candidate.accept);
  const kind = typeof candidate.kind === 'string' ? candidate.kind : undefined;
  const kinds = uniqueKinds([...stringArray(candidate.kinds), ...(kind ? [kind] : [])]);
  const maxFileBytes = typeof candidate.maxFileBytes === 'number' && Number.isFinite(candidate.maxFileBytes) && candidate.maxFileBytes > 0
    ? Math.floor(candidate.maxFileBytes)
    : undefined;

  if (!accept.length && !kinds.length && maxFileBytes === undefined) return undefined;
  return {
    ...(accept.length ? { accept } : {}),
    ...(kinds.length ? { kinds } : {}),
    ...(maxFileBytes !== undefined ? { maxFileBytes } : {}),
  };
}

export function promptFrameRuntimeResourceMatchesSlot(
  entry: PromptFramePublicResourceCandidate,
  slot: PromptFramePublicResourceSlot | undefined,
): boolean {
  if (!slot) return false;
  if (slot.kinds?.length && !slot.kinds.includes(entry.kind)) return false;
  if (slot.maxFileBytes !== undefined && entry.sizeBytes > slot.maxFileBytes) return false;
  if (!slot.accept?.length) return true;
  return slot.accept.some((pattern) => mimePatternMatches(pattern, entry.contentType));
}

export function filterPromptFramePublicResourcesForSlot(
  resourcesOrProps: PromptFrameRuntimeResources | PromptFrameRuntimeResourceProps | undefined,
  slot: PromptFramePublicResourceSlot | undefined,
): PromptFrameRuntimeResourceEntry[] {
  if (!slot) return [];
  if (slot.sources && !slot.sources.includes('public')) return [];
  const resources = extractPromptFrameRuntimeResources(resourcesOrProps);
  if (!resources) return [];
  return resources.entries.filter((entry) => promptFrameRuntimeResourceMatchesSlot(entry, slot));
}

function extractPromptFrameRuntimeResources(
  resourcesOrProps: PromptFrameRuntimeResources | PromptFrameRuntimeResourceProps | undefined,
): PromptFrameRuntimeResources | undefined {
  if (!resourcesOrProps) return undefined;
  const candidate = hasRuntimeResourceEntries(resourcesOrProps)
    ? resourcesOrProps
    : resourcesOrProps.promptFrameResources;
  if (!candidate || candidate.contractVersion !== COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION) return undefined;
  return candidate;
}

function hasRuntimeResourceEntries(value: unknown): value is PromptFrameRuntimeResources {
  return typeof value === 'object'
    && value !== null
    && Array.isArray((value as { entries?: unknown }).entries);
}

function mimePatternMatches(pattern: string, contentType: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  const normalizedType = contentType.trim().toLowerCase();
  if (!normalizedPattern || !normalizedType) return false;
  if (normalizedPattern === '*/*') return true;
  if (normalizedPattern.endsWith('/*')) return normalizedType.startsWith(normalizedPattern.slice(0, -1));
  return normalizedPattern === normalizedType;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function uniqueKinds(values: string[]): ComponentPublicResourceKind[] {
  const allowed = new Set<ComponentPublicResourceKind>(['image', 'audio', 'video', 'font', 'json', 'text']);
  const result: ComponentPublicResourceKind[] = [];
  for (const value of values) {
    if (allowed.has(value as ComponentPublicResourceKind) && !result.includes(value as ComponentPublicResourceKind)) {
      result.push(value as ComponentPublicResourceKind);
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
