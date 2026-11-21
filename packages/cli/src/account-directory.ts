import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  opendirSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readAccountIdentity, type AccountIdentity } from './account-identity.js';
import { PromptFrameCliError } from './cli-error.js';

const referenceVersion = 'promptframe-local-account-directory/v1';
const hex = /^[a-f0-9]{64}$/;
const recordLimit = 16 * 1024;
const clients = ['creation', 'component-cli'] as const;
const digest = (text: string) => 'sha256:' + createHash('sha256').update(text).digest('hex');
type Client = 'component-cli' | 'creation';
type RecordObject = Record<string, unknown>;
export interface AccountReference {
  contractVersion: typeof referenceVersion;
  identity: AccountIdentity;
  client: Client;
  referenceId: string;
  configFile: string;
  endpoint: string;
  credentialDigest: string;
  observedAt: string;
  expiresAt?: string;
  profile?: string;
  scopes?: string[];
}

export function directoryError(code = 'cli.accounts.directory_invalid'): PromptFrameCliError {
  const messages: Record<string, string> = {
    'cli.accounts.directory_invalid': 'Account directory is unavailable or has unsafe permissions.',
    'cli.accounts.unknown': 'Select an account key returned by account list.',
    'cli.accounts.credential_missing': 'This account has no usable component CLI credential. Log in with the selected identity.',
    'cli.accounts.host_unverified': 'Use promptframe_local_select_account in your agent to switch persistently. In a shell pass --account <identityKey>.',
    'cli.accounts.reference_required': 'Multiple component CLI grants match. Select a referenceId from accounts list with --reference-id.',
    'cli.accounts.reference_changed': 'The stored grant has changed. Refresh its original CLI configuration.',
    'cli.accounts.config_in_use': 'This configuration belongs to a different account. Use a separate configuration.',
    'cli.accounts.listing_limit': 'The local account directory exceeds its listing limit.',
    'cli.accounts.account_required': 'Multiple local accounts are available. Pass --account with the identityKey selected in your agent, or use an explicit CLI profile.',
  };
  return new PromptFrameCliError(messages[code] ?? messages['cli.accounts.directory_invalid'], code, 2);
}

export function accountsRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PROMPTFRAME_ACCOUNT_DIRECTORY && (env.NODE_ENV === 'test' || env.NODE_TEST_CONTEXT)) {
    return resolve(env.PROMPTFRAME_ACCOUNT_DIRECTORY);
  }
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'promptframe', 'accounts', 'v1');
}

export function accountKey(identity: AccountIdentity): string {
  return identity.platformDigest.slice(7) + '-' + identity.accountDigest.slice(7);
}

export function identityFromKey(key: string): AccountIdentity {
  const [platform, account] = key.split('-');
  if (key.length !== 129 || !hex.test(platform) || !hex.test(account)) throw directoryError('cli.accounts.unknown');
  return {contractVersion: 'promptframe-account-identity/v1', platformDigest: 'sha256:' + platform, accountDigest: 'sha256:' + account};
}

function record(value: unknown): value is RecordObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function missing(error: unknown) { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function privateMode(info: Stats): boolean {
  return typeof process.getuid === 'function' && info.uid === process.getuid() && (Number(info.mode) & 0o077) === 0;
}

/** Only catalogue-owned directories may be created. Reads never create the catalogue. */
function checkedDirectory(root: string, path: string, create: boolean): boolean {
  const tail = relative(root, path);
  if (tail.startsWith('..') || isAbsolute(tail)) throw directoryError();
  if (create) mkdirSync(dirname(root), {recursive: true, mode: 0o700});
  let dir = root;
  for (const part of ['', ...tail.split(sep).filter(Boolean)]) {
    if (part) dir = join(dir, part);
    if (create) {
      try { mkdirSync(dir, {mode: 0o700}); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw directoryError(); }
    }
    try {
      const info = lstatSync(dir);
      if (!info.isDirectory() || !privateMode(info) || realpathSync(dir) !== resolve(dir)) throw directoryError();
    } catch (error) { if (missing(error) && !create) return false; throw directoryError(); }
  }
  return true;
}

/** A catalogue path is a hint. Only an owner-private regular credential file can supply a token. */
export function readPrivateAccountFile(file: string, limit = recordLimit): RecordObject | undefined {
  let fd: number | undefined;
  try {
    if (realpathSync(dirname(file)) !== resolve(dirname(file))) throw directoryError();
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit || !privateMode(stat)) throw directoryError();
    const buffer = Buffer.alloc(stat.size + 1);
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    const after = fstatSync(fd), current = lstatSync(file);
    if (bytes !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs ||
        current.dev !== stat.dev || current.ino !== stat.ino) throw directoryError('cli.accounts.reference_changed');
    const value: unknown = JSON.parse(buffer.toString('utf8', 0, bytes));
    if (!record(value)) throw directoryError();
    return value;
  } catch (error) { if (missing(error)) return; throw directoryError(); }
  finally { if (fd !== undefined) closeSync(fd); }
}

