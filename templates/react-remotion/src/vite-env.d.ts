/// <reference types="vite/client" />
declare module 'virtual:promptframe-local-preview' {
  export const promptFrameLocalPreview: Promise<{
    props: Record<string, unknown> | null;
    issues: { prop?: string; code: string }[];
    usingExample?: boolean;
    models?: import('@promptframe/contracts').PromptFrameModelRepresentation[];
    modelResources?: Pick<import('@promptframe/contracts').ComponentRuntimeResourceManifest, 'contractVersion' | 'entries'>;
  }>;
}
