/** Bounded, self-contained glTF 2 binary resources. No URL is ever loaded by
 * this validator. Textures and buffers must live in the GLB BIN chunk. */
export const PROMPTFRAME_MODEL_MIME = 'model/gltf-binary' as const;
export const PROMPTFRAME_MODEL_MAX_BYTES = 16 * 1024 * 1024;
export const PROMPTFRAME_MODEL_MAX_JSON_BYTES = 2 * 1024 * 1024;

export class PromptFrameModelError extends Error {
  constructor(readonly code: 'model.invalid_glb' | 'model.size_exceeded' | 'model.external_resource_rejected'
    | 'model.decoder_unsupported' | 'model.structure_budget_exceeded' | 'model.reader_unavailable'
    | 'model.reference_unavailable' | 'model.identity_mismatch' | 'model.read_cancelled' | 'model.read_busy') {
    super(code); this.name = 'PromptFrameModelError';
  }
}

export function assertSelfContainedGlb(bytes: Uint8Array, maxBytes = PROMPTFRAME_MODEL_MAX_BYTES): void {
  const fail = (): never => { throw new PromptFrameModelError('model.invalid_glb'); };
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > PROMPTFRAME_MODEL_MAX_BYTES
    || bytes.byteLength > maxBytes) throw new PromptFrameModelError('model.size_exceeded');
  if (bytes.byteLength < 20 || bytes.byteLength % 4) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) fail();
  const jsonLength = view.getUint32(12, true);
  if (jsonLength > PROMPTFRAME_MODEL_MAX_JSON_BYTES) throw new PromptFrameModelError('model.structure_budget_exceeded');
  if (!jsonLength || jsonLength % 4 || 20 + jsonLength > bytes.byteLength) fail();
  let document: Record<string, unknown>;
  try {
    document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength)));
  } catch { return fail(); }
  if (!record(document) || !record(document.asset) || document.asset.version !== '2.0'
    || document.asset.minVersion !== undefined && document.asset.minVersion !== '2.0') fail();
  let nodes = 0;
  const scan = (value: unknown, depth: number): void => {
    if (++nodes > 100_000 || depth > 32) throw new PromptFrameModelError('model.structure_budget_exceeded');
    if (Array.isArray(value)) { for (const child of value) scan(child, depth + 1); }
    else if (record(value)) for (const [key, child] of Object.entries(value)) {
      if (key === 'uri' || key === 'url') throw new PromptFrameModelError('model.external_resource_rejected');
      if (['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(key)) {
        throw new PromptFrameModelError('model.decoder_unsupported');
      }
      scan(child, depth + 1);
    }
  };
  scan(document, 0);
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    const extensions = document[key];
    if (extensions !== undefined && (!Array.isArray(extensions) || extensions.some(v => typeof v !== 'string'))) fail();
    if ((extensions as string[] | undefined)?.some(v => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(v))) {
      throw new PromptFrameModelError('model.decoder_unsupported');
    }
  }
  const binOffset = 20 + jsonLength;
  let binLength = 0;
  if (binOffset < bytes.byteLength) {
    if (binOffset + 8 > bytes.byteLength || view.getUint32(binOffset + 4, true) !== 0x004e4942) fail();
    binLength = view.getUint32(binOffset, true);
    if (binLength % 4 || binOffset + 8 + binLength !== bytes.byteLength) fail();
  }
  const buffers = document.buffers ?? [];
  if (!Array.isArray(buffers) || buffers.length > 1) fail();
  const buffer = (buffers as unknown[])[0];
  if (buffer !== undefined && (!record(buffer) || !integer(buffer.byteLength) || buffer.byteLength > binLength
    || binLength - buffer.byteLength > 3)) fail();
  if (binLength && !buffer) fail();
  const views = document.bufferViews ?? [];
  if (!Array.isArray(views)) fail();
  for (const item of views as unknown[]) {
    if (!record(item) || item.buffer !== 0 || !integer(item.byteLength) || !integer(item.byteOffset ?? 0)
      || !record(buffer) || (item.byteOffset as number ?? 0) + (item.byteLength as number) > (buffer.byteLength as number)
      || item.byteStride !== undefined && (!integer(item.byteStride) || item.byteStride < 4 || item.byteStride > 252 || item.byteStride % 4)) fail();
  }
  const images = document.images ?? [];
  if (!Array.isArray(images)) fail();
  for (const image of images as unknown[]) {
    if (!record(image) || !integer(image.bufferView) || !(views as unknown[])[image.bufferView as number]
      || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType as string)) fail();
  }
  const accessors = document.accessors ?? [];
  if (!Array.isArray(accessors)) fail();
  for (const accessor of accessors as unknown[]) {
    if (!record(accessor) || !integer(accessor.count) || accessor.count > 4_000_000
      || accessor.sparse !== undefined || !integer(accessor.bufferView) || !(views as unknown[])[accessor.bufferView as number]) fail();
  }
  const sceneNodes = document.nodes ?? [];
  if (!Array.isArray(sceneNodes) || sceneNodes.length > 5_000) throw new PromptFrameModelError('model.structure_budget_exceeded');
  const colors = new Map<number, number>();
  const visit = (index: number, depth: number): void => {
    if (!integer(index) || !record((sceneNodes as unknown[])[index]) || colors.get(index) === 1) fail();
    if (depth > 128) throw new PromptFrameModelError('model.structure_budget_exceeded');
    if (colors.get(index) === 2) return;
    colors.set(index, 1);
    const children = ((sceneNodes as Record<string, unknown>[])[index]!).children ?? [];
    if (!Array.isArray(children)) fail();
    for (const child of children as number[]) visit(child, depth + 1);
    colors.set(index, 2);
  };
  for (let i = 0; i < (sceneNodes as unknown[]).length; i++) visit(i, 0);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A per-component host binding. The transport is supplied by the host, never
 * taken from component props. Importing this contract alone grants no IO. */
