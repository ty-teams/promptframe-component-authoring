import { dirname, join, resolve } from 'node:path';
import { accountError, readAccountIdentity, readBoundCredential, requireAccountBinding, type AccountIdentity } from './account-identity.js';
import { accountKey, accountReferences, accountsRoot, credentialAt, directoryError, readPrivateAccountFile, rememberCliCredential,
  type AccountReference } from './account-directory.js';
import { PromptFrameCliError } from './cli-error.js';

type Config = Record<string, unknown>;

export interface AccountRoute {
  identity: AccountIdentity;
  configFile: string;
  config: Config;
  endpoint: string;
  verified?: Config;
}

export function separateCredentialFile(defaultFile: string, identity: AccountIdentity): string {
  return join(dirname(defaultFile), 'component-accounts', identity.platformDigest.slice(7), identity.accountDigest.slice(7) + '.json');
}

function selectGrant(refs: AccountReference[], preferred: string, requestedId?: string, requestedFile?: string, login = false) {
  if (requestedId || requestedFile) {
    const found = refs.find(ref => (!requestedId || requestedId === ref.referenceId) &&
      (!requestedFile || resolve(requestedFile) === ref.configFile));
    if (!found && (requestedId || !login)) throw directoryError('cli.accounts.credential_missing');
    return found;
  }
  const active = refs.filter(ref => !ref.expiresAt || Date.parse(ref.expiresAt) > Date.now());
  // An explicitly selected or existing profile can disambiguate grants. Never choose by scope or newest timestamp.
  const candidates = active.length ? active : refs;
  const preferredGrant = candidates.find(ref => ref.configFile === preferred);
  if (preferredGrant) return preferredGrant;
  if (candidates.length > 1) throw directoryError('cli.accounts.reference_required');
  return candidates[0];
}

function endpointForFirstLogin(root: string, identity: AccountIdentity, refs: AccountReference[], endpoint?: string) {
  const endpoints = new Set([
    ...refs.map(ref => ref.endpoint),
    ...accountReferences(root, identity, 'creation').map(ref => ref.endpoint.replace(/\/mcp\/?$/, '')),
  ]);
  if (!endpoints.size) throw directoryError('cli.accounts.unknown');
  if (endpoint) {
    if (!endpoints.has(endpoint)) throw accountError('cli.auth.platform_mismatch');
    return endpoint;
  }
  if (endpoints.size !== 1) throw directoryError('cli.accounts.credential_missing');
  return [...endpoints][0]!;
}

export async function resolveAccountRoute(input: {
  identity: AccountIdentity; defaultFile: string; configFile?: string; referenceId?: string;
  endpoint?: string; login?: boolean; root?: string;
}): Promise<AccountRoute> {
  const root = input.root ?? accountsRoot();
  const refs = accountReferences(root, input.identity, 'component-cli');
  const ref = selectGrant(refs, input.defaultFile, input.referenceId, input.configFile, input.login);
  if (!ref) {
    if (!input.login) throw directoryError('cli.accounts.credential_missing');
    const endpoint = endpointForFirstLogin(root, input.identity, refs, input.endpoint);
    const configFile = input.configFile ? resolve(input.configFile) : separateCredentialFile(input.defaultFile, input.identity);
    const config = readPrivateAccountFile(configFile, 131072) ?? {};
    if (config.accountIdentity && !sameIdentity(input.identity, config.accountIdentity)) throw directoryError('cli.accounts.config_in_use');
    if (config.endpoint && config.endpoint !== endpoint) throw accountError('cli.auth.platform_mismatch');
    return {identity: input.identity, endpoint, config, configFile};
  }
  if (input.endpoint && ref.endpoint !== input.endpoint) throw accountError('cli.auth.platform_mismatch');
  const config = credentialAt(ref);
  if (!config) throw directoryError('cli.accounts.reference_changed');
  const result: AccountRoute = {identity: input.identity, configFile: ref.configFile, config, endpoint: ref.endpoint};
  if (input.login) return result;
  if (ref.expiresAt && Date.parse(ref.expiresAt) <= Date.now()) throw accountError('cli.auth.login_required');
  const token = (config.credential as Config).tokenSecret;
  await requireAccountBinding(ref.endpoint, input.identity);
  result.verified = await readBoundCredential(ref.endpoint, 'Bearer ' + token, input.identity);
  return result;
}

/** Registration is optional for legacy logins. Losing local discovery must never invalidate a successful login. */
export function recordObservation(payload: Config, endpoint: string, configFile: string, token: string, strict = false) {
  const identity = readAccountIdentity(payload.accountIdentity);
  try {
    if (!identity) throw accountError('cli.auth.identity_binding_unsupported');
    if (payload.revoked !== false || typeof payload.expiresAt !== 'string' || !(Date.parse(payload.expiresAt) > Date.now())) {
      throw accountError('cli.auth.login_required');
    }
    return {status: 'stored', ...rememberCliCredential(accountsRoot(), {identity, endpoint, configFile, token,
      expiresAt: payload.expiresAt, scopes: payload.scopes})};
  } catch (error) {
    if (strict) throw error instanceof PromptFrameCliError ? error : directoryError();
    return {status: 'unavailable', reasonCode: error instanceof PromptFrameCliError ? error.code : 'cli.accounts.directory_invalid'};
  }
}

export function sameIdentity(identity: AccountIdentity, other: unknown): boolean {
  const parsed = readAccountIdentity(other);
  return !!parsed && accountKey(identity) === accountKey(parsed);
}
