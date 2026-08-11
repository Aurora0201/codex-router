# 发布流程

Codex Router 使用 Release Please 维护版本与 changelog。合并 release PR 后，工作流创建 `vX.Y.Z` 标签和 GitHub Release，构建 npm tarball、Windows x64 ZIP 与 `SHA256SUMS.txt`，并在受保护的 `npm` environment 中通过 npm Trusted Publishing 发布。

## GitHub 一次性设置

1. 推荐创建一个仅安装到本仓库的 GitHub App。授予 repository contents 读写、pull requests 读写权限。
2. 将 App ID 保存为 Actions secret `RELEASE_APP_ID`，将私钥保存为 `RELEASE_APP_PRIVATE_KEY`。Release Please 优先使用该 App 的短期 token 创建 release PR，这样 PR 上的 CI 会正常触发。未配置时工作流会安全降级为仓库 `GITHUB_TOKEN`；GitHub 不会为该 token 创建的 PR 自动触发其他工作流，需要维护者重新打开 PR 或手动运行 CI。
3. 创建 GitHub environment `npm`，建议配置 required reviewer，并限制部署分支为 `main`。
4. 创建 repository variable `NPM_TRUSTED_PUBLISHING_READY`，首发前保持为 `false`。
5. 为 `main` 启用 branch protection：要求 pull request、禁止 force push，并要求 `CI / verify` 与 `CodeQL / analyze` 通过。

工作流中的第三方 Actions 使用明确的主版本，并由 Dependabot 每周检查更新。仓库管理员应在启用发布前根据组织策略将这些引用固定到审核过的完整 commit SHA；Dependabot 仍可继续维护 SHA 更新。

## 首次发布 v0.1.0

npm 要求包先存在，才能在包设置中配置 Trusted Publisher。因此首发分两步：

1. 合并 Release Please 创建的首个 release PR。Release 工作流会创建 GitHub Release 和校验过的 `.tgz`/ZIP，但因为 `NPM_TRUSTED_PUBLISHING_READY=false`，不会自动执行 npm publish。
2. 从 GitHub Release 下载 `.tgz`，验证 `SHA256SUMS.txt` 后，由 npm scope 所有者执行：

   ```powershell
   npm publish .\aurora0201-codex-router-0.1.0.tgz --access public
   ```

   该人工发布需按 npm 账户策略完成 2FA。
3. 在 npm 包的 Trusted Publisher 设置中添加本仓库，workflow filename 填 `release.yml`，environment 填 `npm`。
4. 将 GitHub repository variable `NPM_TRUSTED_PUBLISHING_READY` 改为 `true`。后续版本将使用 GitHub OIDC，不配置长期 `NPM_TOKEN`。

[npm Trusted Publishing 官方文档](https://docs.npmjs.com/trusted-publishers/)要求 GitHub-hosted runner、`id-token: write`、Node.js 22.14+ 与 npm 11.5.1+。本项目使用 Windows GitHub-hosted runner、Node.js 24 和 npm 11.5.1。公开仓库与公开包会由 npm 自动生成 provenance attestation。Release PR 与标签行为以 [Release Please Action 官方文档](https://github.com/googleapis/release-please-action)为准。

## 日常发布

1. 功能分支使用 Conventional Commits，并通过 PR 合入 `main`。
2. Release Please 更新或创建 release PR；检查版本、changelog 与三个 `package.json` 的版本同步。
3. 合并 release PR。
4. 检查 `Release` workflow：测试、lint、build、gateway e2e、打包安装 smoke test、Release assets 与 npm publish 均成功。
5. 下载 ZIP 并验证 `SHA256SUMS.txt`；运行 `codex-router.cmd --version` 做最终抽查。

发布失败时不要移动已有标签。修复问题后使用新的 Conventional Commit 触发流程；如果错误版本已经发布到 npm，按 npm 的 deprecate/yank 政策处理，并发布补丁版本。
