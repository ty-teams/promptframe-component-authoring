# @promptframe/contracts

Public contracts for PromptFrame component manifests, component references, diagnostics, layout capability cards, and public authoring policy metadata.

This package is intentionally small and safe to consume from authoring tools, templates, and platform integration code. It exports the public standard/security policy IDs used by `@promptframe/cli` so automation can rely on stable diagnostics without reading platform-internal docs.

Key public exports:

- `PROMPTFRAME_AUTHORING_STANDARD_RELEASE`: current authoring standard release metadata, source hash, package floors, supported component types, and upload target policy.
- `authoringStandardFreshnessDecisionSchema`: shared shape for local tooling and platform admission to explain whether an authoring package is current, warning-only, upload-blocking, or security-breaking.
- `authoringUploadTargetSchema`: public upload lanes for `marketplace_authoring` and `project_private_generation`.
- `componentReusabilityScoreSchema`: shared shape for deterministic component reuse diagnostics emitted by local CLI checks and platform admission.

## Public Security Policy

`PROMPTFRAME_PUBLIC_SECURITY_POLICY` is the public author-facing rule catalog used by CLI diagnostics. It intentionally describes the behavior an external component author must avoid, not PromptFrame platform internals.

High-risk browser/runtime capabilities are rejected locally when they are statically visible, including BroadcastChannel, WebRTC / RTCPeerConnection, Notification, Service Worker, clipboard access, navigator.locks, AudioContext / AudioWorklet, CSS.registerProperty, DOM Observer APIs, Remotion delayRender, and dynamic import.

Each public rule exposes a stable `id`, severity, category, action, pattern set, human reason, recommendation, and documentation path so local CLI output, GitHub annotations, and platform admission can refer to the same author-facing diagnostic family.
