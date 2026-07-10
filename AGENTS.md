# PromptFrame Component Authoring Repo

This repository is the public source of truth for PromptFrame component authoring tools.

It may contain:

- Public contracts used by external authoring tools and the PromptFrame platform.
- Component authoring helpers.
- CLI and project scaffolding tools.
- Public component authoring skills, templates, examples, and docs.

Authoring guidance must assume an AI-first workflow:

- The human user is the visual reviewer and product judge.
- The external CodingAI or Component Author AI turns the brief, user assets, public authoring skill, platform standard API output, and CLI diagnostics into a reusable component.
- Default external authoring targets reusable marketplace quality: clear props, responsive layout, safe defaults, deterministic diagnostics, and strict upload admission.
- Temporary private components should use the platform `project_private_generation` lane; do not present one-off private work as marketplace-ready.

It must not contain:

- PromptFrame platform secrets, tokens, API keys, or private endpoints as production defaults.
- Director system prompts.
- Agent inbox, internal task boards, private QA reports, or unredacted user data.
- Server admission, artifact resolver, OSS/MinIO, render worker, sandbox, deployment, or production automation implementation details from `remotion-media`.

Before publishing any package or public skill, run:

```bash
pnpm lint:public
pnpm -r lint
pnpm -r test
pnpm -r build
pnpm -r pack:dry-run
```

Local development may link this repo into `remotion-media`, but Docker/CI/prod-like verification must install the real npm packages from the registry.

Normal package releases must use GitHub Actions Trusted Publishing from this repo and the existing per-package `publish-*.yml` workflow filenames under environment `npm-production`. The completion path is tokenless: do not add a long-lived npm write credential or publish from a local npm authentication path. After a release, verify the official npm registry; mirror registries may lag and are not immediate post-publish authority.

Candidate authority is an immutable four-package tarball manifest produced by `.github/workflows/build-authoring-candidate.yml`, not npm `next`. Candidate assets are no-clobber and must be adopted byte-for-byte by platform QA. Final OIDC workflows publish those same tarballs directly as `latest`; partial success only forward-completes, and platform stable cannot advance until all four official versions/integrities and the canonical Docker runtime match the release receipt. Historical recovery creates a new versioned cohort instead of rewinding dist-tags.
