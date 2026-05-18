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

Remote commands support stable JSON output:

```bash
npx promptframe upload ./component.zip --endpoint "$PROMPTFRAME_API_BASE" --json
npx promptframe status <buildId> --json
npx promptframe reindex <buildId> --provider-kind cloud_embedding --json
npx promptframe probe <buildId> --level standard --json
```

Every JSON response includes a stable `diagnostic.code`, for example `upload.completed`, `status.completed`, `reindex.completed`, or `probe.completed`. Missing endpoint failures exit with code `2` and use `<command>.endpoint.missing`.
