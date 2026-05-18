export const COMPONENT_STANDARD_VERSION = 'component-standard.v0.1.0' as const;
export const COMPONENT_STANDARD_SOURCE_HASH = 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52' as const;
export const COMPONENT_STANDARD_SOURCE_PATH = 'docs/requirements/REQ-073/component-standard.md' as const;
export const COMPONENT_KIT_VERSION = '0.1.2' as const;
export const COMPONENT_MANIFEST_SCHEMA_VERSION = 'component-manifest.v0.1.0' as const;
export const COMPONENT_REVIEW_CHECKLIST_VERSION = 'component-review-checklist.v0.1.0' as const;

export function getComponentStandardStamp() {
  return {
    sourceVersion: COMPONENT_STANDARD_VERSION,
    sourceHash: COMPONENT_STANDARD_SOURCE_HASH,
    sourcePath: COMPONENT_STANDARD_SOURCE_PATH,
    componentKitVersion: COMPONENT_KIT_VERSION,
    manifestSchemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
    reviewChecklistVersion: COMPONENT_REVIEW_CHECKLIST_VERSION,
  };
}
