# 组件仓库目录示例

目录结构按源码的归属和复用范围选择。平台上传目标、项目权限及是否公开按实际使用范围设置。

## 单组件独立仓

```text
intro-card/
├── manifest.json
├── package.json
├── package-lock.json
└── src/
```

```bash
npx --yes create-promptframe-component@latest ./intro-card --name intro-card
cd intro-card
npm install
npx --yes --package @promptframe/cli@latest -- promptframe setup-ci . --provider github --upgrade --dry-run
```

## 按作品组织的私有工作区

```text
production-lab/
├── promptframe-workspace.json
├── pnpm-workspace.yaml
└── works/
    ├── film-a/components/title-card/
    └── film-b/components/scene-marker/
```

```bash
npx --yes create-promptframe-component@latest ./production-lab --workspace \
  --component title-card --component-path works/film-a/components/title-card --id @example/title-card
npx --yes create-promptframe-component@latest ./production-lab --workspace \
  --component scene-marker --component-path works/film-b/components/scene-marker --id @example/scene-marker
cd production-lab
pnpm install
npx --yes --package @promptframe/cli@latest -- promptframe workspace validate .
npx --yes --package @promptframe/cli@latest -- promptframe setup-ci . --provider github --dry-run
```

## 按能力组织的复用工作区

```text
visual-components/
├── promptframe-workspace.json
├── pnpm-workspace.yaml
└── components/
    ├── diagram/flow-card/
    └── data/metric-card/
```

```bash
npx --yes create-promptframe-component@latest ./visual-components --workspace \
  --component flow-card --component-path components/diagram/flow-card --id @example/flow-card
npx --yes create-promptframe-component@latest ./visual-components --workspace \
  --component metric-card --component-path components/data/metric-card --id @example/metric-card
cd visual-components
pnpm install
npx --yes --package @promptframe/cli@latest -- promptframe workspace validate .
npx --yes --package @promptframe/cli@latest -- promptframe setup-ci . --provider github --dry-run
```

两个工作区示例都在根目录生成同一格式的组件清单。组件移动后更新清单中的路径，组件身份按 `id` 维护。提交依赖锁。在 Git 根确认选择正确后，去掉 `--dry-run` 生成工作流。需要共享本地源码时，按[作者指南](../../AUTHORING.md)声明共享目录；上传配置见[CLI 工作区 GitHub Actions](../../packages/cli/README.md#工作区-github-actions)。
