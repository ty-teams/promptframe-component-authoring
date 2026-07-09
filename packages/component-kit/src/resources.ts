import {
  COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION,
  type ComponentPublicResourceEntry,
  type ComponentPublicResourceKind,
  type ComponentRuntimeResourceManifest,
} from '@promptframe/contracts';

export type PromptFrameRuntimeResources = ComponentRuntimeResourceManifest;
export type PromptFrameRuntimeResourceEntry = ComponentRuntimeResourceManifest['entries'][number];
export type PromptFramePublicResourceCandidate = ComponentPublicResourceEntry | PromptFrameRuntimeResourceEntry;

export interface PromptFramePublicResourceSlot {
  accept?: readonly string[];
  kinds?: readonly ComponentPublicResourceKind[];
  maxFileBytes?: number;
}

export interface PromptFrameRuntimeResourceProps {
  promptFrameResources?: PromptFrameRuntimeResources;
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
