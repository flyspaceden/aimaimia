# 微信小程序生产集成与可回退发布清单（2026-08-21）

> 本文是本次“小程序 + 自提 + 微信支付/提现 + 必要后台 + 推荐 H5”进入生产的执行真相源。任何代码、数据库或外部平台动作都必须按批次记录证据；未满足当前批次门禁时不得进入下一批。

## 1. 冻结基线

| 项目 | 冻结值 |
|---|---|
| production integration 基线 | `origin/main@aa8f5daa6c8990369ba1671f2f662af0e57384c5` |
| staging 参考快照 | `origin/staging@053f385eb5bf539902c33686b1f2cba9aef067c7` |
| 当前生产后端已部署版本 | `a0f4781069951ec3c89f9ac3c858f6c1e550c163` |
| 当前 staging 后端已部署版本 | `4ff68e6e`（`053f385e` 仅追加文档） |
| 集成分支 | `codex/miniapp-production-integration-20260821` |
| 集成目录 | `/private/tmp/aimaimai-miniapp-production-integration-20260821` |

`main` 与 `staging` 长期双向分叉，禁止直接 merge、禁止使用 `ours/theirs` 批量解冲突、禁止从原始脏工作区发布。集成始终以最新 `origin/main` 为底，按完整功能切片移植并要求生产旧 API 路由零删除。

## 2. 本次包含范围

- 微信小程序完整客户端与 production 构建门禁。
- 微信小程序登录、普通/VIP/团购 JSAPI 结算、主动查单、退款与退货运费支付。
- 微信提现、确认收款、通知收件箱与补偿任务。
- 商城普通送货上门与到店自提并列履约；平台/企业自提点、备货、凭证、核销和审计。
- 小程序码、推荐落地页、订阅消息和微信交易发货信息。
- 推荐 H5 的“小程序 / 下载 App”双入口；移动端保持两个按钮，不增加二次二维码。
- 小程序按购物车行更新和稳定排序；App 旧购物车与结算接口必须继续兼容。
- 平台管理后台、卖家后台中支撑上述功能的最小页面与权限。
- App 不新增自提下单入口；只允许加入避免跨端订单误显示的最小只读兼容。

## 3. 明确排除独立配送系统

本次不得进入 `main`：

- `delivery-admin/**`
- `delivery-seller/**`
- `backend/prisma-delivery/**`
- `backend/src/delivery-prisma/**`
- `backend/src/modules/delivery/**`
- `app/delivery/**`
- `src/repos/delivery/**`、Delivery 专用 store/theme/utils
- Delivery 专用法律文本、官网页面、后台登录入口和 CI/CD 部署任务
- `DeliveryModule`、`DELIVERY_DATABASE_URL`、Delivery JWT/SMS/微信配置及配送库 migration

不得按关键字粗暴删除所有“delivery”代码。商城原有的 `ShipmentModule`、顺丰发货、物流轨迹、普通送货上门和售后物流属于现有 App/小程序共同履约能力，必须保留。共享文件必须逐行拆分独立配送系统 wiring，不能整文件照搬或整文件丢弃。

## 4. 分批门禁与回退点

### Batch 0：发布安全门禁（不含业务与 Schema）

目标：`main` push 不再自动发布；生产只能手动触发并经过 production approval；审批、测试和服务器部署锁定同一个不可变 `github.sha`；同批变更先部署后端，成功后才允许发布后台/H5。

门禁：workflow 静态测试、YAML 解析、E2E workflow 可调用性、无 Delivery 路径、主库+Redis readiness、当前生产代码不发生部署。静态站点发布前生成归档，发布后必须读取本次 SHA marker 和本次构建资源；服务器归档每站保留最近 20 份。

回退：`git revert <batch-0-sha>`。本批无数据库、服务器、App 或微信平台状态变化。

### Batch 1：后端兼容与 18 条主库 migration

目标：在保留全部 main 旧路由的前提下，加入小程序认证/支付/提现/自提/通知/购物车/收货副作用闭包。

生产前门禁：

