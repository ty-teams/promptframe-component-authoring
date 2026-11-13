import { existsSync, readFileSync } from 'node:fs';

export class CliCredentialError extends Error {
  constructor(readonly code: 'cli.auth.token_expired') { super(code); }
}

export function readCliConfiguration(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Shared read-only access to the existing credential; never logs or writes it. */
export function cliBearerToken(input: {
  endpoint: string; explicit?: string; configuration: Record<string, unknown>; now?: () => number;
}): string | undefined {
  if (input.explicit) return input.explicit;
  const credential = input.configuration.credential;
  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) return undefined;
  const row = credential as Record<string, unknown>;
  const normalize = (value: string) => value.replace(/\/+$/, '');
  if (typeof row.endpoint !== 'string' || normalize(row.endpoint) !== normalize(input.endpoint)) return undefined;
  if (typeof row.expiresAt === 'string' && Date.parse(row.expiresAt) <= (input.now ?? Date.now)()) {
    throw new CliCredentialError('cli.auth.token_expired');
  }
  return typeof row.tokenSecret === 'string' ? row.tokenSecret : undefined;
}
