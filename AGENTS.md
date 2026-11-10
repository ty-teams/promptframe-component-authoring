# PromptFrame Component Authoring

本仓维护公开组件作者工具链：contracts、component kit、CLI、scaffold 和组件创作 Skill。

## 开发入口

修改前阅读 [README](README.md)、[AUTHORING](AUTHORING.md)、[架构与开发说明](docs/architecture-and-history.md)及[公开导出政策](PUBLIC_EXPORT_POLICY.md)。调整组件创作行为时，继续阅读[组件创作 Skill](skills/component-authoring/SKILL.md)。

确认 Git 根、origin、当前分支和未提交改动。使用任务分支，运行受影响检查后普通提交、合并和推送，保留已有改动。

说明性文档使用中文；代码标识、命令、schema、状态值、包名和必要第三方名称保留英文。

## 代码与公开内容

- 维护公开 contracts、组件 helper、CLI、模板、示例和文档。
- 组件应有清晰 props、响应式布局、安全默认值和可自动处理的 diagnostics。私有组件使用平台的 `project_private_generation` 上传目标。
- 平台集成使用公开 API 和版本化 contracts。本地 package link 用于开发；Docker、CI 和兼容性验证使用正式 npm 包或固定候选 tarball。
- Token、API key、Cookie、用户数据和私有端点不进入仓库。平台服务实现、内部提示和运维资料不属于公开包内容。具体范围见公开导出政策。

## 验证与发行

```bash
pnpm lint:public
pnpm -r lint
pnpm -r test
pnpm -r build
pnpm -r pack:dry-run
```

相关测试、打包检查和版本验收通过后发布相应版本。文档调整无需单独增加包版本。

四包候选由 `.github/workflows/build-authoring-candidate.yml` 一次打包，manifest 绑定源码、版本和 tarball 字节。兼容性检查与最终发行使用同一组文件；候选资产和 tag 保持不变，修复通过新版本向前推进。

正式发行使用现有 `publish-*.yml`、`npm-production` 和 GitHub Actions OIDC。核对官方 registry 的版本与 integrity；部分发布成功时按原回执向前补齐，不覆盖已有版本。四包与平台运行时全部匹配后再更新平台 stable 状态。
