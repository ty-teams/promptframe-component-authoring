export const COMPONENT_SECURITY_POLICY_DIGEST_VERSION = 'component-security-policy-digest.v0.1' as const;

export function canonicalizePromptFramePolicy(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizePromptFramePolicy(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizePromptFramePolicy(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(null);
}

export function createPromptFramePublicSecurityPolicyDigest(
  policy: unknown,
): `${typeof COMPONENT_SECURITY_POLICY_DIGEST_VERSION}:${string}` {
  const canonicalPolicy = canonicalizePromptFramePolicy(policy);
  const hash = fnv1a64(canonicalPolicy);
  return `${COMPONENT_SECURITY_POLICY_DIGEST_VERSION}:${hash}`;
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
