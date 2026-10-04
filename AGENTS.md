# PromptFrame Component Authoring 公开仓入口

> **本地开发入口（2026-10-04）**：本地源码、文档和3500沿产品仓 `docs/operations/local-development.md` 的普通 Git/任务分支、受影响测试、合并、Compose及真实功能验证推进。Campaign/lane、lease、逐路径oneShot、worktree登记、pre/Change Set证明和正式QA不再是本地前置；本页冲突的旧流程说明仅用于显式严格工具或生产发布。保持真实仓库、实际并发作者、密钥、业务权限、费用及生产/外部副作用边界；局部同结果配套路径无需逐项审批。

本仓库是 PromptFrame 公开组件作者工具链的源码事实源。

## 开工前必读

1. 先读本文件、[README.md](README.md)、[AUTHORING.md](AUTHORING.md)、
   [架构、演进与产品事项入口](docs/architecture-and-history.md) 和
   [公开导出政策](PUBLIC_EXPORT_POLICY.md)。
2. 修改公开 Component Author AI 行为前，继续读取
   [公开 authoring Skill](skills/component-authoring/SKILL.md) 及与任务相关的局部规则。
3. 修改前确认获准的 package、scaffold、Skill 或文档精确路径和测试。

新增或修正的说明性文档使用中文；代码标识、命令、schema、状态值、路径、包名和必要第三方名称保留英文。

产品 REQ、BUG、intake、Campaign、roster、session、lease 以及跨仓发布意图，统一由
`github.com/ty-teams/promptframe-product` 管理。产品级引用用产品仓中的
`pnpm repo:resolve -- <repoId:path>` 解析；当前事项按产品仓 `docs/work-item-routing.md` 的 repo/domain metadata
检索，不在本仓重建产品治理或要求接手 Agent 翻本仓 Git 历史找产品决定。

公开 authoring 改动在本 Git 仓独立 commit/push。产品仓记录实际服务版本；真正的公开package发布仍使用本仓发布合同与必要版本证据。
`services/` 软链接、父目录、checkout 名、同名分支和本地 package link 都不是版本权威。本地 link 只服务开发，
不能替代官方 registry 或 prod-like 验证。

## 本仓可以包含

- 外部 authoring 工具与 PromptFrame 平台共同使用的公开 contracts；
- 组件 authoring helper；
- CLI 与项目 scaffold；
- 公开组件 authoring Skill、模板、示例和文档。

Authoring 默认采用 AI-first 工作流：人类用户负责视觉评审和产品判断，外部 CodingAI / Component Author AI
把 brief、用户素材、公开 Skill、平台标准 API 与 CLI diagnostics 转为可复用组件。默认目标是可复用的
marketplace quality：清晰 props、响应式布局、安全默认值、确定性 diagnostics 和严格 upload admission。
一次性私有组件使用平台 `project_private_generation` lane，不冒充 marketplace-ready 成品。

## 本仓禁止包含

- PromptFrame secret、token、API key 或私有 endpoint 的生产默认值；
- 平台内部编排提示正文；
- agent inbox、内部 task board、私有 QA 原文或未脱敏用户数据；
- 来自 `remotion-media` 的 server admission、artifact resolver、OSS/MinIO、render worker、sandbox、
  deployment 或生产自动化实现细节；
- 平台私有运行时治理、内部 QA 机制或第二套产品控制面。

## 发布与验证

发布任何 package 或公开 Skill 前运行：

```bash
pnpm lint:public
pnpm -r lint
pnpm -r test
pnpm -r build
pnpm -r pack:dry-run
```

本地开发可以 link 到 `remotion-media`，但 Docker/CI/prod-like 验证必须安装 registry 中的真实 npm 包。
正常发布使用本仓既有 GitHub Actions Trusted Publishing、`npm-production` environment 和各 package 的
`publish-*.yml`；禁止新增长期 npm write credential 或从本地 npm 登录路径发布。发布后以官方 npm registry
为准，镜像源同步延迟不能作为即时权威。

Candidate authority 是 `.github/workflows/build-authoring-candidate.yml` 生成的四包不可变 tarball manifest，
不是 npm `next`。candidate asset 不覆盖、不移动、不删除，平台 QA 必须逐字节采用；资产产生后的失败使用新版本
cohort，不重写旧 tag。最终 OIDC workflow 直接把同一组 tarball 发布为 `latest`；部分成功只能向前补齐，四包
官方 version/integrity 和 canonical Docker runtime 未同时匹配 release receipt 前，平台 stable 不得前移。

禁止绕过 Git hooks、提交本机绝对路径、跨仓顺手修改或执行未经授权的 deployment。需要的改动超出当前仓库
或路径范围时，停在写入前并报告精确证据。
