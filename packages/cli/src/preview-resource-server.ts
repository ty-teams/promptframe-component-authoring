import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { collectPromptFrameResourceReferences, assertSelfContainedGlb, PROMPTFRAME_PUBLIC_RESOURCE_LIMITS,
  type ComponentResourceSlot, type PromptFrameModelRepresentation } from '@promptframe/contracts';
import { normalizePublicResourcePath } from './public-resource-path.js';
import { evaluatePromptFrameSchemaSource } from '@promptframe/contracts/schema-evaluator';
import { cliBearerToken, readCliConfiguration } from './configuration.js';
import { capturePreviewResourceFile, previewResourcePropPath, readPreviewResourceDraft,
  type PreviewResourceSelection } from './preview-resource-draft.js';

const virtual = 'virtual:promptframe-local-preview', resolvedVirtual = '\0' + virtual;
const maximumBytes = 16 * 1024 * 1024;
type Grant = { reference: string; status: string; code?: string; url?: string; contentType?: string; sizeBytes?: number; sha256?: string; expiresAt?: string };

function localFileMatches(slot: ComponentResourceSlot, file: { size: number; contentType: string }): boolean {
  return slot.kinds.includes(file.contentType === 'model/gltf-binary' ? 'model' : 'image') && (slot.maxFileBytes === undefined || file.size <= slot.maxFileBytes)
    && (!slot.accept?.length || slot.accept.some(pattern => pattern === '*/*' || pattern === file.contentType
      || pattern.endsWith('/*') && file.contentType.startsWith(pattern.slice(0, -1))));
}

function safeCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^(?:preview\.resource\.|cli\.auth\.)[a-z0-9_.]{1,100}$/u.test(code) ? code : 'preview.resource.unavailable';
}

function readBoundedFile(path: string, maximum: number, expected?: { dev: number; ino: number; size: number }): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (expected && (stat.ino !== expected.ino || stat.dev !== expected.dev || stat.size !== expected.size)) throw Error('preview.resource.file_changed');
    if (!stat.isFile() || stat.size > maximum) throw Error('preview.resource.input_budget');
    const result = Buffer.alloc(stat.size + 1); let size = 0;
    while (size < result.length) { const count = readSync(fd, result, size, result.length - size, null); if (!count) break; size += count; }
    const after = fstatSync(fd);
    if (size !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw Error('preview.resource.input_changed');
    return result.subarray(0, size);
  } finally { closeSync(fd); }
}

function readJson(path: string, max = 131_072): Record<string, unknown> {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = fstatSync(fd); if (!stat.isFile() || stat.size > max) throw Error('preview.resource.input_budget');
    const value: unknown = JSON.parse(readFileSync(fd, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('preview.resource.input_invalid');
    return value as Record<string, unknown>;
  } finally { closeSync(fd); }
}

/** Reuse the normal CLI public-resource report, but never trust a URL from it.
 * Every model is rechecked against its exact ordinary public/ file. */
function publicModelRows(root: string): {selection: PreviewResourceSelection; reference: string}[] {
  const reportPath = join(root, '.promptframe/dev-public-resources.json');
  if (!existsSync(reportPath)) return [];
  const directory = join(root, '.promptframe');
  if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) throw Error('preview.resource.public_report_invalid');
  const report = readJson(reportPath), entries = report.entries;
  if (!['accepted', 'empty'].includes(String(report.status)) || !Array.isArray(entries)
    || entries.length > PROMPTFRAME_PUBLIC_RESOURCE_LIMITS.maxFiles) throw Error('preview.resource.public_report_invalid');
  let total = 0;
  const rows: {selection: PreviewResourceSelection; reference: string}[] = [];
  for (const value of entries) {
    if (!value || typeof value !== 'object' || value.kind !== 'model') continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.sourcePath !== 'string' || !entry.sourcePath.startsWith('public/')
      || typeof entry.publicPath !== 'string' || !Number.isSafeInteger(entry.sizeBytes)
      || Number(entry.sizeBytes) < 1 || Number(entry.sizeBytes) > PROMPTFRAME_PUBLIC_RESOURCE_LIMITS.maxFileBytes) throw Error('preview.resource.public_report_invalid');
    total += Number(entry.sizeBytes);
    if (total > PROMPTFRAME_PUBLIC_RESOURCE_LIMITS.maxTotalBytes) throw Error('preview.resource.public_report_invalid');
    const normalized = normalizePublicResourcePath(entry.sourcePath.slice(7));
    if (!normalized.ok || normalized.sourcePath !== entry.sourcePath || normalized.publicPath !== entry.publicPath
      || !normalized.relativePath.toLowerCase().endsWith('.glb')) throw Error('preview.resource.public_report_invalid');
    const path = join(root, normalized.sourcePath);
    if (realpathSync(path) !== path || lstatSync(path).size !== entry.sizeBytes) throw Error('preview.resource.file_changed');
    const file = capturePreviewResourceFile(path);
    if (realpathSync(path) !== path || file.contentType !== 'model/gltf-binary' || file.size !== entry.sizeBytes
      || file.sha256 !== entry.sha256) throw Error('preview.resource.file_changed');
    if (rows.some(row => row.reference === normalized.publicPath)) throw Error('preview.resource.public_report_invalid');
    rows.push({selection: {prop: '/__public_model/' + rows.length, file}, reference: normalized.publicPath});
  }
  return rows;
}

