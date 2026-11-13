/// <reference types="vite/client" />
declare module 'virtual:promptframe-local-preview' {
  export const promptFrameLocalPreview: Promise<{
    props: Record<string, unknown> | null;
    issues: { prop?: string; code: string }[];
    usingExample?: boolean;
  }>;
}
