# @promptframe/cli

PromptFrame component authoring CLI.

Use it to inspect the public component standard, check component folders, validate manifests, package source archives, upload components, check build status, rebuild evidence indexes, and rerun layout/security probes.

```bash
npm install -D @promptframe/cli
npx promptframe validate .
npx promptframe package . --out ./component.zip
npx promptframe upload ./component.zip --endpoint https://your-promptframe.example/api-proxy
npx promptframe status <buildId> --endpoint https://your-promptframe.example/api-proxy
```

Endpoint resolution is explicit and public-safe:

1. `--endpoint`
2. `PROMPTFRAME_API_BASE`
3. `REMOTION_MEDIA_API_BASE`
4. local config written by `promptframe configure --endpoint <url>`

The CLI embeds no production, Tailscale, local Docker, or private PromptFrame endpoint default. Upload success only means the platform accepted the source package for trust-pipeline admission; use `status`, `reindex`, and `probe` to inspect build readiness, evidence/search readiness, and layout/security diagnostics.

Local and remote commands support stable JSON output:

```bash
npx promptframe standard --json
npx promptframe doctor . --json
npx promptframe validate . --json
npx promptframe upload ./component.zip --endpoint "$PROMPTFRAME_API_BASE" --json
npx promptframe status <buildId> --json
npx promptframe reindex <buildId> --provider-kind cloud_embedding --json
npx promptframe probe <buildId> --level standard --json
```

Every JSON response includes a stable `diagnostic.code`, for example `standard.completed`, `doctor.completed`, `validate.completed`, `upload.completed`, `status.completed`, `reindex.completed`, or `probe.completed`. `validate --json` also reports `checkedRuleIds` for the public policy checks it ran. JSON failures include `failureReason` and `retryable`. Missing endpoint failures exit with code `2` and use `<command>.endpoint.missing`.

`validate` and `package` consume public policies from `@promptframe/contracts`: required files, preview limits, deterministic Remotion source rules, and deterministic security gate patterns such as `code.eval`, `code.new_function`, `code.string_timer`, and `host.fs_process_env`. These local checks are early author feedback; the platform admission pipeline remains the final trust gate.