function setProp(props: Record<string, unknown>, pointer: string, value: string): void {
  const path = previewResourcePropPath(pointer); let object: unknown = props;
  for (const key of path.slice(0, -1)) {
    if (!object || typeof object !== 'object' || !Object.hasOwn(object, key)) throw Error('preview.resource.prop_missing');
    object = (object as Record<string | number, unknown>)[key];
  }
  if (!object || typeof object !== 'object') throw Error('preview.resource.prop_missing');
  (object as Record<string | number, unknown>)[path.at(-1)!] = value;
}

function relativePath(root: string, path: string): boolean {
  const within = relative(realpathSync(root), path);
  return !!within && !isAbsolute(within) && within !== '..' && !within.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'));
}

function selectionSlot(root: string, selection: PreviewResourceSelection): ComponentResourceSlot {
  const manifest = readJson(join(root, 'manifest.json'));
  const entry = manifest.entry as { propsSchemaPath?: unknown } | undefined;
  const schemaPath = typeof entry?.propsSchemaPath === 'string' ? entry.propsSchemaPath : 'src/schema.ts';
  const path = resolve(root, schemaPath), physical = realpathSync(path), within = relativePath(root, physical);
  if (!within) throw Error('preview.resource.schema_invalid');
  const facts = evaluatePromptFrameSchemaSource(readBoundedFile(path, 131_072).toString('utf8'));
  if (facts.status !== 'resolved') throw Error('preview.resource.schema_invalid');
  const props = structuredClone(readJson(join(root, 'src/preview-props.json')).props ?? {}) as Record<string, unknown>;
  setProp(props, selection.prop, selection.reference ?? '/local-preview.png');
  const binding = collectPromptFrameResourceReferences({ type: 'object', properties: facts.properties }, props)
    .find(row => JSON.stringify(row.path) === JSON.stringify(previewResourcePropPath(selection.prop)));
  if (!binding || selection.file && !binding.slot.sources.includes('public')) throw Error('preview.resource.slot_missing');
  return binding.slot;
}

