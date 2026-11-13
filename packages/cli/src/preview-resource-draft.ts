import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { parsePromptFrameAssetReference } from '@promptframe/contracts';

export const PREVIEW_RESOURCE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const PREVIEW_RESOURCE_FILE_BYTES = 16 * 1024 * 1024;
export interface PreviewResourceFile { path: string; dev: number; ino: number; size: number; mtimeMs: number; sha256: string; contentType: string }
export interface PreviewResourceSelection { prop: string; reference?: string; sessionId?: string; file?: PreviewResourceFile }
export interface PreviewResourceDraft { contractVersion: 'promptframe-local-resource-draft/v1'; updatedAt: string; selections: PreviewResourceSelection[] }

export function previewResourceDraftPath(root: string): string { return join(root, '.promptframe', 'local-previews', 'resources.json'); }

/** Managed draft parents must be real directories, including for reads/clear. */
export function assertPreviewResourceDirectory(root: string): boolean {
  for (const part of [join(root, '.promptframe'), join(root, '.promptframe', 'local-previews')]) {
    try { if (!lstatSync(part).isDirectory()) throw Error('preview.resource.draft_invalid'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw Error('preview.resource.draft_invalid'); }
  }
  return true;
}

export function clearPreviewResourceDraft(root: string): void {
  if (!assertPreviewResourceDirectory(root)) return;
  const path = previewResourceDraftPath(root); let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw Error('preview.resource.draft_invalid'); }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65_536 || JSON.parse(readFileSync(fd, 'utf8')).contractVersion !== 'promptframe-local-resource-draft/v1')
      throw Error('preview.resource.draft_invalid');
    const current = lstatSync(path);
    if (current.dev !== stat.dev || current.ino !== stat.ino) throw Error('preview.resource.draft_invalid');
    rmSync(path);
  } finally { closeSync(fd); }
}

export function readPreviewResourceDraft(root: string, now = Date.now()): PreviewResourceDraft | undefined {
  const file = previewResourceDraftPath(root);
  if (!assertPreviewResourceDirectory(root)) return undefined;
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw Error('preview.resource.draft_invalid'); }
  try {
    const stat = fstatSync(fd); if (!stat.isFile() || stat.size > 65_536) throw Error();
    const draft = JSON.parse(readFileSync(fd, 'utf8')) as PreviewResourceDraft;
    if (draft.contractVersion !== 'promptframe-local-resource-draft/v1' || !Number.isFinite(Date.parse(draft.updatedAt))
      || now < Date.parse(draft.updatedAt) || now - Date.parse(draft.updatedAt) >= PREVIEW_RESOURCE_DRAFT_TTL_MS
      || !Array.isArray(draft.selections) || draft.selections.length > 16) throw Error();
    for (const row of draft.selections) {
      previewResourcePropPath(row.prop);
      if (!!row.reference === !!row.file) throw Error();
      if (row.reference && (!parsePromptFrameAssetReference(row.reference) || !row.sessionId || row.sessionId.length > 160)) throw Error();
      if (row.file && (typeof row.file.path !== 'string' || !isAbsolute(row.file.path) || !/^sha256:[a-f0-9]{64}$/u.test(row.file.sha256)
        || !['image/png', 'image/jpeg', 'image/webp'].includes(row.file.contentType)
        || !Number.isSafeInteger(row.file.ino) || !Number.isSafeInteger(row.file.dev) || !Number.isFinite(row.file.mtimeMs)
        || !Number.isSafeInteger(row.file.size) || row.file.size < 1 || row.file.size > PREVIEW_RESOURCE_FILE_BYTES)) throw Error();
    }
    if (new Set(draft.selections.map(row => row.prop)).size !== draft.selections.length) throw Error();
    return draft;
  } catch { throw Error('preview.resource.draft_invalid_or_expired'); }
  finally { closeSync(fd); }
}

export function previewResourcePropPath(pointer: string): (string | number)[] {
  if (!pointer.startsWith('/') || pointer.length > 500) throw Error('preview.resource.prop_invalid');
  const keys = pointer.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (!keys.length || keys.length > 8 || keys.some(key => !key || ['__proto__', 'prototype', 'constructor'].includes(key))) throw Error('preview.resource.prop_invalid');
  return keys.map(key => /^(?:0|[1-9][0-9]*)$/u.test(key) ? Number(key) : key);
}

export function capturePreviewResourceFile(file: string): PreviewResourceFile {
  const path = resolve(file), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd); if (!stat.isFile() || stat.size < 1 || stat.size > PREVIEW_RESOURCE_FILE_BYTES) throw Error('preview.resource.file_budget');
    const contentType = new Map([['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp']]).get(extname(path).toLowerCase());
    if (!contentType) throw Error('preview.resource.file_type');
    const buffer = Buffer.alloc(65_536), hash = createHash('sha256'); let total = 0, first = true;
    while (true) {
      const count = readSync(fd, buffer); if (!count) break; total += count;
      if (total > PREVIEW_RESOURCE_FILE_BYTES) throw Error('preview.resource.file_budget');
      if (first) {
        first = false;
        if (contentType === 'image/png' && !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          || contentType === 'image/jpeg' && !(buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
          || contentType === 'image/webp' && !(buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')) throw Error('preview.resource.file_type');
      }
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(fd);
    if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ino !== stat.ino || after.dev !== stat.dev) throw Error('preview.resource.file_changed');
    return { path, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs,
      sha256: 'sha256:' + hash.digest('hex'), contentType };
  } finally { closeSync(fd); }
}

export function writePreviewResourceSelection(root: string, selection: PreviewResourceSelection): void {
  previewResourcePropPath(selection.prop);
  if (selection.reference && (!parsePromptFrameAssetReference(selection.reference) || !selection.sessionId)) throw Error('preview.resource.reference_invalid');
  if (!!selection.reference === !!selection.file) throw Error('preview.resource.selection_invalid');
  const path = previewResourceDraftPath(root), directory = dirname(path);
  for (const part of [join(root, '.promptframe'), directory]) {
    mkdirSync(part, { recursive: true, mode: 0o700 }); if (lstatSync(part).isSymbolicLink()) throw Error('preview.resource.draft_invalid');
  }
  let previous: PreviewResourceDraft | undefined;
  try { previous = readPreviewResourceDraft(root); } catch { throw Error('preview.resource.draft_invalid_or_expired'); }
  const selections = [...(previous?.selections ?? []).filter(row => row.prop !== selection.prop), selection];
  if (selections.length > 16) throw Error('preview.resource.draft_budget');
  const draft: PreviewResourceDraft = { contractVersion: 'promptframe-local-resource-draft/v1', updatedAt: new Date().toISOString(), selections };
  const temporary = path + '.' + process.pid + '.tmp'; let fd: number | undefined;
  try {
    fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, JSON.stringify(draft, null, 2) + '\n'); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path); const parent = openSync(directory, constants.O_RDONLY); try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
}
