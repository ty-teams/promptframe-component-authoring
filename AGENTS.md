# PromptFrame Component Authoring Repo

This repository is the public source of truth for PromptFrame component authoring tools.

It may contain:

- Public contracts used by external authoring tools and the PromptFrame platform.
- Component authoring helpers.
- CLI and project scaffolding tools.
- Public component authoring skills, templates, examples, and docs.

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
