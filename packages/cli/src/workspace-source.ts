import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { PROMPTFRAME_PUBLIC_STANDARD_POLICY } from '@promptframe/contracts';
import { COMPONENT_SOURCE_LAYOUT_FILE, COMPONENT_SOURCE_LAYOUT_VERSION, componentSourceWorkspaceSchema, componentSourceLayoutSchema, readComponentSourceLayout, type ComponentSourceLayout, type ComponentSourceWorkspace } from '@promptframe/contracts/source-layout';
import { collectComponentSourceGraph, validateComponentSourceLayoutFiles } from '@promptframe/contracts/source-layout-evaluator';
import { captureDevelopmentFiles } from './development-files.js';
import { isComponentSourcePathIgnored, selectComponentSourceFiles } from './component-file-selection.js';
import {capturePnpmWorkspaceLock} from './workspace-lockfile.js';
const limits = { maximumFiles: 2048, maximumBytes: 16 * 1024 * 1024 };
const lockNames = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const contexts = new Map<string, {
    root: string;
    module: {
        id: string;
        path: string;
    };
    snapshotDigest?: string;
}>();
export class WorkspaceSourceError extends Error {
    constructor(readonly code: string) { super(code); }
}
const sha = (bytes: Uint8Array) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => Buffer.from(JSON.stringify(value) + '\n');
export function validComponentLockEvidence(packageBytes: Uint8Array, evidence: Uint8Array | undefined): boolean {
    if (!evidence || evidence.byteLength > 16 * 1024)
        return false;
    try {
        const value = JSON.parse(Buffer.from(evidence).toString('utf8'));
        return Object.keys(value).sort().join(',') === 'lockfiles,packageJsonSha256,schemaVersion'
            && value.schemaVersion === 'promptframe.lockfile-evidence.v0.1.0' && value.packageJsonSha256 === sha(packageBytes)
            && Array.isArray(value.lockfiles) && value.lockfiles.length > 0 && value.lockfiles.length <= lockNames.length
            && value.lockfiles.every((lock: Record<string, unknown>) => Object.keys(lock).sort().join(',') === 'fileName,relativePath,sha256,sizeBytes,source'
                && lockNames.includes(String(lock.fileName)) && ['component', 'workspace_root'].includes(String(lock.source))
                && typeof lock.relativePath === 'string' && /^(?:\.\.\/)*(?:[A-Za-z0-9_.-]+\/)*(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/u.test(lock.relativePath)
                && typeof lock.sha256 === 'string' && /^sha256:[a-f0-9]{64}$/u.test(lock.sha256)
                && Number.isSafeInteger(lock.sizeBytes) && Number(lock.sizeBytes) > 0 && Number(lock.sizeBytes) <= limits.maximumBytes);
    }
    catch {
        return false;
    }
}
/** Opt-in is explicit in the workspace declaration. A path-explicit ordinary
 * component command never discovers or expands an ancestor workspace. */
export function registerComponentSourceWorkspace(root: string, workspace: ComponentSourceWorkspace): void {
    if (workspace.sharedDirectories === undefined)
        return;
    const base = realpathSync(root);
    for (const module of workspace.components) {
        const key = resolve(base, module.path), previous = contexts.get(key);
        if (previous?.root === base && previous.module.id === module.id && previous.module.path === module.path)
            continue;
        contexts.set(key, { root: base, module });
    }
}
export function componentSourceWorkspaceContext(directory: string) { return contexts.get(resolve(directory)); }
export function captureRegisteredComponentSource(directory: string): Array<{
    name: string;
    data: Buffer;
}> | undefined {
    const context = componentSourceWorkspaceContext(directory);
    if (!context)
        return undefined;
    const current = captureComponentWorkspaceSource(context.root, context.module);
    // Retain only a digest while a workspace command prepares several modules;
    // the per-module archive bytes must not accumulate in the process registry.
    const currentDigest = sha(json(current.map(file => ({ name: file.name, sizeBytes: file.data.byteLength, sha256: sha(file.data) }))));
    if (context.snapshotDigest && currentDigest !== context.snapshotDigest)
        throw new WorkspaceSourceError('workspace.source.changed_during_operation');
    context.snapshotDigest ??= currentDigest;
    return current;
}
export function readSharedSourceWorkspace(root: string): ComponentSourceWorkspace | undefined {
    const file = captureDevelopmentFiles(root, ['promptframe-workspace.json'], limits).readFiles()[0]!;
    const input = JSON.parse(Buffer.from(file.bytes).toString('utf8'));
    if (!Object.hasOwn(input, 'sharedDirectories'))
        return undefined;
    return componentSourceWorkspaceSchema.parse(input);
}
export function capturedComponentSourceModule(root: string): {
    id: string;
    path: string;
} | undefined {
    if (!existsSync(join(root, COMPONENT_SOURCE_LAYOUT_FILE)))
        return undefined;
    const initial = captureDevelopmentFiles(root, [COMPONENT_SOURCE_LAYOUT_FILE, 'promptframe-workspace.json'], limits).readFiles();
    const layout = componentSourceLayoutSchema.parse(JSON.parse(Buffer.from(initial.find(file => file.path === COMPONENT_SOURCE_LAYOUT_FILE)!.bytes).toString('utf8')));
    const manifest = captureDevelopmentFiles(root, [layout.componentPath + '/manifest.json'], limits).readFiles()[0]!;
    readComponentSourceLayout([...initial, manifest]);
    const workspace = readSharedSourceWorkspace(root);
    if (!workspace)
        throw new WorkspaceSourceError('workspace.source.layout_mismatch');
    registerComponentSourceWorkspace(root, workspace);
    return { id: layout.componentId, path: layout.componentPath };
}
export function captureComponentWorkspaceSource(root: string, module: {
    id: string;
    path: string;
}, budget = { maximumFiles: 2048, maximumBytes: 50 * 1024 * 1024 }): Array<{
    name: string;
    data: Buffer;
}> {
    try {
        return capture(root, module, budget);
    }
    catch (error) {
        if (error instanceof WorkspaceSourceError)
            throw error;
        const code = error instanceof Error && /^(?:workspace\.source\.|workspace\.lockfile\.|development\.capture\.|development\.contents\.|package\.required_file\.)[a-z_]+$/u.test(error.message)
            ? error.message : 'workspace.source.capture_failed';
        throw new WorkspaceSourceError(code);
    }
}
function capture(root: string, module: {
    id: string;
    path: string;
}, budget: {
    maximumFiles: number;
    maximumBytes: number;
}): Array<{
    name: string;
    data: Buffer;
}> {
    const base = realpathSync(root), configCapture = captureDevelopmentFiles(base, ['promptframe-workspace.json'], limits), configBytes = configCapture.readFiles()[0]!.bytes;
    const workspace = componentSourceWorkspaceSchema.parse(JSON.parse(Buffer.from(configBytes).toString('utf8')));
    if (workspace.sharedDirectories === undefined || !workspace.components.some(item => item.id === module.id && item.path === module.path))
        throw Error('workspace.source.declaration_changed');
    const layout: ComponentSourceLayout = { contractVersion: COMPONENT_SOURCE_LAYOUT_VERSION, componentId: module.id,
        componentPath: module.path, sharedDirectories: workspace.sharedDirectories };
    const directory = resolve(base, module.path);
    for (let current = directory; current !== base; current = dirname(current)) {
        if (current === dirname(current) || !current.startsWith(base + '/') || lstatSync(current).isSymbolicLink())
            throw Error('development.capture.symlink');
    }
    const prefix = module.path + '/', manifestCapture = captureDevelopmentFiles(base, [prefix + 'manifest.json'], limits), manifestBytes = manifestCapture.readFiles()[0]!.bytes;
    const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
    if (manifest.id !== module.id)
        throw Error('workspace.source.manifest_id_mismatch');
    const required = new Set<string>([...PROMPTFRAME_PUBLIC_STANDARD_POLICY.requiredFiles, manifest.entry.sourcePath, manifest.entry.propsSchemaPath]);
    for (const name of lockNames)
        if (existsSync(join(directory, name)))
            required.add(name);
    const selection = selectComponentSourceFiles(directory, required, { maximumFiles: budget.maximumFiles, maximumEntries: 8192, maximumDepth: 32, rejectSpecialFiles: true });
    const selected = selection.paths.filter(name => !lockNames.includes(name) && name !== 'promptframe-lockfile-evidence.json');
    const files = captureDevelopmentFiles(base, selected.map(name => prefix + name), budget).readFiles();
    let used = files.reduce((n, file) => n + file.bytes.byteLength, 0);
    const closure = collectComponentSourceGraph({ layout, initialFiles: files, maximumFiles: budget.maximumFiles, read(name) {
            const path = join(base, name);
            if (!existsSync(path))
                return undefined;
            if (lstatSync(path).isDirectory())
                return undefined;
            if (isComponentSourcePathIgnored(base, name))
                throw Error('package.required_file.ignored');
            const file = captureDevelopmentFiles(base, [name], budget).readFiles()[0]!;
            used += file.bytes.byteLength;
            if (used > budget.maximumBytes)
                throw Error('development.contents.byte_limit');
            return file.bytes;
        } });
    const directLocks = lockNames.filter(name => existsSync(join(directory, name))).map(name => ({ path: prefix + name, name, source: 'component', relativePath: name }));
    const locks = directLocks.length ? directLocks : existsSync(join(base, 'pnpm-workspace.yaml')) && existsSync(join(base, 'pnpm-lock.yaml'))
        ? [{ path: 'pnpm-lock.yaml', name: 'pnpm-lock.yaml', source: 'workspace_root', relativePath: relative(directory, join(base, 'pnpm-lock.yaml')).replace(/\\/gu, '/') }] : [];
    const rawLocks = locks.length ? captureDevelopmentFiles(base, locks.map(file => file.path), limits).readFiles() : [];
    const inheritedLock = !locks.length ? capturePnpmWorkspaceLock(directory) : undefined;
    const evidencePath = prefix + 'promptframe-lockfile-evidence.json';
    const restoredEvidence = !locks.length && !inheritedLock && existsSync(join(base, evidencePath))
        ? captureDevelopmentFiles(base, [evidencePath], limits).readFiles()[0] : undefined;
    const recapturePaths = [...closure.map(file => file.path), 'promptframe-workspace.json', ...locks.map(file => file.path), ...(restoredEvidence ? [evidencePath] : [])];
    const recaptured = new Map(captureDevelopmentFiles(base, recapturePaths, { maximumFiles: budget.maximumFiles + 8, maximumBytes: budget.maximumBytes + 16 * 1024 * 1024 + 64 * 1024 }).readFiles().map(file => [file.path, file.bytes]));
    if (!Buffer.from(configBytes).equals(Buffer.from(recaptured.get('promptframe-workspace.json')!))
        || !Buffer.from(manifestBytes).equals(Buffer.from(recaptured.get(prefix + 'manifest.json')!))
        || [...closure, ...rawLocks, ...(restoredEvidence ? [restoredEvidence] : [])].some(file => !Buffer.from(file.bytes).equals(Buffer.from(recaptured.get(file.path)!))))
        throw Error('development.capture.changed_during_read');
    const packageBytes = recaptured.get(prefix + 'package.json')!;
    inheritedLock?.verifyUnchanged();
    const evidence = locks.length ? json({ schemaVersion: 'promptframe.lockfile-evidence.v0.1.0', packageJsonSha256: sha(packageBytes),
        lockfiles: locks.map((lock, index) => ({ fileName: lock.name, source: lock.source, relativePath: lock.relativePath,
            sizeBytes: rawLocks[index]!.bytes.byteLength, sha256: sha(rawLocks[index]!.bytes) })) })
        : inheritedLock ? json({schemaVersion: 'promptframe.lockfile-evidence.v0.1.0', packageJsonSha256: sha(packageBytes),
            lockfiles: [{fileName: 'pnpm-lock.yaml', source: 'workspace_root', relativePath: inheritedLock.relativePath,
              sizeBytes: inheritedLock.lockBytes.byteLength, sha256: sha(inheritedLock.lockBytes)}]})
        : restoredEvidence && validComponentLockEvidence(packageBytes, restoredEvidence.bytes) ? Buffer.from(restoredEvidence.bytes) : undefined;
    if (restoredEvidence && !evidence)
        throw Error('workspace.source.lock_evidence_invalid');
    const output = [...closure.map(file => ({ name: file.path, data: Buffer.from(file.bytes) })),
        { name: 'promptframe-workspace.json', data: json({ ...workspace, components: [module] }) }, { name: COMPONENT_SOURCE_LAYOUT_FILE, data: json(layout) },
        ...(evidence ? [{ name: prefix + 'promptframe-lockfile-evidence.json', data: evidence }] : [])].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    validateComponentSourceLayoutFiles(output.map(file => ({ path: file.name, bytes: file.data })));
    if (output.length > budget.maximumFiles || output.reduce((n, file) => n + file.data.byteLength, 0) > budget.maximumBytes)
        throw Error('development.contents.byte_limit');
    return output;
}