export async function resolvePreviewResourceGrant(root: string, selection: PreviewResourceSelection, slot: ComponentResourceSlot,
  options: { signal?: AbortSignal; fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): Promise<Grant> {
  const env = options.env ?? process.env;
  const configuration = readCliConfiguration(resolve(env.PROMPTFRAME_CONFIG ?? join(homedir(), '.promptframe', 'component-authoring.json')));
  const credential = configuration.credential as Record<string, unknown> | undefined;
  const endpointValue = env.PROMPTFRAME_API_BASE ?? env.REMOTION_MEDIA_API_BASE ?? configuration.endpoint ?? credential?.endpoint;
  if (typeof endpointValue !== 'string') throw Error('preview.resource.endpoint_required');
  const endpoint = endpointValue.replace(/\/+$/, ''), url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !['/api', '/api-proxy'].includes(url.pathname)) throw Error('preview.resource.endpoint_invalid');
  const token = cliBearerToken({ endpoint, configuration,
    explicit: env.PROMPTFRAME_CI_TOKEN ?? env.PROMPTFRAME_CLI_TOKEN ?? env.PROMPTFRAME_AUTH_TOKEN });
  if (!token) throw Error('cli.auth.login_required');
  const context = readJson(join(root, '.promptframerc'));
  if (typeof context.projectId !== 'string' || !selection.reference || !selection.sessionId) throw Error('preview.resource.scope_required');
  if (typeof context.endpoint === 'string' && new URL(context.endpoint).origin !== url.origin) throw Error('preview.resource.endpoint_mismatch');
  const response = await (options.fetch ?? fetch)(endpoint + '/cli/component-assets/resolve', {
    method: 'POST', redirect: 'error', signal: options.signal ?? AbortSignal.timeout(5_000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: context.projectId, sessionId: selection.sessionId,
      references: [{ reference: selection.reference, slot }] }),
  });
  const bytes = await readBoundedResponse(response, 65_536);
  const body = JSON.parse(bytes.toString('utf8')) as { results?: Grant[]; code?: string };
  if (!response.ok || body.results?.length !== 1) throw Error(response.status === 401 || response.status === 403
    ? 'preview.resource.asset_permission_required' : 'preview.resource.unavailable');
  const grant = body.results[0]!;
  if (grant.reference !== selection.reference || grant.status !== 'ready' || !grant.url || !grant.sha256
    || !/^sha256:[a-f0-9]{64}$/u.test(grant.sha256) || !grant.contentType || !Number.isSafeInteger(grant.sizeBytes)
    || grant.sizeBytes! < 1 || grant.sizeBytes! > maximumBytes
    || !slot.kinds.some(kind => grant.contentType!.startsWith(kind + '/'))
    || slot.maxFileBytes !== undefined && grant.sizeBytes! > slot.maxFileBytes
    || slot.accept?.length && !slot.accept.some(type => type === '*/*' || type === grant.contentType
      || type.endsWith('/*') && grant.contentType!.startsWith(type.slice(0, -1)))
    || !grant.expiresAt || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= Date.now()) {
    throw Error('preview.resource.unavailable');
  }
  return grant;
}

async function readBoundedResponse(response: Response, max: number): Promise<Buffer> {
  if (!response.body) throw Error('preview.resource.unavailable');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > max) throw Error('preview.resource.response_budget'); chunks.push(value); }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** A Vite development adapter only. The runtime component bundle never imports
 * this module, the credential reader, local paths, or platform clients. */
