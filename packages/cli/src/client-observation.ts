import { createRequire } from 'node:module';
import { release } from 'node:os';
import { accountsRoot, cliObservationInstance, validEndpoint } from './account-directory.js';
import { readAccountIdentity } from './account-identity.js';

export const CLIENT_OBSERVATION_HEADER = 'X-PromptFrame-Client-Observation';
const requirePackage = createRequire(import.meta.url);

function systemFamily() {
  switch (process.platform) {
    case 'win32': return 'Windows';
    case 'darwin': return 'macOS';
    case 'android': return 'Android';
    case 'linux': return process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME || /microsoft|wsl/i.test(release()) ? 'WSL' : 'Linux';
    default: return 'unknown';
  }
}

/** Only an authenticated reply for the credential in this request can identify the account. */
export function clientObservation(verified: Record<string, unknown> | undefined, configFile: string): string | undefined {
  const identity = readAccountIdentity(verified?.accountIdentity);
  if (!identity || verified?.tokenKind !== 'human' || verified.revoked !== false ||
      typeof verified.expiresAt !== 'string' || !(Date.parse(verified.expiresAt) > Date.now())) return;
  try {
    const version: unknown = requirePackage('../package.json').version;
    const instanceId = cliObservationInstance(accountsRoot(), identity, configFile);
    return encodeURIComponent(JSON.stringify({
      contractVersion: 'promptframe-client-observation/v1', instanceId, application: 'PromptFrame CLI',
      systemFamily: systemFamily(),
      ...(typeof version === 'string' && version.length <= 40 && /^\d+(?:\.\d+){0,3}(?:-[a-zA-Z0-9.-]+)?$/.test(version) &&
        {applicationVersion: version}),
    }));
  } catch { return; } // Optional private display storage may be unavailable.
}

/** Legacy platforms and transient errors omit device display without changing the primary operation. */
export async function readDisplayIdentity(endpoint: string, headers: Record<string, string>): Promise<Record<string, unknown> | undefined> {
  if (!headers.authorization || !validEndpoint(endpoint)) return;
  try {
    const response = await fetch(endpoint + '/cli/auth/whoami', {
      headers, redirect: 'error', signal: AbortSignal.timeout(1500),
    });
    if (response.ok) {
      const value = await response.json();
      if (value && typeof value === 'object' && !Array.isArray(value) && value.success !== false) return value;
    } else {
      await response.body?.cancel();
    }
  } catch { /* Display metadata is optional. */ }
}
