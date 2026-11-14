import { z } from 'zod';
export const COMPONENT_SOURCE_LAYOUT_FILE = 'promptframe-source-layout.json';
export const COMPONENT_SOURCE_LAYOUT_VERSION = 'promptframe-component-source-layout/v1';
export const componentSourceRelativePathSchema = z.string().min(1).max(512).refine(value => !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !/^[A-Za-z]:/u.test(value)
    && value.split('/').every(part => !!part && part !== '.' && part !== '..'), 'Use a canonical root-relative path.');
const declaration = z.object({ id: z.string().min(1).max(256), path: componentSourceRelativePathSchema }).strict();
export const componentSourceWorkspaceSchema = z.object({
    schemaVersion: z.literal('promptframe-workspace.v0.1.0'),
    components: z.array(declaration).min(1).max(128),
    sharedDirectories: z.array(componentSourceRelativePathSchema).max(32).optional(),
}).strict().superRefine((value, context) => {
    const ids = new Set<string>(), paths = new Set<string>();
    for (const item of value.components) {
        if (ids.has(item.id) || paths.has(item.path))
            context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate component declaration.' });
        ids.add(item.id);
        paths.add(item.path);
    }
    const roots = value.sharedDirectories ?? [];
    if (new Set(roots).size !== roots.length)
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate shared directory.' });
    for (const root of roots)
        for (const item of value.components)
            if (sourcePathInside(root, item.path) || sourcePathInside(item.path, root))
                context.addIssue({ code: z.ZodIssueCode.custom, message: 'Shared directories must be separate from component directories.' });
});
export type ComponentSourceWorkspace = z.infer<typeof componentSourceWorkspaceSchema>;
export const componentSourceLayoutSchema = z.object({
    contractVersion: z.literal(COMPONENT_SOURCE_LAYOUT_VERSION),
    componentId: z.string().min(1).max(256), componentPath: componentSourceRelativePathSchema,
    sharedDirectories: z.array(componentSourceRelativePathSchema).max(32),
}).strict();
export type ComponentSourceLayout = z.infer<typeof componentSourceLayoutSchema>;
export interface ComponentSourceFile {
    path: string;
    bytes: Uint8Array;
}
export function componentSourceUtf8(bytes: Uint8Array): string {
    const Decoder = (globalThis as unknown as {
        TextDecoder: new (encoding: string, options: {
            fatal: boolean;
        }) => {
            decode(input: Uint8Array): string;
        };
    }).TextDecoder;
    return new Decoder('utf-8', { fatal: true }).decode(bytes);
}
export function sourcePathInside(file: string, directory: string): boolean { return file === directory || file.startsWith(directory + '/'); }
export function componentSourceEntryPath(layout: ComponentSourceLayout | undefined, name: string): string {
    componentSourceRelativePathSchema.parse(name);
    return layout ? layout.componentPath + '/' + name : name;
}
export function componentSourceLocalName(layout: ComponentSourceLayout | undefined, name: string): string | undefined {
    return !layout ? name : name.startsWith(layout.componentPath + '/') ? name.slice(layout.componentPath.length + 1) : undefined;
}
/** Layout is a source-package format, never project/owner or publication authority. */
export function readComponentSourceLayout(files: readonly ComponentSourceFile[]): ComponentSourceLayout | undefined {
    const metadata = files.filter(file => file.path === COMPONENT_SOURCE_LAYOUT_FILE);
    if (!metadata.length)
        return undefined;
    if (metadata.length !== 1 || metadata[0]!.bytes.byteLength > 16 * 1024)
        throw Error('workspace.source.layout_invalid');
    let layout: ComponentSourceLayout, workspace: ComponentSourceWorkspace;
    try {
        layout = componentSourceLayoutSchema.parse(JSON.parse(componentSourceUtf8(metadata[0]!.bytes)));
        const config = files.find(file => file.path === 'promptframe-workspace.json');
        if (!config || config.bytes.byteLength > 64 * 1024)
            throw Error();
        workspace = componentSourceWorkspaceSchema.parse(JSON.parse(componentSourceUtf8(config.bytes)));
    }
    catch {
        throw Error('workspace.source.layout_invalid');
    }
    if (!workspace.components.some(item => item.id === layout.componentId && item.path === layout.componentPath)
        || JSON.stringify(workspace.sharedDirectories ?? []) !== JSON.stringify(layout.sharedDirectories))
        throw Error('workspace.source.layout_mismatch');
    const manifest = files.find(file => file.path === componentSourceEntryPath(layout, 'manifest.json'));
    try {
        if (!manifest || JSON.parse(componentSourceUtf8(manifest.bytes)).id !== layout.componentId)
            throw Error();
    }
    catch {
        throw Error('workspace.source.manifest_id_mismatch');
    }
    return layout;
}