export function promptFramePreviewResources(): Plugin {
  const secret = randomBytes(32), prefix = '/__promptframe/local-preview/';
  let root = '', server: ViteDevServer | undefined, active = 0;
  const controller = new AbortController(), pending = new Set<Promise<unknown>>();
  const capability = (row: PreviewResourceSelection) => createHash('sha256').update(secret).update(JSON.stringify(row)).digest('hex');
  const handle = async (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse,
    next: () => void) => {
    const path = (request.url ?? '').split('?')[0]!;
    if (!path.startsWith(prefix)) return next();
    const finish = (status: number, value: unknown) => { if (response.destroyed || response.headersSent) return; response.writeHead(status, { 'content-type': 'application/json',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value)); };
    if (request.method !== 'GET') return finish(405, { code: 'preview.resource.read_only' });
    const address = server?.httpServer?.address();
    const hosts = typeof address === 'object' && address ? new Set([`127.0.0.1:${address.port}`, `localhost:${address.port}`, `[::1]:${address.port}`]) : new Set<string>();
    const host = request.headers.host ?? '', origin = request.headers.origin;
    if (!hosts.has(host) || origin !== undefined && origin !== `http://${host}` || active >= 2) return finish(403, { code: 'preview.resource.origin_denied' });
    active++;
    const timer = setTimeout(() => response.destroy(), 15_000);
    try {
      const draft = readPreviewResourceDraft(root);
      const publicModels = publicModelRows(root);
      if (path === prefix + 'state') {
        const envelope = readJson(join(root, 'src/preview-props.json'));
        const props = structuredClone(envelope.props ?? {}) as Record<string, unknown>, issues: { prop?: string; code: string }[] = [];
        const models: PromptFrameModelRepresentation[] = [];
        for (const row of draft?.selections ?? []) {
          try {
            const slot = selectionSlot(root, row);
            let model: Pick<PromptFrameModelRepresentation, 'contentType' | 'sizeBytes' | 'sha256' | 'expiresAt'> | undefined;
            if (row.file) {
              const actual = capturePreviewResourceFile(row.file.path);
              if (JSON.stringify(actual) !== JSON.stringify(row.file) || !localFileMatches(slot, actual)) throw Error('preview.resource.file_changed');
              if (actual.contentType === 'model/gltf-binary') model = { contentType: actual.contentType, sizeBytes: actual.size, sha256: actual.sha256 };
            } else {
              const grant = await resolvePreviewResourceGrant(root, row, slot, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]) });
              if (grant.contentType === 'model/gltf-binary') model = { contentType: grant.contentType, sizeBytes: grant.sizeBytes!, sha256: grant.sha256!, expiresAt: grant.expiresAt };
            }
            const url = prefix + capability(row);
            setProp(props, row.prop, url);
            if (model) models.push({ ...model, reference: url, url });
          } catch (error) { issues.push({ prop: row.prop, code: safeCode(error) }); }
        }
        const packageModels = publicModels.map(row => ({
          reference: row.reference, aliases: [row.reference.slice(1)],
          url: prefix + capability(row.selection), contentType: 'model/gltf-binary',
          sizeBytes: row.selection.file!.size, sha256: row.selection.file!.sha256,
        }));
        return finish(200, { props: issues.length ? envelope.props ?? {} : props, issues,
          models: [...packageModels, ...(issues.length ? [] : models)],
          selectedCount: draft?.selections.length ?? 0, usingExample: issues.length > 0 });
      }
      const packageRow = publicModels.find(row => prefix + capability(row.selection) === path);
      const row = packageRow?.selection ?? draft?.selections.find(row => prefix + capability(row) === path);
      if (!row) return finish(404, { code: 'preview.resource.selection_changed' });
      const slot = packageRow ? undefined : selectionSlot(root, row); let bytes: Buffer, contentType: string;
      if (row.file) {
        const actual = capturePreviewResourceFile(row.file.path);
        if (JSON.stringify(actual) !== JSON.stringify(row.file) || slot && !localFileMatches(slot, actual)) throw Error('preview.resource.file_changed');
        bytes = readBoundedFile(row.file.path, maximumBytes, actual);
        if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== actual.sha256) throw Error('preview.resource.file_changed');
        contentType = actual.contentType;
      } else {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]);
        if (!slot) throw Error('preview.resource.slot_missing');
        const grant = await resolvePreviewResourceGrant(root, row, slot, { signal });
        if (grant.sizeBytes! > maximumBytes) throw Error('preview.resource.response_budget');
        const url = new URL(grant.url!); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('preview.resource.url_invalid');
        const result = await fetch(url, { signal, redirect: 'error' });
        if (!result.ok) throw Error('preview.resource.unavailable');
        bytes = await readBoundedResponse(result, maximumBytes);
        if (bytes.length !== grant.sizeBytes || 'sha256:' + createHash('sha256').update(bytes).digest('hex') !== grant.sha256) throw Error('preview.resource.bytes_changed');
        contentType = grant.contentType!;
      }
      if (contentType === 'model/gltf-binary') assertSelfContainedGlb(bytes, maximumBytes);
      response.writeHead(200, { 'content-type': contentType, 'content-length': bytes.length,
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(bytes);
    } catch (error) { finish(409, { code: safeCode(error) }); }
    finally {
      if (!response.writableFinished && !response.destroyed) await new Promise<void>(resolve => {
        response.once('finish', resolve); response.once('close', resolve);
      });
      clearTimeout(timer); active--;
    }
  };
  return {
    name: 'promptframe-preview-resources', apply: 'serve',
    configResolved(config) { root = realpathSync(resolve(config.root)); },
    resolveId(id) { return id === virtual ? resolvedVirtual : undefined; },
    load(id) { if (id !== resolvedVirtual) return; return localPreviewBrowserModule(prefix); },
    configureServer(value) {
      server = value;
      const host = value.config.server.host;
      if (host !== undefined && !['127.0.0.1', 'localhost', '::1'].includes(String(host))) throw Error('preview.resource.loopback_required');
      value.middlewares.use((req, res, next) => { const task = handle(req, res, next); pending.add(task); void task.catch(() => { if (!res.destroyed) res.destroy(); }).finally(() => pending.delete(task)); });
    },
    async closeBundle() { controller.abort(); await Promise.allSettled([...pending]); secret.fill(0); },
  };
}

