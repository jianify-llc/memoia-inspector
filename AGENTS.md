# Memoia Inspector Agent 入口

分支与发布遵循 [Jianify 公司统一规范](https://github.com/jianify-llc/Jianify-llc/blob/main/docs/engineering/branch-release.md)：功能分别进入 Test 验收与 release，Tag／Online 审批及上线后的 main 归档保持各自边界。不得把 Test 业务线整体提前推进到生产分支。改动与提交前核对范围，保留他人工作区；平台写入、推送及部署按各自授权执行。

## 本地正确性与云端交付

日常开发用 `pnpm ci:local --mode quick`。安装 `.githooks/pre-push` 后，Test 推送使用推送前远端 Test SHA 对准确、干净的待推送提交执行 full；缺少可靠基线时扩大检查。工具自测依据明确差异执行，显式 full 无基线执行全部检查。不要用发布时的空 diff、上一提交或历史成功记录替代验证。

main PR／合并队列 Verify 只对真实候选执行 Docker 构建，不访问部署凭据；业务正确性、依赖审计和部署工具检查属于本地。Test 发布手动启动，新镜像只构建 AMD64；正式 Tag 保留独立原生双架构构建、digest 核对与 Online 审批。供应商联调和真实 Access／管理操作单独在本地或获授权的实际环境执行，不把云端构建称为业务验收。

CI-only 同步不得把 Test 的业务源码、SDK 或数据库契约提前带入 main/release。平台注册、保护规则、远端部署与业务验收须分别报告，不能用本地通过冒充完成。