function atomicAccountFile(file: string, value: RecordObject | AccountReference): void {
  const payload = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(payload) > recordLimit) throw directoryError();
  const tmp = join(dirname(file), '.' + randomUUID() + '.tmp');
  const parent = openSync(dirname(file), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const original = fstatSync(parent);
    if (!privateMode(original)) throw directoryError();
    const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, payload); fsyncSync(fd); } finally { closeSync(fd); }
    const current = lstatSync(dirname(file));
    if (current.dev !== original.dev || current.ino !== original.ino) throw directoryError();
    try {
      const prior = lstatSync(file);
      if (!privateMode(prior) || !prior.isFile() || prior.nlink !== 1) throw directoryError();
    } catch (error) { if (!missing(error)) throw error; }
    renameSync(tmp, file);
    fsyncSync(parent);
  } finally {
    closeSync(parent);
    try { unlinkSync(tmp); } catch (error) { if (!missing(error)) throw error; }
  }
}

function idFor(client: Client, file: string) { return digest(JSON.stringify([client, resolve(file)])); }
function folder(root: string, identity: AccountIdentity, client: Client) {
  return join(root, 'identities', identity.platformDigest.slice(7), identity.accountDigest.slice(7), client);
}

export function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    const u = new URL(value);
    return !u.username && !u.password && !u.search && !u.hash &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)));
  } catch { return false; }
}

function optionalProfile(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : undefined;
}
function instant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function safeScopes(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length <= 20 &&
    value.every(x => typeof x === 'string' && /^[a-z0-9_.:-]{1,100}$/.test(x)) ? value : undefined;
}

export function rememberCliCredential(root: string, input: {
  identity: AccountIdentity; configFile: string; endpoint: string; token: string;
  expiresAt?: unknown; profile?: unknown; scopes?: unknown;
}) {
  const configFile = resolve(input.configFile);
  const config = readPrivateAccountFile(configFile, 131072), actual = config?.credential;
  if (!record(actual) || actual.tokenSecret !== input.token || actual.endpoint !== input.endpoint ||
      (config?.endpoint && config.endpoint !== input.endpoint) || !validEndpoint(input.endpoint) ||
      !input.token || input.token.length > 4096 || configFile.length > 4096) throw directoryError('cli.accounts.reference_changed');
  const dir = folder(root, input.identity, 'component-cli');
  checkedDirectory(root, dir, true);
  const referenceId = idFor('component-cli', configFile);
  const entry: AccountReference = {contractVersion: referenceVersion, identity: input.identity,
    client: 'component-cli', referenceId, configFile, endpoint: input.endpoint,
    credentialDigest: digest(input.token), observedAt: new Date().toISOString(),
    expiresAt: instant(input.expiresAt) ? input.expiresAt : undefined,
    profile: optionalProfile(input.profile), scopes: safeScopes(input.scopes)};
  atomicAccountFile(join(dir, referenceId.slice(7) + '.json'), entry);
  return {identityKey: accountKey(input.identity), referenceId};
}

function entries(root: string, dir: string, files = false): string[] {
  if (!checkedDirectory(root, dir, false)) return [];
  const handle = opendirSync(dir), names: string[] = [];
  try {
    for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
      if (entry.name.startsWith('.')) continue;
      if (names.length === 256) throw directoryError('cli.accounts.listing_limit');
      const valid = files ? entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name) : entry.isDirectory() && hex.test(entry.name);
      if (!valid) throw directoryError();
      names.push(entry.name);
    }
  } finally { handle.closeSync(); }
  return names.sort();
}