export const PROMPTFRAME_MODEL_READER = Symbol.for('promptframe.model.reader.v1');
export interface PromptFrameModelReadOptions { signal?: AbortSignal }
export type PromptFrameModelReader = (reference: string, options?: PromptFrameModelReadOptions) => Promise<ArrayBuffer>;
export interface PromptFrameModelRepresentation {
  reference: string; url: string; sha256: string; sizeBytes: number; contentType: string; expiresAt?: string;
  aliases?: readonly string[];
}

export function createPromptFrameModelReader(input: {
  entries: readonly PromptFrameModelRepresentation[] | (() => readonly PromptFrameModelRepresentation[]);
  read: (entry: Readonly<PromptFrameModelRepresentation>, signal: AbortSignal) => Promise<Uint8Array>;
  digest: (bytes: Uint8Array) => Promise<string>;
  signal?: AbortSignal;
}): { read: PromptFrameModelReader; dispose(): void } {
  const scope = new AbortController();
  let active = 0;
  const snapshot = typeof input.entries === 'function' ? input.entries
    : (() => input.entries as readonly PromptFrameModelRepresentation[]);
  const stillAuthorized = (entry: Readonly<PromptFrameModelRepresentation>): boolean => {
    // The host can renew a grant while its original read is in flight. Read
    // the current authoritative entries; never extend a captured deadline or
    // treat a changed URL alone as a new content identity.
    const matches = snapshot().filter(row => row.reference === entry.reference);
    const current = matches.length === 1 ? matches[0] : undefined;
    if (!current || current.sha256 !== entry.sha256 || current.sizeBytes !== entry.sizeBytes
      || current.contentType !== entry.contentType) return false;
    if (entry.expiresAt !== undefined && current.expiresAt === undefined) return false;
    return current.expiresAt === undefined
      || Number.isFinite(Date.parse(current.expiresAt)) && Date.parse(current.expiresAt) > Date.now();
  };
  const dispose = () => scope.abort();
  input.signal?.addEventListener('abort', dispose, { once: true });
  if (input.signal?.aborted) dispose();
  return {
    dispose() { dispose(); input.signal?.removeEventListener('abort', dispose); },
    async read(reference, options = {}) {
      if (scope.signal.aborted || options.signal?.aborted) throw new PromptFrameModelError('model.read_cancelled');
      const matches = snapshot().filter(row => row.reference === reference || row.url === reference || row.aliases?.includes(reference));
      const entry = matches.length === 1 ? Object.freeze({ ...matches[0]! }) : undefined;
      if (!entry || entry.contentType !== PROMPTFRAME_MODEL_MIME || !/^sha256:[a-f0-9]{64}$/.test(entry.sha256)
        || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes <= 0 || entry.sizeBytes > PROMPTFRAME_MODEL_MAX_BYTES
        || entry.expiresAt !== undefined && (!Number.isFinite(Date.parse(entry.expiresAt)) || Date.parse(entry.expiresAt) <= Date.now())) {
        throw new PromptFrameModelError('model.reference_unavailable');
      }
      if (active >= 2) throw new PromptFrameModelError('model.read_busy');
      const controller = new AbortController(), abort = () => controller.abort();
      scope.signal.addEventListener('abort', abort, { once: true });
      options.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 15_000);
      active++;
      try {
        const bytes = await input.read(entry, controller.signal);
        if (controller.signal.aborted || !stillAuthorized(entry)) {
          throw new PromptFrameModelError('model.read_cancelled');
        }
        if (bytes.byteLength !== entry.sizeBytes || await input.digest(bytes) !== entry.sha256) {
          throw new PromptFrameModelError('model.identity_mismatch');
        }
        if (controller.signal.aborted || !stillAuthorized(entry)) throw new PromptFrameModelError('model.read_cancelled');
        assertSelfContainedGlb(bytes, entry.sizeBytes);
        // Node Buffer.slice() retains its pooled backing ArrayBuffer. Copy as
        // a plain typed array so the result exposes exactly the verified GLB.
        return new Uint8Array(bytes).buffer as ArrayBuffer;
      } finally {
        active--; clearTimeout(timer); scope.signal.removeEventListener('abort', abort);
        options.signal?.removeEventListener('abort', abort);
      }
    },
  };
}

