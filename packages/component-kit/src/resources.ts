import {
  COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION,
  type ComponentRuntimeResourceManifest,
} from '@promptframe/contracts';

export type PromptFrameRuntimeResources = ComponentRuntimeResourceManifest;

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
