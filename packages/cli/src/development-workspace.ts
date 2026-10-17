import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, opendirSync, realpathSync } from 'node:fs';
import { createServer as createHttpServer, type ServerResponse } from 'node:http';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { buildDevelopmentContents } from './development-build.js';
import { DevelopmentModuleCoordinator } from './development-coordinator.js';
import { captureDevelopmentFiles } from './development-files.js';
import { DevelopmentContents } from './development-revisions.js';

const excluded = new Set(['node_modules', 'dist', '.git', '.component-packages', '.promptframe']);
const limits = { maximumFiles: 2048, maximumBytes: 16 * 1024 * 1024 };
const lockfiles = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
export interface DevelopmentWorkspaceModule { id: string; path: string }

/** One capture includes the module and its real shared pnpm lock bytes. Source
 * aliases/parent imports remain explicitly unsupported by the common policy. */
export function captureDevelopmentModule(root: string, module: DevelopmentWorkspaceModule): DevelopmentContents {
  if (!module.path || module.path.includes('\\') || posix.isAbsolute(module.path)
    || /^[A-Za-z]:/u.test(module.path)
    || posix.normalize(module.path) !== module.path || module.path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('development.workspace.invalid_path');
  }
  const base = realpathSync(root), directory = resolve(base, module.path);
  for (let path = directory; path !== base; path = dirname(path)) {
    if (lstatSync(path).isSymbolicLink()) throw new Error('development.capture.symlink');
  }
  const names: string[] = [];
  let entries = 0;
  const walk = (directory: string, prefix: string, depth: number): void => {
    if (depth > 32) throw new Error('development.capture.directory_limit');
    const handle = opendirSync(directory);
    try {
      for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
        if (++entries > 8192) throw new Error('development.capture.directory_limit');
        if (excluded.has(entry.name)) continue;
        const path = join(directory, entry.name), name = prefix + entry.name;
        if (entry.isSymbolicLink()) throw new Error('development.capture.symlink');
        if (entry.isDirectory()) walk(path, name + '/', depth + 1);
        else if (entry.isFile()) {
          names.push(name);
          if (names.length > limits.maximumFiles) throw new Error('development.contents.file_count');
        } else throw new Error('development.capture.not_file');
      }
    } finally { handle.closeSync(); }
  };
  walk(directory, '', 0);
  const sharedLock = !lockfiles.some(name => names.includes(name))
    && existsSync(join(base, 'pnpm-workspace.yaml')) && existsSync(join(base, 'pnpm-lock.yaml'));
  const prefix = module.path + '/';
  const paths = names.map(name => prefix + name);
  if (sharedLock) paths.push('pnpm-workspace.yaml', 'pnpm-lock.yaml');
  paths.push('promptframe-workspace.json');
  const captured = captureDevelopmentFiles(base, paths, limits);
  const normalized = new DevelopmentContents(captured.readFiles().map(file => ({
    path: file.path.startsWith(prefix) ? file.path.slice(prefix.length)
      : file.path === 'promptframe-workspace.json' ? 'promptframe-workspace.captured.json' : file.path,
    bytes: file.bytes,
  })), limits);
  const manifest = normalized.readFiles().find(file => file.path === 'manifest.json');
  if (!manifest || JSON.parse(Buffer.from(manifest.bytes).toString()).id !== module.id) {
    throw new Error('development.workspace.manifest_id_mismatch');
  }
  const declaration = normalized.readFiles().find(file => file.path === 'promptframe-workspace.captured.json')!;
  const workspace = JSON.parse(Buffer.from(declaration.bytes).toString()) as {
    schemaVersion?: string; components?: DevelopmentWorkspaceModule[];
  };
  if (workspace.schemaVersion !== 'promptframe-workspace.v0.1.0' || !Array.isArray(workspace.components)
    || !workspace.components.some(entry => entry?.id === module.id && entry.path === module.path)) {
    throw new Error('development.workspace.declaration_changed');
  }
  return normalized;
}

/** A single root Vite watcher plus a closed HTTP surface. Vite's raw-source,
 * HTML, /@fs, HMR and plugin/config serving middleware is never attached. */