function localPreviewBrowserModule(prefix: string): string {
  return [
    "import {createPromptFrameModelReader, readPromptFrameModelResponse, PROMPTFRAME_MODEL_READER, PromptFrameModelError} from '@promptframe/contracts';",
    'const hostFetch = globalThis.fetch.bind(globalThis);',
    "const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);",
    'const controller = new AbortController();',
    'const close = () => {controller.abort(); globalThis.removeEventListener?.("pagehide", close);};',
    'globalThis.addEventListener?.("pagehide", close, {once:true});',
    'if (import.meta.hot) import.meta.hot.dispose(close);',
    `const prefix = ${JSON.stringify(prefix)};`,
    `export const promptFrameLocalPreview = hostFetch(${JSON.stringify(prefix + 'state')}, {cache:"no-store", credentials:"omit", redirect:"error", signal:controller.signal})`,
    '.then(response => {if(!response.ok) throw Error("preview.resource.unavailable"); return response.json();})',
    '.then(value => {',
    '  if (!value.props) throw Error("preview.resource.unavailable");',
    '  const models = Object.freeze((value.models ?? []).map(row => {',
    '    if (typeof row.url !== "string" || !row.url.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(row.url.slice(prefix.length))) throw Error("preview.resource.unavailable");',
    '    return Object.freeze({reference:row.reference, url:row.url, sha256:row.sha256, contentType:row.contentType, sizeBytes:row.sizeBytes, expiresAt:row.expiresAt, aliases:Object.freeze([...(row.aliases ?? [])])});',
    '  }));',
    '  const binding = createPromptFrameModelReader({entries:models, signal:controller.signal,',
    '    read: async (entry, signal) => {',
    '      if (!entry.url.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(entry.url.slice(prefix.length))) throw new PromptFrameModelError("model.reference_unavailable");',
    '      return readPromptFrameModelResponse(await hostFetch(entry.url, {signal, credentials:"omit", redirect:"error"}), entry.sizeBytes, signal);',
    '    },',
    '    digest: async bytes => "sha256:" + Array.from(new Uint8Array(await digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2,"0")).join(""),',
    '  });',
    '  return {...value, models, modelResources:Object.freeze({contractVersion:"component-public-resources.v0.1.0", entries:[], [PROMPTFRAME_MODEL_READER]:binding.read})};',
    '}).catch(() => ({props:null, issues:[{code:"preview.resource.unavailable"}], usingExample:true}));',
  ].join('\n');
}
