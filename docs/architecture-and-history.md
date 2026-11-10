# Component Authoring 架构、演进与产品事项入口

本文件是仓库维护者和 CodingAI 的薄接手索引。它不复制内部产品 REQ/BUG，不包含私有 endpoint、部署实现或
平台侧 admission 源码；公开边界仍以 [PUBLIC_EXPORT_POLICY.md](../PUBLIC_EXPORT_POLICY.md) 为准。

## 1. 仓库职责

本仓拥有外部组件作者可公开依赖的四层工具：

| 层 | 当前事实源 | 职责 |
| --- | --- | --- |
| Public contracts | `packages/contracts/` | manifest、diagnostic、layout、resource 与 authoring metadata 合同 |
| Component kit | `packages/component-kit/` | authoring helper、preview shell、layout/resource helper |
| CLI | `packages/cli/` | validate/check/package/upload/status/probe 与 JSON diagnostics |
| Scaffold | `packages/create-component/`、`templates/` | 单组件和 workspace 项目生成、thin preview shell |
| Public Skill | `skills/component-authoring/` | 外部 Component Author AI 的公开工作方式 |

平台私有的 server admission、artifact resolver、sandbox、OSS/MinIO、render worker、Director prompt 和部署逻辑
属于 `remotion-media` 或部署仓，不得复制到这里。公开仓只通过版本化 public contracts 和 diagnostics 与平台协作。

## 2. 稳定设计不变量

1. **Public first**：外部作者只依赖公开 npm 包、CLI JSON diagnostics 和发布后的平台 API，不读取内部 task/QA。
2. **Schema 与工具同源**：contracts、kit、CLI、scaffold 和 public Skill 必须对同一 authoring contract 保持兼容。
3. **Thin shell**：生成项目的 preview shell 只装配公共 helper；作者业务代码、schema、manifest 和 `public/` 不被
   `promptframe sync` 覆盖。
4. **诊断可自动化**：命令的 `--json` 输出和稳定 diagnostic code 是 CodingAI 的主要反馈，不靠解析人类文案。
5. **候选字节不可变**：candidate tarball manifest 绑定精确 bytes；失败通过新 cohort 向前修复，不移动旧资产。
6. **Tokenless release**：正式发布使用 GitHub Actions OIDC / npm Trusted Publishing，不引入长期 npm write secret。

## 3. 演进脉络

本工具链从少量组件 helper 演进为 contracts + kit + CLI + scaffold 的完整公开 authoring surface；随后补齐了
workspace、多组件 CI、公开资源、AST 安全诊断、可升级 thin preview shell、candidate manifest 和 tokenless 发布。
这些演进的当前结论已经体现在源码、测试、[AUTHORING.md](../AUTHORING.md) 和 release workflows 中。

产品为什么要求某项能力、当前是否排期以及跨仓验收结果，统一在产品仓读取；不要在本公开仓通过 Git 历史寻找或
恢复内部 REQ/BUG。

## 4. 当前产品事项如何定位

产品控制面入口：

```text
promptframe-product:docs/work-item-routing.md
promptframe-product:docs/requirements/
promptframe-product:docs/bugs/
```

新事项使用可精确检索的 metadata，例如：

```markdown
- Primary repo: promptframe-component-authoring
- Affected repos: promptframe-component-authoring, remotion-media
- Domain labels: authoring/cli, authoring/platform-admission
```

这些字段只做检索和路由；它们不把平台私有实现授权给公开仓，也不替代 Change Set 的 exact commit/blob 绑定。
本仓没有迁移前本地产品治理树，因此无需恢复单独 archive；历史产品事项仍以产品仓保存的 canonical 材料为准。

## 5. 本地验证入口

前置条件是仓库声明的 Node 与 `pnpm` 版本，并从干净 checkout 安装 lockfile：

```bash
pnpm install --frozen-lockfile
pnpm lint:public
pnpm -r lint
pnpm -r test
pnpm -r build
pnpm -r pack:dry-run
```

修改 release workflow 时额外运行 `pnpm test:release`；修改 preview geometry 时运行
`pnpm test:previewroot-geometry`。本地 link 只服务开发，Docker/CI/prod-like 验证必须使用 registry 中的真实包。
已授权 BUG/REQ 代码修改在受影响测试及相应验收通过后，默认包含对应 npm 包按既有合同的正常发行，无需逐版本或 tag 再申请；用户明确 hold 时保持暂停。平台环境部署和个人宿主安装仍按各自实际授权；纯规则或文档变更不制造空版本。四包不可变 tarball、manifest、OIDC 同组发布和官方 registry 回读合同保持，公开导出范围不扩大。