export async function startDevelopmentWorkspace(options: {
  root: string; modules: readonly DevelopmentWorkspaceModule[]; studioOrigin: string;
  host?: '127.0.0.1' | '::1'; port?: number;
}) {
  const root = realpathSync(options.root), origin = new URL(options.studioOrigin);
  const host = options.host ?? '127.0.0.1', port = options.port ?? 0;
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash || origin.origin === 'null') {
    throw new Error('development.connection.invalid_origin');
  }
  if (!['127.0.0.1', '::1'].includes(host) || !Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error('development.connection.invalid_address');
  }
  if (!options.modules.length || options.modules.length > 32) throw new Error('development.registry.module_limit');
  const modules = new Map(options.modules.map(module => [module.id, Object.freeze({ ...module })]));
  for (const module of modules.values()) {
    if (typeof module.id !== 'string' || !module.id.trim() || module.id.length > 256 || /[\u0000-\u001f]/u.test(module.id)) {
      throw new Error('development.module.invalid_identity');
    }
  }
  if (modules.size !== options.modules.length || new Set([...modules.values()].map(module => module.path)).size !== modules.size) {
    throw new Error('development.registry.duplicate_module');
  }
  const credential = randomBytes(32).toString('hex'), connectionId = randomBytes(16).toString('hex');
  const expiresAt = Date.now() + 10 * 60_000;
  const controller = new AbortController(), listeners = new Set<ServerResponse>();
  const pending = new Set<string>(), resident = new Map<string, number>();
  let pumping: Promise<void> | undefined, checkingId: string | undefined;
  let closed = false, expectedHost = '', responseBytes = 0, watcherDiagnostic: string | undefined;
  const coordinator = new DevelopmentModuleCoordinator({ maximumModules: 32,
    capture(id) {
      const module = modules.get(id);
      if (!module) throw new Error('development.workspace.module_missing');
      return captureDevelopmentModule(root, module);
    },
    async build(source, compilerOptions) {
      const built = await buildDevelopmentContents(source, compilerOptions);
      // Include the old checked output while a replacement is still pending.
      if ([...resident.values()].reduce((a, b) => a + b, 0) + built.artifacts.byteLength > 64 * 1024 * 1024) {
        throw new Error('development.workspace.artifact_budget');
      }
      return built;
    },
  });
  const registry = () => ({ contractVersion: 'promptframe-development.v1', connectionId,
    expiresAt: new Date(expiresAt).toISOString(), watcherDiagnostic, modules: [...modules.keys()].map(id => {
      const state = coordinator.state(id), receipt = coordinator.buildReceipt(id);
      const checking = pending.has(id) || checkingId === id;
      return { moduleId: id, status: checking ? 'checking' : state?.status ?? 'checking',
        sourceRevision: !checking || state?.status === 'checking' ? state?.sourceRevision : undefined,
        diagnostic: state?.diagnostic, ...(state?.lastChecked && receipt ? { lastChecked: {
          sourceRevision: state.lastChecked.sourceRevision, artifactRevision: receipt.artifacts.revision,
          checkerKey: state.lastChecked.checkerKey, entries: receipt.entries, runtimeImports: receipt.runtimeImports,
        } } : {}) };
    }) });
  const notify = () => {
    const data = `event: registry\ndata: ${JSON.stringify(registry())}\n\n`;
    for (const listener of listeners) {
      try { if (!listener.write(data)) listener.destroy(); } catch { listener.destroy(); }
    }
  };
  const enqueue = (id: string) => {
    if (closed || Date.now() >= expiresAt || !modules.has(id)) return;
    pending.add(id);
    if (pumping) return;
    // One compiler at a time; a failing module never removes another's output.
    pumping = Promise.resolve().then(async () => {
      while (pending.size && !closed) {
        const id = pending.values().next().value!; pending.delete(id);
        checkingId = id;
        const job = coordinator.refresh(id, { signal: controller.signal });
        notify();
        if (await job) resident.set(id, coordinator.buildReceipt(id)!.artifacts.byteLength);
        checkingId = undefined;
        notify();
      }
    }).finally(() => { pumping = undefined; });
  };
  // Explicit reads recapture too. Watch delivery/debounce is never authority.
  const observe = (onlyId?: string) => {
    const revisions = new Map<string, string>();
    for (const [id, module] of modules) {
      if (onlyId && onlyId !== id) continue;
      try {
        const current = captureDevelopmentModule(root, module), state = coordinator.state(id);
        revisions.set(id, current.revision);
        if (state?.sourceRevision !== current.revision) enqueue(id);
      } catch {
        const state = coordinator.state(id);
        if (state?.status !== 'failed' || state.sourceRevision !== undefined) enqueue(id);
      }
    }
    return revisions;
  };
  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(body));
  };
  const http = createHttpServer((request, response) => {
    const reject = (status: number, code: string) => {
      response.setHeader('Connection', 'close'); json(response, status, { success: false, code });
    };
    if (request.headers.host !== expectedHost) return reject(403, 'development.connection.host_rejected');
    if (request.headers.origin !== origin.origin) return reject(403, 'development.connection.origin_rejected');
    response.setHeader('Access-Control-Allow-Origin', origin.origin); response.setHeader('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      if (request.headers['access-control-request-method'] !== 'GET'
        || (request.headers['access-control-request-headers'] ?? '').toString().toLowerCase().split(',').some(header => header.trim() !== 'authorization')) {
        return reject(403, 'development.connection.preflight_rejected');
      }
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '60' });
      return response.end();
    }
    if (request.method !== 'GET') return reject(405, 'development.connection.read_only');
    if (Date.now() >= expiresAt) return reject(401, 'development.connection.expired');
    const bearer = request.headers.authorization;
    if (typeof bearer !== 'string' || !/^Bearer [a-f0-9]{64}$/u.test(bearer)
      || !timingSafeEqual(Buffer.from(bearer), Buffer.from('Bearer ' + credential))) {
      return reject(401, 'development.connection.credential_rejected');
    }
    if (!request.url?.startsWith('/') || request.url.startsWith('//') || request.url.includes('?')) {
      return reject(400, 'development.connection.invalid_path');
    }
    if (request.url === '/__promptframe/registry') { observe(); return json(response, 200, registry()); }
    if (request.url === '/__promptframe/events') {
      if (listeners.size >= 8) return reject(503, 'development.connection.observer_limit');
      observe();
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      listeners.add(response); response.on('close', () => listeners.delete(response));
      response.on('error', () => response.destroy());
      response.write(`event: registry\ndata: ${JSON.stringify(registry())}\n\n`); return;
    }
    const match = /^\/__promptframe\/modules\/([^/]+)\/bundle\/([a-f0-9]{64})$/u.exec(request.url);
    if (!match) return reject(404, 'development.connection.route_missing');
    let id: string;
    try { id = decodeURIComponent(match[1]!); } catch { return reject(400, 'development.connection.invalid_path'); }
    if (!modules.has(id)) return reject(404, 'development.workspace.module_missing');
    const revisions = observe(id);
    const state = coordinator.state(id), receipt = coordinator.buildReceipt(id);
    if (!state?.lastChecked || !receipt || revisions.get(id) !== receipt.sourceRevision
      || receipt.artifacts.revision !== 'sha256:' + match[2]) {
      return reject(409, 'development.workspace.bundle_not_current');
    }
    const reservation = receipt.artifacts.byteLength * 5 + 4 * 1024 * 1024;
    if (responseBytes + reservation > 48 * 1024 * 1024) return reject(503, 'development.connection.response_budget');
    responseBytes += reservation;
    let released = false;
    const release = () => { if (!released) { released = true; responseBytes -= reservation; } };
    response.once('finish', release); response.once('close', release);
    try {
      // A single exact bundle contains all chunks/resources: no live source or
      // credential is passed into component ESM. The consumer still isolates it.
      json(response, 200, { connectionId, moduleId: id, sourceRevision: receipt.sourceRevision,
        artifactRevision: receipt.artifacts.revision, entries: receipt.entries, runtimeImports: receipt.runtimeImports,
        files: receipt.artifacts.readFiles().map(file => ({ path: file.path, base64: Buffer.from(file.bytes).toString('base64') })) });
    } catch { response.destroy(); }
  });
  http.maxConnections = 64; http.headersTimeout = 5000; http.requestTimeout = 5000; http.keepAliveTimeout = 3000;
  http.on('upgrade', (_request, socket) => socket.destroy());
  const vite = await createViteServer({ root, configFile: false, envFile: false, publicDir: false,
    mode: 'development', appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false,
      watch: { followSymlinks: false, ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.promptframe/**', '**/.component-packages/**'] } },
  });
  const changed = (_event: string, path: string) => {
    const local = relative(root, resolve(path)).split(sep).join('/');
    for (const [id, module] of modules) {
      if (local === module.path || local.startsWith(module.path + '/') || local === 'pnpm-lock.yaml'
        || local === 'package.json' || local === 'pnpm-workspace.yaml' || local === 'promptframe-workspace.json') enqueue(id);
    }
  };
  vite.watcher.on('all', changed);
  vite.watcher.on('error', () => { watcherDiagnostic = 'development.workspace.watch_failed'; notify(); });
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject); http.listen(port, host, () => { http.removeListener('error', reject); resolve(); });
    });
  } catch (error) { await vite.close(); throw error; }
  const address = http.address();
  if (!address || typeof address === 'string') { await vite.close(); http.close(); throw new Error('development.connection.no_address'); }
  expectedHost = `${host === '::1' ? '[::1]' : host}:${address.port}`;
  for (const id of modules.keys()) enqueue(id);
  const expiry = setTimeout(() => {
    controller.abort(new Error('development.connection.expired')); pending.clear();
    for (const response of listeners) { response.write('event: expired\ndata: {"code":"development.connection.expired"}\n\n'); response.end(); }
    listeners.clear();
  }, expiresAt - Date.now());
  expiry.unref();
  let closePromise: Promise<void> | undefined;
  return Object.freeze({ connectionId, url: `http://${expectedHost}`, studioOrigin: origin.origin,
    credential, expiresAt: new Date(expiresAt).toISOString(),
    close() {
      return closePromise ??= (async () => {
        closed = true; clearTimeout(expiry); controller.abort(new Error('development.workspace.closed'));
        pending.clear(); for (const response of listeners) response.end(); listeners.clear();
        const httpClosed = new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
        http.closeAllConnections(); await pumping; await vite.close(); await httpClosed;
      })();
    },
  });
}