/** Consumes the host's already selected response without issuing a request.
 * The exact-length cap is enforced while streaming, before aggregation. */
export async function readPromptFrameModelResponse(response: Response, expectedBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.ok || !response.body || response.redirected || !Number.isSafeInteger(expectedBytes)
    || expectedBytes <= 0 || expectedBytes > PROMPTFRAME_MODEL_MAX_BYTES) {
    await response.body?.cancel().catch(() => {}); throw new PromptFrameModelError('model.reference_unavailable');
  }
  const size = response.headers.get('content-length');
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (size !== null && (!/^\d+$/.test(size) || Number(size) !== expectedBytes)
    || mime && ![PROMPTFRAME_MODEL_MIME, 'application/octet-stream'].includes(mime)) {
    await response.body.cancel(); throw new PromptFrameModelError('model.identity_mismatch');
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new PromptFrameModelError('model.read_cancelled');
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > expectedBytes) throw new PromptFrameModelError('model.size_exceeded');
      chunks.push(next.value);
    }
    if (signal.aborted) throw new PromptFrameModelError('model.read_cancelled');
    if (length !== expectedBytes) throw new PromptFrameModelError('model.identity_mismatch');
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** GLB reuses the existing document object lifecycle; selection exposes the
 * semantic model slot only for that exact MIME, never for arbitrary binary. */
export function componentResourceKindForAsset(kind: string, mime: string): string | undefined {
  const type = mime.split(';')[0]!.trim().toLowerCase();
  if ((kind === 'document' || kind === 'data') && type === PROMPTFRAME_MODEL_MIME) return 'model';
  return ['image', 'audio', 'video'].includes(kind) && type.startsWith(kind + '/') ? kind : undefined;
}