export function accountReferences(root: string, expected: AccountIdentity, client: Client): AccountReference[] {
  const result: AccountReference[] = [];
  const dir = folder(root, expected, client);
  for (const file of entries(root, dir, true)) {
    const v = readPrivateAccountFile(join(dir, file));
    if (!v) continue;
    const identity = readAccountIdentity(v.identity);
    const fields = ['contractVersion', 'identity', 'client', 'referenceId', 'configFile', 'endpoint', 'credentialDigest',
      'observedAt', 'expiresAt', 'profile', 'scopes'];
    if (Object.keys(v).some(k => !fields.includes(k)) || !identity || accountKey(identity) !== accountKey(expected) ||
        v.contractVersion !== referenceVersion || v.client !== client || typeof v.configFile !== 'string' ||
        !isAbsolute(v.configFile) || v.configFile.length > 4096 || v.configFile !== resolve(v.configFile) ||
        v.referenceId !== idFor(client, v.configFile) || v.referenceId !== 'sha256:' + file.slice(0,-5) ||
        typeof v.credentialDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(v.credentialDigest) ||
        !validEndpoint(v.endpoint) || !instant(v.observedAt) || v.expiresAt !== undefined && !instant(v.expiresAt) ||
        v.profile !== undefined && !optionalProfile(v.profile) || v.scopes !== undefined && !safeScopes(v.scopes)) throw directoryError();
    result.push({contractVersion: referenceVersion, identity, client, configFile: v.configFile,
      referenceId: v.referenceId, endpoint: v.endpoint, credentialDigest: v.credentialDigest, observedAt: v.observedAt,
      expiresAt: instant(v.expiresAt) ? v.expiresAt : undefined, profile: optionalProfile(v.profile), scopes: safeScopes(v.scopes)});
  }
  return result;
}

function grantView(ref: AccountReference) {
  return {referenceId: ref.referenceId, profile: ref.profile, observedAt: ref.observedAt, expiresAt: ref.expiresAt,
    status: ref.expiresAt && Date.parse(ref.expiresAt) <= Date.now() ? 'expired' : 'stored'};
}

export function listLocalAccounts(root: string) {
  const accounts = [], base = join(root, 'identities');
  for (const platform of entries(root, base)) {
    for (const account of entries(root, join(base, platform))) {
      if (accounts.length === 256) throw directoryError('cli.accounts.listing_limit');
      const identityKey = platform + '-' + account;
      const identity = identityFromKey(identityKey);
      const grants = {creation: accountReferences(root, identity, 'creation').map(grantView),
        'component-cli': accountReferences(root, identity, 'component-cli').map(grantView)};
      accounts.push({identityKey, identity, grants, missingClients: clients.filter(c => !grants[c].some(g => g.status === 'stored'))});
    }
  }
  return {accounts, complete: true};
}

export function multipleLocalAccounts(root: string): boolean {
  return listLocalAccounts(root).accounts.filter(row => row.missingClients.length < clients.length).length > 1;
}

export function credentialAt(ref: AccountReference): RecordObject | undefined {
  if (ref.client !== 'component-cli') return;
  const data = readPrivateAccountFile(ref.configFile, 131072), c = data?.credential;
  if (record(c) && typeof c.tokenSecret === 'string' && digest(c.tokenSecret) === ref.credentialDigest &&
      c.endpoint === ref.endpoint && (!data?.endpoint || data.endpoint === ref.endpoint)) return data;
}

export function forgetCliCredential(root: string, identity: AccountIdentity, configFile: string, token: string) {
  const dir = folder(root, identity, 'component-cli');
  if (!checkedDirectory(root, dir, false)) return;
  const file = join(dir, idFor('component-cli', configFile).slice(7) + '.json');
  const expected = digest(token);
  if (readPrivateAccountFile(file)?.credentialDigest !== expected) return;
  const moved = join(dir, '.' + randomUUID() + '.tmp');
  try { renameSync(file, moved); } catch (error) { if (missing(error)) return; throw error; }
  try {
    if (readPrivateAccountFile(moved)?.credentialDigest !== expected) {
      // A concurrent login won the race. Restore that exact reference unless an even newer one already exists.
      try { linkSync(moved, file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
  } finally { unlinkSync(moved); }
}
