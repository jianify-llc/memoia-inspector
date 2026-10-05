# Memoia Inspector Agent 入口

分支开发与发布遵循 [Jianify 公司统一规范](https://github.com/jianify-llc/Jianify-llc/blob/main/docs/engineering/branch-release.md)：从最新 `main` 创建 `feature/*`，先合入 `test` 通过真实测试环境验收，再将同一功能合入 `release`。版本 tag 从 `release` 创建；Online 部署须由 `jianify` 在 GitHub `online` Environment 人工审批，线上验收后再把 `release` 合入 `main`。禁止直接在 `main` 或 `test` 开发，不把 `test` 整体合入 `release`。

改动前确认范围、验证方式和目标分支。提交或修改远端分支前检查状态与暂存范围，保留他人未提交改动；未经用户确认不推送、合并、revert 或改写历史。测试、构建、镜像发布和真实业务验收分别记录，不能互相代替。部署细节见 [deploy/README.md](deploy/README.md)。

普通开发／Test push 不运行 Actions，Test 验收须明确手动批次。更新 checkout 后安装 `pnpm hooks:install`，通过干净 worktree 的 `pnpm push:test` 取得远端 Test SHA 并执行本地 full 差异检查后再同步 Test；不绕过 hook、不覆盖其他 Agent 的未提交改动。具体检查以 deploy/README.md 和公司规范为准。
