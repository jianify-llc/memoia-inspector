# Memoia Inspector Agent 入口

分支开发与发布遵循 [Jianify 公司统一规范](https://github.com/jianify-llc/Jianify-llc/blob/main/docs/engineering/branch-release.md)：从最新 `main` 创建 `feature/*`，先合入 `test` 通过真实测试环境验收，再将同一功能合入 `release`。版本 tag 从 `release` 创建；Online 部署须由 `jianify` 在 GitHub `online` Environment 人工审批，线上验收后再把 `release` 合入 `main`。禁止直接在 `main` 或 `test` 开发，不把 `test` 整体合入 `release`。

改动前确认范围、验证方式和目标分支。提交或修改远端分支前检查状态与暂存范围，保留他人未提交改动；未经用户确认不推送、合并、revert 或改写历史。测试、构建、镜像发布和真实业务验收分别记录，不能互相代替。部署细节见 [deploy/README.md](deploy/README.md)。

## 本地正确性与云端交付

日常开发用 `pnpm ci:local --mode quick`。安装 `.githooks/pre-push` 后，Test 推送使用推送前远端 Test SHA 对准确、干净的待推送提交执行 full；缺少可靠基线时扩大检查。工具自测依据明确差异执行，显式 full 无基线执行全部检查。不要用发布时的空 diff、上一提交或历史成功记录替代验证。

main PR／合并队列 Verify 只对真实候选执行 Docker 构建，不访问部署凭据；业务正确性、依赖审计和部署工具检查属于本地。Test 发布手动启动，新镜像只构建 AMD64；正式 Tag 保留独立原生双架构构建、digest 核对与 Online 审批。供应商联调和真实 Access／管理操作单独在本地或获授权的实际环境执行，不把云端构建称为业务验收。

CI-only 同步不得把 Test 的业务源码、SDK 或数据库契约提前带入 main/release。平台注册、保护规则、远端部署与业务验收须分别报告，不能用本地通过冒充完成。
