import ts from 'typescript';
import { COMPONENT_SOURCE_LAYOUT_FILE, componentSourceEntryPath, componentSourceLocalName, componentSourceRelativePathSchema, componentSourceUtf8, readComponentSourceLayout, sourcePathInside, type ComponentSourceFile, type ComponentSourceLayout } from './source-layout.js';
const lockNames = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']);
const forbiddenParts = new Set(['node_modules', 'dist', '.git', '.promptframe', '.component-packages']);
export function assertComponentSourceFilePath(file: string): void {
    componentSourceRelativePathSchema.parse(file);
    if (file.split('/').some(part => forbiddenParts.has(part) || /^\.env(?:\.|$)/iu.test(part)
        || ['.npmrc', '.yarnrc', '.yarnrc.yml', '.netrc'].includes(part))
        || /\.(?:pem|key|pfx|p12|exe|dll|so|node)$/iu.test(file))
        throw Error('workspace.source.private_or_unsupported_file');
}
export function componentSourceImportSpecifiers(file: string, source: string): string[] {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true), values: string[] = [];
    const add = (node: ts.Node | undefined) => { if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)))
        values.push(node.text); };
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            add(node.moduleSpecifier);
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
            add(node.moduleReference.expression);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
            || ts.isIdentifier(node.expression) && node.expression.text === 'require'))
            add(node.arguments[0]);
        ts.forEachChild(node, visit);
    };
    visit(parsed);
    return values;
}
export function componentSourceRequestCandidates(importer: string, request: string): string[] {
    const [name, query, ...more] = request.split('?');
    if (!name || !request.startsWith('.') || more.length || query !== undefined && query !== 'raw'
        || /[\\#\0]/u.test(name))
        return [];
    const parts = importer.split('/').slice(0, -1);
    for (const part of name.split('/')) {
        if (part === '..') {
            if (!parts.length)
                return [];
            parts.pop();
        }
        else if (part && part !== '.')
            parts.push(part);
    }
    const root = parts.join('/');
    if (!root)
        return [];
    const sourceAlternatives = root.endsWith('.mjs') ? [root.slice(0, -4) + '.mts']
        : root.endsWith('.cjs') ? [root.slice(0, -4) + '.cts']
            : root.endsWith('.jsx') ? [root.slice(0, -4) + '.tsx']
                : root.endsWith('.js') ? [root.slice(0, -3) + '.ts', root.slice(0, -3) + '.tsx'] : [];
    return [...new Set([root, ...sourceAlternatives,
            ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cts', '.cjs', '.json', '.module.css', '/index.ts', '/index.tsx', '/index.js'].map(ext => root + ext)])];
}
const localText = /\.(?:[mc]?[jt]sx?|json|css|frag|glsl|txt|vert|wgsl)$/iu;
const sourceCode = /\.[mc]?[jt]sx?$/iu;
/** Resolve only captured/read-once files. This never runs source, reads URLs or
 * resolves a host node_modules, path alias or another component implicitly. */
export function collectComponentSourceGraph(input: {
    layout?: ComponentSourceLayout;
    initialFiles: readonly ComponentSourceFile[];
    read?: (path: string) => Uint8Array | undefined;
    maximumFiles?: number;
}): ComponentSourceFile[] {
    const files = new Map<string, Uint8Array>(), pending: string[] = [], visited = new Set<string>();
    const allowed = (file: string) => !input.layout || sourcePathInside(file, input.layout.componentPath)
        || input.layout.sharedDirectories.some(root => sourcePathInside(file, root));
    const add = (file: ComponentSourceFile) => {
        assertComponentSourceFilePath(file.path);
        if (!allowed(file.path))
            throw Error('workspace.source.import_outside_declared_roots');
        if (!files.has(file.path)) {
            files.set(file.path, file.bytes);
            pending.push(file.path);
        }
        if (files.size > (input.maximumFiles ?? 2048))
            throw Error('workspace.source.file_limit');
    };
    input.initialFiles.forEach(add);
    let attempts = 0;
    while (pending.length) {
        const file = pending.pop()!;
        if (visited.has(file) || !sourceCode.test(file))
            continue;
        visited.add(file);
        const text = componentSourceUtf8(files.get(file)!);
        for (const request of componentSourceImportSpecifiers(file, text)) {
            if (!request.startsWith('.'))
                continue;
            const candidates = componentSourceRequestCandidates(file, request);
            let found: string | undefined;
            for (const candidate of candidates) {
                if (!allowed(candidate))
                    continue;
                assertComponentSourceFilePath(candidate);
                if (files.has(candidate)) {
                    found = candidate;
                    break;
                }
                if (++attempts > 32768)
                    throw Error('workspace.source.resolution_limit');
                const bytes = input.read?.(candidate);
                if (bytes !== undefined) {
                    add({ path: candidate, bytes });
                    found = candidate;
                    break;
                }
            }
            if (!found)
                throw Error('workspace.source.local_import_missing_or_outside');
            if (!localText.test(found))
                throw Error('workspace.source.import_type_unsupported');
        }
    }
    return [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, bytes }));
}
/** Servers and restored source use the same selected-component layout. The
 * layout adds no source-read, edit, publishing or dependency permission. */
export function validateComponentSourceLayoutFiles(files: readonly ComponentSourceFile[]): ComponentSourceLayout | undefined {
    if (!files.some(file => file.path === COMPONENT_SOURCE_LAYOUT_FILE))
        return undefined;
    if (new Set(files.map(file => file.path)).size !== files.length)
        throw Error('workspace.source.duplicate_file');
    const layout = readComponentSourceLayout(files);
    if (!layout)
        return undefined;
    const source = files.filter(file => file.path !== COMPONENT_SOURCE_LAYOUT_FILE && file.path !== 'promptframe-workspace.json');
    for (const file of source) {
        assertComponentSourceFilePath(file.path);
        if (lockNames.has(file.path.split('/').at(-1)!))
            throw Error('workspace.source.raw_lockfile_forbidden');
    }
    const selected = source.filter(file => componentSourceLocalName(layout, file.path) !== undefined);
    const all = new Map(source.map(file => [file.path, file.bytes]));
    const closed = collectComponentSourceGraph({ layout, initialFiles: selected, read: file => all.get(file) });
    if (closed.length !== source.length || closed.some(file => !all.has(file.path)))
        throw Error('workspace.source.unreferenced_shared_file');
    const manifest = selected.find(file => file.path === componentSourceEntryPath(layout, 'manifest.json'));
    if (!manifest)
        throw Error('workspace.source.manifest_missing');
    return layout;
}
