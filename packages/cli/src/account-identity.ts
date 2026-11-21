import { PromptFrameCliError } from './cli-error.js';

const contractVersion = 'promptframe-account-identity/v1';
const digest = /^sha256:[a-f0-9]{64}$/;
export const EXPECTED_IDENTITY_HEADER = 'X-PromptFrame-Expected-Identity';

export interface AccountIdentity {
  contractVersion: typeof contractVersion;
  platformDigest: string;
  accountDigest: string;
}

export function readAccountIdentity(value: unknown): AccountIdentity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || row.contractVersion !== contractVersion
      || typeof row.platformDigest !== 'string' || !digest.test(row.platformDigest)
      || typeof row.accountDigest !== 'string' || !digest.test(row.accountDigest)) return;
  return { contractVersion, platformDigest: row.platformDigest, accountDigest: row.accountDigest };
}

export function parseExpectedIdentity(input: string | undefined): AccountIdentity {
  let row: unknown;
  try { row = input && input.length <= 512 ? JSON.parse(input) : undefined; }
  catch { /* Invalid input gets the same public diagnostic. */ }
  const parsed = readAccountIdentity(row);
  if (!parsed) throw accountError('cli.auth.identity_invalid');
  return parsed;
}

const messages = {
  'cli.auth.identity_invalid': 'Use the complete accountIdentity from the intended authenticated account.',
  'cli.auth.platform_mismatch': 'This platform does not match the selected account. Check the platform endpoint.',
  'cli.auth.account_mismatch': 'This credential belongs to another account. Select the matching CLI configuration or log in to the intended account in a separate configuration.',
  'cli.auth.identity_binding_unsupported': 'This platform does not advertise targeted account operations. Use a compatible platform for this request.',
  'cli.auth.identity_check_unavailable': 'The platform could not confirm the selected account. Retry the identity check before uploading.',
  'cli.auth.login_required': 'Log in with an active credential for the selected account.',
  'cli.auth.scope_missing': 'The selected credential does not allow this operation. Use a credential with the required scope and upload target.',
};

export function accountError(code: keyof typeof messages): PromptFrameCliError {
  return new PromptFrameCliError(messages[code], code, 2);
}

export function identityResponseError(code: unknown): PromptFrameCliError | undefined {
  if (typeof code === 'string' && Object.hasOwn(messages, code)) return accountError(code as keyof typeof messages);
}

async function readAccountResponse(url: string, headers?: Record<string, string>) {
  try {
    const response = await fetch(url, { headers, redirect: 'error' });
    const body: unknown = await response.json().catch(() => ({}));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw accountError('cli.auth.identity_check_unavailable');
    return { response, body: body as Record<string, unknown> };
  } catch {
    throw accountError('cli.auth.identity_check_unavailable');
  }
}

export async function requireAccountBinding(endpoint: string, expected: AccountIdentity): Promise<void> {
  // Discovery is public. A different platform receives no credential or archive.
  const { response, body } = await readAccountResponse(endpoint + '/cli/discovery');
  if (response.status === 404) throw accountError('cli.auth.identity_binding_unsupported');
  if (!response.ok || body.success === false) throw accountError('cli.auth.identity_check_unavailable');
  const binding = body.accountIdentityBinding as Record<string, unknown> | undefined;
  if (!binding || binding.contractVersion !== contractVersion || typeof binding.platformDigest !== 'string'
      || !digest.test(binding.platformDigest) || binding.deviceStartField !== 'expectedIdentity'
      || binding.credentialIdentityField !== 'accountIdentity'
      || typeof binding.uploadHeader !== 'string' || binding.uploadHeader.toLowerCase() !== EXPECTED_IDENTITY_HEADER.toLowerCase()) {
    throw accountError('cli.auth.identity_binding_unsupported');
  }
  if (binding.platformDigest !== expected.platformDigest) throw accountError('cli.auth.platform_mismatch');
}

export async function readBoundCredential(
  endpoint: string, authorization: string | undefined, expected: AccountIdentity,
): Promise<Record<string, unknown>> {
  if (!authorization) throw accountError('cli.auth.login_required');
  const { response, body } = await readAccountResponse(endpoint + '/cli/auth/whoami', {
    authorization,
    [EXPECTED_IDENTITY_HEADER]: JSON.stringify(expected),
  });
  if (response.status === 401) throw accountError('cli.auth.login_required');
  if (!response.ok || body.success === false) throw identityResponseError(body.errorCode) ?? accountError('cli.auth.identity_check_unavailable');
  const actual = readAccountIdentity(body.accountIdentity);
  if (!actual) throw accountError('cli.auth.identity_binding_unsupported');
  if (actual.platformDigest !== expected.platformDigest) throw accountError('cli.auth.platform_mismatch');
  if (actual.accountDigest !== expected.accountDigest) throw accountError('cli.auth.account_mismatch');
  if (body.revoked !== false || typeof body.expiresAt !== 'string' || !(Date.parse(body.expiresAt) > Date.now())) {
    throw accountError('cli.auth.login_required');
  }
  return body;
}
