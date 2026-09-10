# 基金账本 staging-next 发布记录（2026-09-09）

## 版本与范围

- 功能主线 PR：#21，保持 Draft；main 未合并、生产未发布。
- 测试集成 PR：#22，按线性历史要求 rebase 合入 staging-next。
- 发布前 staging-next：de252f78c6ff17a6f5ec64c433d3de5d82d75e3a。
- 已部署 staging-next：e69004f23654fb9349894e504838b6b569618079。
- 合入后的代码树与已通过 CI 的测试候选 6349deb5a1b8eb92a7de2bc8ec7a8428aad4fa3d 完全一致。
- 保留原测试环境已有功能；未混入新的 App、小程序或卖家业务修改。旧 staging@acc0e08c 和 main@101ada3d 均未改变。

## 验证结果

- 部署工作流： https://github.com/flyspaceden/aimaimia/actions/runs/34406291292 ，success。
- 测试集成后端质量门禁：3657 passed，39 按环境条件 skipped。
- 独立基金 PostgreSQL 集成：52 passed。
- 浏览器 E2E：57 passed，21 按环境条件 skipped。
- 测试分支 WeChat Mini Program CI：34406291098，success；未上传或发布小程序。
- API readiness、test-admin/release-sha.txt、test-seller/release-sha.txt 均精确匹配 e69004f23654fb9349894e504838b6b569618079。
- 两个新管理端汇总 API 的匿名访问均返回 401。

## 数据库

部署脚本先停止旧后端、验证数据库备份，再执行迁移。2026-09-09 21:31 UTC 六个新增迁移全部成功，21:31:22 UTC 后端 healthy。

备份：`/www/backup/database/aimaimai-staging/20260909T213112Z-de252f78c6ff-before-e69004f23654/database.dump`。
备份 SHA-256：`d2dca2bdef55b1e71db511bd2c6ff4808a0a5b061f2cadf42bb00c20bbbc88d1`。

没有迁移、回填或追缴历史个人产业基金。新公司账从零开始，旧基金余额作为原账查询及期初证据保留。

## 已部署页面检查

使用已登录的测试后台实际页面，检查基金总览、慈善基金逐笔流水、历史流水详情和公对公付款登记表单。既有基金余额和历史流水正常展示；缺失的历史余额显示“未记录”。空付款表单被必填校验拦截，未创建付款单、未进行真实银行打款。新公司账本当前为空，符合不回填历史的要求。

入口：https://test-admin.ai-maimai.com/fund-ledgers

## 边界

本次完成测试环境部署与上述验证，不表示生产已发布，也不表示真实银行付款已验收。新账启用后不可仅回退到旧个人分配代码；按 platform-fund-ledgers-release.md 保留账本并采取兼容恢复。

此文件是发布后的本地运维记录，不改变已验证测试环境的 exact SHA。

## 三页体验优化发布（2026-09-09 美东）

- 主功能 PR #23 与发布修正 PR #24 已通过各自门禁并以 rebase 合并至 staging-next。
- 三页首次部署版本：`881cfc93f12db2be43ad2ea25dbf927bcb746250`；独立 main-based 功能候选保留在 Draft PR #21。
- PR #24 最终验证 run：`34418604861`（E2E）、`34418604856`（checks）。页面专项为 18 项，包含同帧连续操作、四种付款未知结果重试、上下文返回和窄屏边界。
- 第一次部署 run `34417163559` 被几何断言的亚像素误报拦截，未执行服务器更新。后续还以确定性回归修复了快速筛选恢复旧参数的问题。
- 部署 run `34419411667` 成功；API/Admin/Seller 已验证 exact SHA 均为 `881cfc93f12db2be43ad2ea25dbf927bcb746250`，无待执行迁移。
- 已部署页面核对：三个独立主入口、基金名称搜索、73 条慈善历史流水及详情抽屉、公司空账与付款空列表正常；待归属默认 PENDING 查询返回 500，本机 PG 复现为 enum=text 的 42883。补丁 PR #25（候选 `2652096d`）已修复显式枚举转换，60 项 PG/HTTP/单测及 19 项页面回归通过，随后已发布并完成下方最终验收。
- 本轮无数据库结构、资金核心或历史回填变更。`main` 仍为 `101ada3d97e6f13b19a1aba61fe778f76f20a951`，旧 `staging` 仍为 `acc0e08c303eef76af3bb4ca9d3e9a8c95c4ebb2`。


### 最终验收完成

- 最终测试版本：`bdf1af35fd7adb63dabd41993f6585ab7b1a7a3c`，PR #25 已按 rebase 合并。部署 run [34422769713](https://github.com/flyspaceden/aimaimia/actions/runs/34422769713) 成功。
- API ready、Admin 与 Seller release marker 三者均核对为上述完整 SHA；后端没有待执行迁移。
- 发布门禁：后端 3661 项通过（43 项显式跳过），基金 PG/HTTP/单测 60 项通过，页面回归 19 项通过，全站 E2E 57 项通过（21 项显式跳过）。
- 实际页面：基金、公司、付款三个入口已核对；基金名称筛选、慈善历史流水与详情抽屉正常。最终补丁复验确认待归属 PENDING 页面显示正常空列表，服务器错误消失；流水返回总览保留原名称筛选。
- 本次未创建或确认真实付款，未进行银行打款；历史账不迁移、不补算，生产未发布。

本地发布记录提交只更新文档，不改变已部署版本的 exact SHA。
