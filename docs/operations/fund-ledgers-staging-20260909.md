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