1. 生产 PostgreSQL 完整备份并校验可恢复。
2. 用该备份恢复隔离副本，执行全部 migration。
3. 预检 `(userId, groupId)` 重复 Booking、多个默认地址、孤儿外键和 enum 使用情况。
4. 对比 migration checksum，禁止修改已经在 staging 执行过的 migration。
5. 后端全量测试、真实 PostgreSQL 并发测试、路由零删除测试、App 旧接口契约测试全部通过。
6. 手动生产发布输入的 `migration_rehearsal_sha` 必须与候选完整 SHA 完全相同，否则 workflow fail-closed。
7. 正式环境在执行 `prisma migrate deploy` 前自动运行 `pg_dump` custom-format 备份、`pg_restore --list` TOC 校验和二次读取 SHA-256 一致性校验；任何一步失败都禁止 migration。本机保留最近 10 份，正式发布前还必须确认 PITR/离机备份。
8. Batch 1 正式 migration 必须安排维护停写窗口，或已经具备经验证的 PITR；仅有在线 `pg_dump` 不足以保证整库恢复后的新订单/支付零丢失。
9. Batch 1 前必须把后端构建改为版本化 release 目录并在维护窗口原子切换，禁止继续在 PM2 live checkout 中原地覆盖 `node_modules/dist`。

回退：

- 代码通过独立 revert commit 回到“能容忍新表/新枚举”的兼容版本，再由 workflow 重载；服务器自动恢复的也是部署开始时记录的精确旧 SHA。
- 新 enum 值和已执行的数据修复按 fail-forward 处理，不承诺自动删除。
- 若默认地址或 Booking 数据修复错误，停止写入并从发布前备份恢复；不得边运行边手工修正式库。
- 未得到生产备份、迁移演练和用户再次确认前，不得运行正式 `prisma migrate deploy`。

### Batch 2：平台后台与卖家后台

目标：发布自提点管理、备货、短码/扫码枪/摄像头核销、微信提现展示和权限控制。

门禁：新后台必须等待 Batch 1 后端健康；Node/ZXing 版本一致；构建、权限和浏览器 E2E 全绿。

回退：部署前保存当前静态产物目录的带 SHA 归档；失败时恢复旧归档。后台回退不得回滚已经进入履约中的订单数据。

### Batch 3：小程序与推荐 H5

目标：从干净 `main` 构建 production 小程序，上传微信体验版；后端和小程序正式落地页就绪后再发布 H5 双入口。

门禁：production artifact 只能包含 `api.ai-maimai.com`/生产 WSS；不得包含测试域名或 Mock；真实设备完成普通/VIP/团购、配送/自提、退款、微信提现和核销闭环。

回退：

- H5 部署前保存旧静态产物，异常时恢复旧版本；HTTP 200 不算成功，必须读到本次 release SHA marker 和构建资源。
- 小程序先使用体验版；提交审核前不影响线上用户。
- 已发布版本异常时使用微信公众平台版本管理回退至上一正式版本；后端仍保持向后兼容。
- 本批不执行 App OTA/EAS Build；App 发布继续走独立批准流程。

## 5. 发布顺序

```text
production integration PR 全绿
  -> 生产配置只读预检
  -> 生产数据库备份与克隆迁移演练
  -> 手动批准 Batch 1 后端
  -> 现有 App / 支付 / 退款 / 购物车生产冒烟
  -> 手动批准 Batch 2 admin + seller
  -> 小程序 production 体验版与真机闭环
  -> 发布推荐 H5
  -> 提交微信审核
```

任一步失败立即停止，不允许在失败批次上追加“再试一次”的生产提交。修复必须回到 integration 分支形成新的独立 commit，重新走该批全部门禁。

## 6. 每次提交/发布必须记录

- 基线 SHA、候选 SHA、受影响文件、明确排除文件。
- 测试命令、测试数量、CI run URL、部署服务器实际 SHA。
- 数据库备份标识、克隆演练结果、migration 前后核对结果。
- 生产配置只报告“存在/缺失与非敏感摘要”，禁止输出密钥和证书内容。
- 对应代码回滚 SHA、静态产物归档、数据库 fail-forward/恢复方案。
- 实际服务器、Nginx、PM2、数据库或第三方平台动作同步写入被 gitignore 的 `docs/operations/阿里云部署.md`。

## 7. GitHub 发布环境状态

2026-08-21 已完成不触碰服务器的可回退安全设置：

- `production` environment：只允许 `main`，required reviewer 为 `flyspaceden`（GitHub user id `96812865`），允许本人审核以避免单管理员仓库永久锁死。
- `staging` environment：只允许 `staging`，不设置 reviewer，保留测试环境自动发布能力。
- `main` branch protection 尚未开启；必须等 production integration PR 首次跑出稳定 check context 后再启用，避免 required check 名称错误锁死 main。

环境设置回退（不会修改代码或服务器）：

```bash
gh api --method DELETE repos/flyspaceden/aimaimia/environments/production
gh api --method DELETE repos/flyspaceden/aimaimia/environments/staging
```
