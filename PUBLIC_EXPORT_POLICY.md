# Public Export Policy

This repository is safe to publish only if it stays limited to component authoring materials.

## Allowed

- Public TypeScript contracts for component manifests, component references, diagnostics, layout capability, and authoring metadata.
- Public helper code for building PromptFrame-compatible video components.
- CLI code for authoring, validation, packaging, upload/status calls, and probe requests.
- Component templates, examples, README files, and public authoring skills.
- Public npm and GitHub Actions release configuration using OIDC / Trusted Publishing.

## Forbidden

- Secrets, tokens, API keys, passwords, recovery codes, or private certificates.
- `NPM_TOKEN`, GitHub PATs, one-api keys, OSS/MinIO access keys, or cloud provider credentials.
- Director system prompts or private agent prompts.
- Agent inboxes, internal task boards, REQ/QA private evidence, unredacted screenshots, or user data.
- Platform source implementation for server admission, artifact resolver, render workers, sandbox policy, deployment, or production automation.
- Private endpoint defaults, LAN IPs, Tailscale IPs, or Docker hostnames as production defaults.

## Endpoint Rule

CLI and examples may show an explicit `--endpoint` option or environment variable such as `PROMPTFRAME_API_BASE`. They must not hard-code a private endpoint as a production default.

## Publishing Rule

All releases must use npm Trusted Publishing from GitHub Actions. Do not commit npm tokens or add long-lived npm secrets.
