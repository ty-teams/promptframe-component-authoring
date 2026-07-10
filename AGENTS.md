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

Normal package releases must use GitHub Actions Trusted Publishing from this repo, environment `npm-production`, and tag patterns documented in README. Do not add `NPM_TOKEN` or publish from a local npm token path unless the user explicitly authorizes an emergency recovery. After a release, verify the official npm registry; mirror registries may lag and should not be treated as the source of truth for immediate post-publish checks.

Existing-version dist-tag promotion is a separate, user-authorized boundary. It may only use `.github/workflows/promote-authoring-release.yml`, environment `npm-promotion`, the repository-owned canonical receipt, and secret reference `NPM_DIST_TAG_PROMOTION_TOKEN`. The receipt defaults to dry-run and must explicitly unlock proof/latest after external evidence. Never place the credential value in source, logs, artifacts, package scripts or local shell history, and never use the current candidate as an unreviewed first credential experiment.
